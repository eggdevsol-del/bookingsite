// Ink Consult API. Owns accounts, consult records, uploaded files and the
// compiled email. The same handler runs inside Vite in development and inside
// server/index.mjs in production.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import Busboy from 'busboy';
import { fileURLToPath } from 'node:url';
import { REGIONS, REGION_INDEX, THEME_INDEX, GENDERS, LIMITS } from '../shared/catalog.mjs';
import { BRAND } from '../shared/brand.mjs';

// Secrets such as the Web3Forms key live in .env next to package.json (never committed).
// Variables already set in the environment (e.g. on Railway) take precedence.
const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const COOKIE = 'ic_session';
const SESSION_DAYS = 60;
const STEPS = new Set(['profile', 'gender', 'body', 'theme', 'idea', 'desk', 'summary', 'atm', 'done']);
const GENDER_IDS = new Set(GENDERS.map((g) => g.id));
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|avif|tiff?|bmp)$/i;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const b64url = (buf) => buf.toString('base64url');
const randomId = (bytes = 12) => b64url(crypto.randomBytes(bytes));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('base64url');
const nowIso = () => new Date().toISOString();

function makeRef() {
  // Unambiguous characters only, so a client can read it out over the phone.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `IC-${s}`;
}

function scryptHash(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function ageFrom(dob) {
  const d = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age -= 1;
  return age;
}

function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat('en-NZ', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

/** Serialises async work per key so read-modify-write on one consult never interleaves. */
class KeyedLock {
  #tails = new Map();
  run(key, fn) {
    const prev = this.#tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => {});
    this.#tails.set(key, tail);
    tail.then(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    });
    return next;
  }
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.usersFile = path.join(dir, 'users.json');
    this.sessionsFile = path.join(dir, 'sessions.json');
    this.consultsDir = path.join(dir, 'consults');
    this.uploadsDir = path.join(dir, 'uploads');
    this.outboxDir = path.join(dir, 'outbox');
    this.users = {}; // email -> { id, salt, hash, consults: [], createdAt }
    this.sessions = {}; // sha256(token) -> { userId, email, exp }
    this.consults = new Map();
    this.lock = new KeyedLock();
  }

  async init() {
    for (const d of [this.dir, this.consultsDir, this.uploadsDir, this.outboxDir]) await fsp.mkdir(d, { recursive: true });
    this.users = await this.#readJson(this.usersFile, {});
    this.sessions = await this.#readJson(this.sessionsFile, {});
    const now = Date.now();
    for (const [k, s] of Object.entries(this.sessions)) if (s.exp < now) delete this.sessions[k];
  }

  async #readJson(file, fallback) {
    try {
      return JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return fallback;
      throw err;
    }
  }

  async writeAtomic(file, data) {
    const tmp = `${file}.${randomId(6)}.tmp`;
    await fsp.writeFile(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    await fsp.rename(tmp, file);
  }

  saveUsers() {
    return this.lock.run('users', () => this.writeAtomic(this.usersFile, this.users));
  }

  saveSessions() {
    return this.lock.run('sessions', () => this.writeAtomic(this.sessionsFile, this.sessions));
  }

  async getConsult(id) {
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) return null;
    if (this.consults.has(id)) return this.consults.get(id);
    const c = await this.#readJson(path.join(this.consultsDir, `${id}.json`), null);
    if (c) this.consults.set(id, c);
    return c;
  }

  /** Read-modify-write one consult under its lock. */
  updateConsult(id, mutate) {
    return this.lock.run(`consult:${id}`, async () => {
      const c = await this.getConsult(id);
      if (!c) throw new HttpError(404, 'Consult not found');
      const result = await mutate(c);
      c.updatedAt = nowIso();
      await this.writeAtomic(path.join(this.consultsDir, `${id}.json`), c);
      return result ?? c;
    });
  }

  async createConsult(consult) {
    this.consults.set(consult.id, consult);
    await this.lock.run(`consult:${consult.id}`, () =>
      this.writeAtomic(path.join(this.consultsDir, `${consult.id}.json`), consult),
    );
    await fsp.mkdir(path.join(this.uploadsDir, consult.id), { recursive: true });
    return consult;
  }

  uploadPath(consultId, name) {
    return path.join(this.uploadsDir, consultId, name);
  }

  async listConsults() {
    const names = await fsp.readdir(this.consultsDir);
    const out = [];
    for (const n of names) if (n.endsWith('.json')) out.push(await this.getConsult(n.slice(0, -5)));
    return out.filter(Boolean).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }
}

/** Small fixed-window limiter for login and registration attempts. */
class RateLimiter {
  #hits = new Map();
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
  }
  check(key) {
    const now = Date.now();
    const entry = this.#hits.get(key);
    if (!entry || entry.reset < now) {
      this.#hits.set(key, { n: 1, reset: now + this.windowMs });
      return;
    }
    entry.n += 1;
    if (entry.n > this.max) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
  }
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  const payload = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'content-type': isJson ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

async function readBody(req, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, 'Request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const buf = await readBody(req, LIMITS.jsonBytes);
  try {
    return JSON.parse(buf.toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isSecure(req) {
  return Boolean(req.socket.encrypted) || req.headers['x-forwarded-proto'] === 'https';
}

function originOf(req, publicUrl) {
  if (publicUrl) return publicUrl.replace(/\/$/, '');
  const proto = isSecure(req) ? 'https' : 'http';
  return `${proto}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;
}

// ---------- validation ----------

function str(v, field, { min = 1, max = 200 } = {}) {
  if (typeof v !== 'string') throw new HttpError(400, `${field} is required`);
  const s = v.trim();
  if (s.length < min) throw new HttpError(400, `${field} is required`);
  if (s.length > max) throw new HttpError(400, `${field} is too long`);
  return s;
}

function parseProfile(body) {
  const fullName = str(body.fullName, 'Full name', { min: 2, max: 120 });
  const email = str(body.email, 'Email', { max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, 'Please enter a valid email address');
  const phone = str(body.phone, 'Phone', { min: 6, max: 30 });
  if (!/^[+()\d\s-]{6,30}$/.test(phone)) throw new HttpError(400, 'Please enter a valid phone number');
  const dob = str(body.dob, 'Date of birth', { max: 10 });
  const age = ageFrom(dob);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || age === null || age < 0 || age > 120) {
    throw new HttpError(400, 'Please enter a valid date of birth');
  }
  return { fullName, email, phone, dob };
}

function parsePassword(v) {
  if (typeof v !== 'string' || v.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (v.length > 200) throw new HttpError(400, 'Password is too long');
  return v;
}

function parsePatch(body, currency) {
  const patch = {};
  if ('gender' in body) {
    if (body.gender !== null && !GENDER_IDS.has(body.gender)) throw new HttpError(400, 'Unknown body type');
    patch.gender = body.gender;
  }
  if ('regions' in body) {
    if (!Array.isArray(body.regions) || body.regions.length > REGIONS.length) throw new HttpError(400, 'Invalid placement');
    const set = new Set();
    for (const r of body.regions) {
      if (!REGION_INDEX.has(r)) throw new HttpError(400, `Unknown body area: ${r}`);
      set.add(r);
    }
    patch.regions = [...set];
  }
  if ('theme' in body) {
    if (body.theme !== null && !THEME_INDEX.has(body.theme)) throw new HttpError(400, 'Unknown theme');
    patch.theme = body.theme;
  }
  if ('idea' in body) {
    if (typeof body.idea !== 'string' || body.idea.length > LIMITS.ideaMax) throw new HttpError(400, 'Idea is too long');
    patch.idea = body.idea;
  }
  if ('budget' in body) {
    const a = body.budget?.amount;
    if (body.budget !== null && !(Number.isInteger(a) && a >= 0 && a <= LIMITS.budgetMax)) {
      throw new HttpError(400, 'Invalid budget');
    }
    patch.budget = body.budget === null ? null : { amount: a, currency };
  }
  if ('step' in body) {
    if (!STEPS.has(body.step)) throw new HttpError(400, 'Unknown step');
    patch.step = body.step;
  }
  return patch;
}

/** What the client may see of its own consult. Tokens and file paths stay server-side. */
function publicConsult(c) {
  return {
    id: c.id,
    ref: c.ref,
    status: c.status,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    submittedAt: c.submittedAt ?? null,
    profile: c.profile,
    gender: c.gender,
    regions: c.regions,
    theme: c.theme,
    idea: c.idea,
    budget: c.budget,
    step: c.step,
    uploads: c.uploads.map((u) => ({ id: u.id, name: u.name, type: u.type, size: u.size, hasThumb: u.hasThumb })),
    snapshots: c.snapshots,
    email: c.email ? { sentAt: c.email.sentAt, mode: c.email.mode, ok: c.email.ok } : null,
  };
}

function missingForSubmit(c) {
  const missing = [];
  if (!c.gender) missing.push('body type');
  if (!c.regions.length) missing.push('placement');
  if (!c.theme) missing.push('theme');
  if ((c.idea ?? '').trim().length < LIMITS.ideaMin) missing.push('idea');
  if (!c.budget) missing.push('budget');
  return missing;
}

// ---------- the email ----------

function compileEmail(c, base, accessKey, artistName) {
  const theme = THEME_INDEX.get(c.theme);
  const age = ageFrom(c.profile.dob);
  const link = (p) => `${base}${p}?k=${c.artistToken}`;
  const regionLabels = c.regions.map((id) => REGIONS[REGION_INDEX.get(id)].label);
  const refs = c.uploads.map((u, i) => `${i + 1}. ${u.name} — ${link(`/artist/f/${c.id}/${u.id}`)}`);
  const fields = {
    'Consult ref': c.ref,
    Client: c.profile.fullName,
    Email: c.profile.email,
    Phone: c.profile.phone,
    'Date of birth': `${c.profile.dob} (age ${age ?? 'unknown'})${age !== null && age < 18 ? ' ⚠ UNDER 18' : ''}`,
    'Body type': GENDERS.find((g) => g.id === c.gender)?.label ?? c.gender,
    Placement: regionLabels.join(', '),
    Theme: theme?.label ?? c.theme,
    'Their idea': c.idea.trim(),
    Budget: formatMoney(c.budget.amount, c.budget.currency),
    'Character (front)': c.snapshots.front ? link(`/artist/f/${c.id}/snapshot-front`) : 'Not captured',
    'Character (back)': c.snapshots.back ? link(`/artist/f/${c.id}/snapshot-back`) : 'Not captured',
    References: refs.length ? refs.join('\n') : 'None uploaded',
    'Full consult page': link(`/artist/c/${c.id}`),
  };
  return {
    access_key: accessKey,
    subject: `New consult ${c.ref} — ${c.profile.fullName} — ${theme?.label ?? ''}`,
    from_name: `${artistName} Consults`,
    replyto: c.profile.email,
    ...fields,
  };
}

function artistPage(c, base) {
  const theme = THEME_INDEX.get(c.theme);
  const age = ageFrom(c.profile.dob);
  const f = (id) => `${base}/artist/f/${c.id}/${id}?k=${c.artistToken}`;
  const row = (k, v) => `<tr><th>${escapeHtml(k)}</th><td>${v}</td></tr>`;
  const regions = c.regions.map((id) => `<span class="chip">${escapeHtml(REGIONS[REGION_INDEX.get(id)].label)}</span>`).join('');
  const snaps = ['front', 'back']
    .filter((v) => c.snapshots[v])
    .map((v) => `<figure><img src="${f(`snapshot-${v}`)}" alt="Character ${v}"><figcaption>${v}</figcaption></figure>`)
    .join('');
  const refs = c.uploads
    .map(
      (u) => `<a class="ref" href="${f(u.id)}" target="_blank" rel="noopener">
        <img src="${u.hasThumb ? f(`${u.id}-thumb`) : f(u.id)}" alt="${escapeHtml(u.name)}" loading="lazy">
        <span>${escapeHtml(u.name)} · ${(u.size / 1048576).toFixed(1)} MB</span></a>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${escapeHtml(c.ref)} · ${escapeHtml(c.profile.fullName)}</title>
<style>
:root{color-scheme:dark;--bg:#0b0a0d;--card:#16141a;--ink:#f3eee8;--dim:#a49fa8;--hot:#ff4f8b;--sun:#ffa24c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:clamp(28px,5vw,44px);margin:0 0 4px;letter-spacing:-.02em}
.sub{color:var(--dim);margin:0 0 24px}.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:20px}
@media(max-width:760px){.grid{grid-template-columns:1fr}}
.card{background:var(--card);border-radius:16px;padding:20px;border:1px solid #2a2630}
table{width:100%;border-collapse:collapse}th{text-align:left;color:var(--dim);font-weight:500;padding:8px 12px 8px 0;vertical-align:top;width:34%}
td{padding:8px 0}tr+tr th,tr+tr td{border-top:1px solid #26222b}
.chip{display:inline-block;margin:2px 6px 2px 0;padding:3px 10px;border-radius:999px;background:linear-gradient(90deg,var(--hot),var(--sun));color:#160b10;font-weight:600;font-size:13px}
.idea{white-space:pre-wrap;font-size:17px}.snaps{display:flex;gap:12px}.snaps figure{margin:0;flex:1}
.snaps img{width:100%;border-radius:12px;background:#000}figcaption{color:var(--dim);text-align:center;text-transform:capitalize}
.refs{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
.ref{display:block;color:var(--ink);text-decoration:none;font-size:13px}.ref img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;background:#000;display:block;margin-bottom:6px}
.warn{color:#ffb347;font-weight:700}h2{font-size:15px;text-transform:uppercase;letter-spacing:.12em;color:var(--dim);margin:28px 0 12px}
</style></head><body><main>
<h1>${escapeHtml(c.profile.fullName)}</h1>
<p class="sub">${escapeHtml(c.ref)} · ${escapeHtml(c.status)}${c.submittedAt ? ` · sent ${escapeHtml(new Date(c.submittedAt).toLocaleString('en-NZ'))}` : ''}</p>
<div class="grid">
<section class="card"><div class="snaps">${snaps || '<p class="sub">No character snapshot.</p>'}</div></section>
<section class="card"><table>
${row('Email', `<a href="mailto:${escapeHtml(c.profile.email)}" style="color:var(--sun)">${escapeHtml(c.profile.email)}</a>`)}
${row('Phone', `<a href="tel:${escapeHtml(c.profile.phone)}" style="color:var(--sun)">${escapeHtml(c.profile.phone)}</a>`)}
${row('Date of birth', `${escapeHtml(c.profile.dob)} · age ${age ?? '?'}${age !== null && age < 18 ? ' <span class="warn">UNDER 18</span>' : ''}`)}
${row('Body type', escapeHtml(GENDERS.find((g) => g.id === c.gender)?.label ?? '—'))}
${row('Theme', escapeHtml(theme?.label ?? '—'))}
${row('Budget', c.budget ? escapeHtml(formatMoney(c.budget.amount, c.budget.currency)) : '—')}
${row('Placement', regions || '—')}
</table></section></div>
<h2>Their idea</h2><section class="card"><p class="idea">${escapeHtml(c.idea || '—')}</p></section>
<h2>References & body photos (${c.uploads.length})</h2>
<section class="card">${refs ? `<div class="refs">${refs}</div>` : '<p class="sub">None uploaded.</p>'}</section>
</main></body></html>`;
}

// ---------- the API ----------

export async function createApi(options = {}) {
  const env = process.env;
  const dataDir = path.resolve(options.dataDir ?? env.DATA_DIR ?? env.RAILWAY_VOLUME_MOUNT_PATH ?? 'data');
  const publicUrl = options.publicUrl ?? env.PUBLIC_URL ?? (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : '');
  const accessKey = (env.WEB3FORMS_ACCESS_KEY ?? '').trim();
  const currency = BRAND.currency;
  const artistName = BRAND.studio;
  if (accessKey && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accessKey)) {
    console.warn('[api] WEB3FORMS_ACCESS_KEY does not look like a Web3Forms key (expected a UUID); emails will likely be rejected.');
  }
  console.info(`[api] email: ${accessKey ? 'Web3Forms on' : 'preview mode (no WEB3FORMS_ACCESS_KEY)'} · data: ${dataDir}`);
  const artistKey = env.ARTIST_KEY ?? '';

  const store = new Store(dataDir);
  await store.init();
  const authLimiter = new RateLimiter(12, 10 * 60 * 1000);

  async function startSession(res, req, user, email) {
    const token = randomId(32);
    store.sessions[sha256(token)] = { userId: user.id, email, exp: Date.now() + SESSION_DAYS * 864e5 };
    await store.saveSessions();
    const parts = [`${COOKIE}=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${SESSION_DAYS * 86400}`];
    if (isSecure(req)) parts.push('Secure');
    res.setHeader('set-cookie', parts.join('; '));
  }

  function sessionOf(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const s = store.sessions[sha256(token)];
    if (!s || s.exp < Date.now()) return null;
    const user = store.users[s.email];
    return user && user.id === s.userId ? { user, email: s.email, key: sha256(token) } : null;
  }

  async function currentConsult(req) {
    const s = sessionOf(req);
    if (!s) throw new HttpError(401, 'Please log in');
    const id = s.user.consults.at(-1);
    const c = id ? await store.getConsult(id) : null;
    if (!c) throw new HttpError(404, 'No consult yet');
    return { session: s, consult: c };
  }

  async function newConsult(user, profile) {
    const c = {
      id: randomId(12),
      ref: makeRef(),
      artistToken: randomId(24),
      status: 'draft',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      profile,
      gender: null,
      regions: [],
      theme: null,
      idea: '',
      budget: null,
      step: 'gender',
      uploads: [],
      snapshots: { front: false, back: false },
      email: null,
    };
    await store.createConsult(c);
    user.consults.push(c.id);
    await store.saveUsers();
    return c;
  }

  // POST /api/register
  async function register(req, res) {
    authLimiter.check(req.socket.remoteAddress ?? 'x');
    const body = await readJson(req);
    const profile = parseProfile(body);
    const password = parsePassword(body.password);
    if (body.consent !== true) throw new HttpError(400, 'Please agree to the privacy terms to continue');
    if (store.users[profile.email]) {
      throw new HttpError(409, 'That email already has a consult. Use "Open my consult" on the title screen to log in.');
    }
    const salt = randomId(16);
    const user = { id: randomId(12), salt, hash: b64url(await scryptHash(password, salt)), consults: [], createdAt: nowIso() };
    store.users[profile.email] = user;
    const c = await newConsult(user, profile);
    await startSession(res, req, user, profile.email);
    send(res, 201, { consult: publicConsult(c) });
  }

  // POST /api/login
  async function login(req, res) {
    authLimiter.check(req.socket.remoteAddress ?? 'x');
    const body = await readJson(req);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const user = store.users[email];
    const hash = await scryptHash(password, user?.salt ?? 'no-such-user');
    if (!user || !crypto.timingSafeEqual(hash, Buffer.from(user.hash, 'base64url'))) {
      throw new HttpError(401, 'That email and password don’t match a consult');
    }
    await startSession(res, req, user, email);
    const c = await store.getConsult(user.consults.at(-1));
    send(res, 200, { consult: c ? publicConsult(c) : null });
  }

  async function logout(req, res) {
    const s = sessionOf(req);
    if (s) {
      delete store.sessions[s.key];
      await store.saveSessions();
    }
    res.setHeader('set-cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    send(res, 200, { ok: true });
  }

  async function me(req, res) {
    const s = sessionOf(req);
    if (!s) return send(res, 200, { consult: null });
    const c = await store.getConsult(s.user.consults.at(-1));
    send(res, 200, { consult: c ? publicConsult(c) : null });
  }

  // POST /api/consults — a returning client starts a fresh consult with the same profile
  async function startAnother(req, res) {
    const s = sessionOf(req);
    if (!s) throw new HttpError(401, 'Please log in');
    const last = await store.getConsult(s.user.consults.at(-1));
    if (last && last.status === 'draft') return send(res, 200, { consult: publicConsult(last) });
    const c = await newConsult(s.user, last.profile);
    send(res, 201, { consult: publicConsult(c) });
  }

  async function patchConsult(req, res) {
    const { consult } = await currentConsult(req);
    const patch = parsePatch(await readJson(req), currency);
    const c = await store.updateConsult(consult.id, (c) => {
      if (c.status !== 'draft') throw new HttpError(409, 'This consult has already been sent');
      Object.assign(c, patch);
    });
    send(res, 200, { consult: publicConsult(c) });
  }

  // POST /api/uploads  (multipart: "file" required, "thumb" optional JPEG preview)
  async function upload(req, res) {
    const { consult } = await currentConsult(req);
    if (consult.status !== 'draft') throw new HttpError(409, 'This consult has already been sent');
    if (consult.uploads.length >= LIMITS.filesPerConsult) {
      throw new HttpError(409, `You can add up to ${LIMITS.filesPerConsult} files`);
    }
    const id = randomId(9);
    const written = [];
    const result = await new Promise((resolve, reject) => {
      let bb;
      try {
        bb = Busboy({ headers: req.headers, limits: { files: 2, fields: 4, fileSize: LIMITS.fileBytes } });
      } catch {
        reject(new HttpError(400, 'Expected a file upload'));
        return;
      }
      const meta = { file: null, thumb: false };
      const pending = [];
      let failure = null;
      bb.on('file', (field, stream, info) => {
        const isThumb = field === 'thumb';
        const okType = isThumb ? info.mimeType === 'image/jpeg' : info.mimeType.startsWith('image/') || IMAGE_EXT.test(info.filename ?? '');
        if ((field !== 'file' && field !== 'thumb') || !okType) {
          failure ??= new HttpError(415, 'Only photos and images can be uploaded');
          stream.resume();
          return;
        }
        const name = isThumb ? `${id}-thumb` : id;
        const target = store.uploadPath(consult.id, name);
        written.push(target);
        let size = 0;
        const out = fs.createWriteStream(target);
        stream.on('data', (d) => (size += d.length));
        stream.on('limit', () => {
          failure ??= new HttpError(413, isThumb ? 'Preview too large' : 'Each file must be 50 MB or smaller');
        });
        pending.push(
          new Promise((ok, bad) => {
            out.on('finish', ok);
            out.on('error', bad);
          }),
        );
        stream.pipe(out);
        stream.on('end', () => {
          if (isThumb) {
            if (size > LIMITS.thumbBytes) failure ??= new HttpError(413, 'Preview too large');
            meta.thumb = true;
          } else {
            const original = (info.filename || 'photo').replace(/[^\w.\- ()]+/g, '_').slice(0, 120);
            meta.file = { id, name: original, type: info.mimeType, size, hasThumb: false, createdAt: nowIso() };
          }
        });
      });
      bb.on('error', (e) => reject(new HttpError(400, `Upload failed: ${e.message}`)));
      bb.on('close', async () => {
        try {
          await Promise.all(pending);
        } catch (e) {
          failure ??= e;
        }
        if (failure) reject(failure);
        else if (!meta.file) reject(new HttpError(400, 'No file received'));
        else resolve({ ...meta.file, hasThumb: meta.thumb });
      });
      req.on('close', () => {
        if (!req.complete) reject(new HttpError(400, 'Upload interrupted'));
      });
      req.pipe(bb);
    }).catch(async (err) => {
      await Promise.all(written.map((p) => fsp.rm(p, { force: true })));
      throw err;
    });
    try {
      await store.updateConsult(consult.id, (c) => {
        if (c.status !== 'draft') throw new HttpError(409, 'This consult has already been sent');
        if (c.uploads.length >= LIMITS.filesPerConsult) throw new HttpError(409, `You can add up to ${LIMITS.filesPerConsult} files`);
        c.uploads.push(result);
      });
    } catch (err) {
      await Promise.all(written.map((p) => fsp.rm(p, { force: true })));
      throw err;
    }
    send(res, 201, { upload: { id: result.id, name: result.name, type: result.type, size: result.size, hasThumb: result.hasThumb } });
  }

  async function deleteUpload(req, res, uploadId) {
    const { consult } = await currentConsult(req);
    await store.updateConsult(consult.id, (c) => {
      if (c.status !== 'draft') throw new HttpError(409, 'This consult has already been sent');
      const i = c.uploads.findIndex((u) => u.id === uploadId);
      if (i < 0) throw new HttpError(404, 'File not found');
      c.uploads.splice(i, 1);
    });
    await fsp.rm(store.uploadPath(consult.id, uploadId), { force: true });
    await fsp.rm(store.uploadPath(consult.id, `${uploadId}-thumb`), { force: true });
    send(res, 200, { ok: true });
  }

  // POST /api/snapshot?view=front|back  (raw PNG/JPEG body)
  async function snapshot(req, res, url) {
    const { consult } = await currentConsult(req);
    const view = url.searchParams.get('view');
    if (view !== 'front' && view !== 'back') throw new HttpError(400, 'Unknown view');
    const type = req.headers['content-type'];
    if (type !== 'image/png' && type !== 'image/jpeg') throw new HttpError(415, 'Snapshot must be PNG or JPEG');
    const buf = await readBody(req, LIMITS.snapshotBytes);
    await store.updateConsult(consult.id, async (c) => {
      if (c.status !== 'draft') throw new HttpError(409, 'This consult has already been sent');
      await fsp.writeFile(store.uploadPath(c.id, `snapshot-${view}`), buf);
      c.snapshots[view] = type;
    });
    send(res, 200, { ok: true });
  }

  async function serveFile(res, consult, fileId) {
    let type = null;
    if (fileId === 'snapshot-front' || fileId === 'snapshot-back') type = consult.snapshots[fileId.slice(9)] || null;
    else if (fileId.endsWith('-thumb')) type = consult.uploads.some((u) => `${u.id}-thumb` === fileId && u.hasThumb) ? 'image/jpeg' : null;
    else type = consult.uploads.find((u) => u.id === fileId)?.type ?? null;
    if (!type) throw new HttpError(404, 'File not found');
    const file = store.uploadPath(consult.id, fileId);
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat) throw new HttpError(404, 'File not found');
    res.writeHead(200, {
      'content-type': type,
      'content-length': stat.size,
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
    });
    fs.createReadStream(file).pipe(res);
  }

  // POST /api/submit/prepare — validate and compile the email; nothing is marked sent yet.
  async function prepare(req, res) {
    const { consult } = await currentConsult(req);
    if (consult.status !== 'draft') throw new HttpError(409, 'This consult has already been sent');
    const missing = missingForSubmit(consult);
    if (missing.length) throw new HttpError(400, `Still needed: ${missing.join(', ')}`);
    const base = originOf(req, publicUrl);
    if (accessKey) {
      return send(res, 200, { mode: 'web3forms', payload: compileEmail(consult, base, accessKey, artistName) });
    }
    // No Web3Forms key yet: keep a local preview of exactly what would be emailed.
    const payload = compileEmail(consult, base, '(not configured)', artistName);
    const lines = Object.entries(payload)
      .filter(([k]) => k !== 'access_key')
      .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td style="white-space:pre-wrap">${escapeHtml(v)}</td></tr>`)
      .join('');
    await store.writeAtomic(
      path.join(store.outboxDir, `${consult.id}.html`),
      `<!doctype html><meta charset="utf-8"><title>Outbox ${escapeHtml(consult.ref)}</title><body style="font:15px system-ui;padding:24px;max-width:900px">
<p><b>Preview only.</b> Set WEB3FORMS_ACCESS_KEY to send this to your inbox.</p><table cellpadding="8" border="1" style="border-collapse:collapse">${lines}</table>`,
    );
    send(res, 200, { mode: 'outbox', previewUrl: `${base}/artist/outbox/${consult.id}?k=${consult.artistToken}` });
  }

  // POST /api/submit/confirm { emailOk, detail }
  async function confirm(req, res) {
    const { consult } = await currentConsult(req);
    const body = await readJson(req);
    const mode = accessKey ? 'web3forms' : 'outbox';
    if (mode === 'web3forms' && body.emailOk !== true) throw new HttpError(400, 'The email was not sent');
    const c = await store.updateConsult(consult.id, (c) => {
      if (c.status !== 'draft') return;
      const missing = missingForSubmit(c);
      if (missing.length) throw new HttpError(400, `Still needed: ${missing.join(', ')}`);
      c.status = 'submitted';
      c.submittedAt = nowIso();
      c.step = 'done';
      c.email = { mode, ok: true, sentAt: nowIso(), detail: String(body.detail ?? '').slice(0, 300) };
    });
    send(res, 200, { consult: publicConsult(c) });
  }

  async function artistConsult(res, id, key) {
    const c = await store.getConsult(id);
    if (!c || !key || key.length !== c.artistToken.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(c.artistToken))) {
      throw new HttpError(404, 'Not found');
    }
    return c;
  }

  async function artistIndex(req, res, key) {
    if (!artistKey || key !== artistKey) throw new HttpError(404, 'Not found');
    const base = originOf(req, publicUrl);
    const list = await store.listConsults();
    const rows = list
      .map(
        (c) => `<tr><td><a href="${base}/artist/c/${c.id}?k=${c.artistToken}">${escapeHtml(c.ref)}</a></td>
        <td>${escapeHtml(c.profile.fullName)}</td><td>${escapeHtml(c.status)}</td><td>${escapeHtml(c.updatedAt)}</td></tr>`,
      )
      .join('');
    send(res, 200, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Consults</title>
<body style="font:15px system-ui;padding:16px;background:#0b0a0d;color:#eee"><h1>Consults</h1><table cellpadding="8">${rows}</table>`);
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname;
    const m = req.method;
    if (m === 'POST' && p === '/api/register') return register(req, res);
    if (m === 'POST' && p === '/api/login') return login(req, res);
    if (m === 'POST' && p === '/api/logout') return logout(req, res);
    if (m === 'GET' && p === '/api/me') return me(req, res);
    if (m === 'POST' && p === '/api/consults') return startAnother(req, res);
    if (m === 'PATCH' && p === '/api/consult') return patchConsult(req, res);
    if (m === 'POST' && p === '/api/uploads') return upload(req, res);
    if (m === 'POST' && p === '/api/snapshot') return snapshot(req, res, url);
    if (m === 'POST' && p === '/api/submit/prepare') return prepare(req, res);
    if (m === 'POST' && p === '/api/submit/confirm') return confirm(req, res);
    let g;
    if (m === 'DELETE' && (g = p.match(/^\/api\/uploads\/([\w-]+)$/))) return deleteUpload(req, res, g[1]);
    if (m === 'GET' && (g = p.match(/^\/api\/files\/([\w-]+)$/))) {
      const { consult } = await currentConsult(req);
      return serveFile(res, consult, g[1]);
    }
    const key = url.searchParams.get('k') ?? '';
    if (m === 'GET' && (g = p.match(/^\/artist\/c\/([\w-]+)$/))) {
      const c = await artistConsult(res, g[1], key);
      return send(res, 200, artistPage(c, originOf(req, publicUrl)), { 'x-robots-tag': 'noindex' });
    }
    if (m === 'GET' && (g = p.match(/^\/artist\/f\/([\w-]+)\/([\w-]+)$/))) {
      const c = await artistConsult(res, g[1], key);
      return serveFile(res, c, g[2]);
    }
    if (m === 'GET' && (g = p.match(/^\/artist\/outbox\/([\w-]+)$/))) {
      const c = await artistConsult(res, g[1], key);
      const html = await fsp.readFile(path.join(store.outboxDir, `${c.id}.html`), 'utf8').catch(() => null);
      if (!html) throw new HttpError(404, 'No preview yet');
      return send(res, 200, html);
    }
    if (m === 'GET' && p === '/artist') return artistIndex(req, res, key);
    return false;
  }

  return {
    store,
    /** Returns true when the request was an API or artist route. */
    async handle(req, res) {
      const p = (req.url ?? '').split('?')[0];
      if (!p.startsWith('/api/') && !p.startsWith('/artist')) return false;
      try {
        const handled = await route(req, res);
        if (handled === false) send(res, 404, { error: 'Not found' });
      } catch (err) {
        const status = err instanceof HttpError ? err.status : 500;
        if (status === 500) console.error('[api]', err);
        if (!res.headersSent) send(res, status, { error: status === 500 ? 'Something went wrong on our side' : err.message });
        else res.destroy();
      }
      return true;
    },
  };
}
