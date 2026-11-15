// Plays the whole consult on an emulated iPhone in headless Chrome (WebGPU),
// screenshotting every screen into test-output/. Run with the dev server up:
//   npm run dev        (in one terminal)
//   node scripts/e2e.mjs [--webgl] [--url http://localhost:5173]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const base = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://localhost:5173';
const webgl = args.includes('--webgl');
// --mock-email: catch the browser's request to Web3Forms, check it, and answer "sent" without emailing anyone.
const mockEmail = args.includes('--mock-email');
let emailPayload = null;
const out = 'test-output';
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.emulate({
  viewport: { width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
});
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warn') problems.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
if (mockEmail) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (!req.url().startsWith('https://api.web3forms.com/')) return void req.continue();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, accept', 'access-control-allow-methods': 'POST' };
    if (req.method() === 'OPTIONS') return void req.respond({ status: 204, headers: cors });
    emailPayload = JSON.parse(req.postData() || '{}');
    req.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ success: true, message: 'mocked by e2e' }) });
  });
}

const t0 = Date.now();
const log = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${s}`);
let shot = 0;
const snap = async (name) => {
  const file = path.join(out, `${String(++shot).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  const fps = await page.evaluate(() => window.__ink?.stage.fps.value.toFixed(0));
  log(`screenshot ${file}  (${fps} fps)`);
};
const until = async (fn, what, ms = 30000, ...a) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await page.evaluate(fn, ...a).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out waiting for ${what}`);
};
const onScreen = (id) => until((id) => window.__ink?.stage.active?.id === id && !window.__ink.director.busy, `screen ${id}`, 40000, id);
const tapEl = async (selector) => {
  await page.waitForSelector(selector, { visible: true, timeout: 15000 });
  await page.tap(selector);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await page.goto(`${base}/?hud${webgl ? '&webgl' : ''}`, { waitUntil: 'domcontentloaded' });
  await until(() => !!window.__ink, 'boot', 60000);
  log(`booted on ${await page.evaluate(() => window.__ink.stage.backend)}`);
  await sleep(2200);
  await snap('title');

  // Start consult → profile
  await tapEl('.menu__item');
  await onScreen('profile');
  await sleep(1200);
  await snap('profile');
  const stamp = Date.now();
  await page.type('input[name=fullName]', 'Sarah Jones');
  await page.type('input[name=email]', `test+${stamp}@example.com`);
  await page.type('input[name=phone]', '021 555 0199');
  await page.$eval('input[name=dob]', (el) => {
    el.value = '1996-04-12';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.type('input[name=password]', `test-${stamp}`);
  await page.$eval('input[name=consent]', (el) => (el.checked = true));
  await snap('profile-filled');
  await tapEl('form button[type=submit]');
  await sleep(700);
  await snap('freeze-name-card');
  await onScreen('gender');
  await sleep(1500);
  await snap('gender');

  // Pick female → body
  await page.tap('.gender-pick:nth-child(2)');
  await onScreen('body');
  await sleep(1500);
  await snap('body-hint');
  await tapEl('.hint .btn');
  await sleep(800);
  // Tap a few zones at points the zone shader itself reports for them.
  const tapRegion = async (id) => {
    const p = await page.evaluate(async (id) => {
      const s = window.__ink.screen('body');
      const map = await s.character.zoneMap(window.__ink.stage.renderer, s.camera, innerWidth, innerHeight);
      return map[id];
    }, id);
    if (!p) throw new Error(`zone ${id} not visible`);
    await page.touchscreen.tap(p.x, p.y);
    await sleep(450);
    const got = await page.evaluate(() => [...window.__ink.screen('body').character.selected]);
    log(`tap ${id}: ${got.includes(id) ? 'ok' : `MISSED (selected: ${got.join(', ')})`}`);
  };
  for (const id of ['chest-r', 'stomach', 'thigh-front-l']) await tapRegion(id);
  await sleep(600);
  const picked = await page.evaluate(() => [...window.__ink.screen('body').character.selected]);
  log(`body areas picked: ${picked.join(', ')}`);
  await snap('body-selected');
  await tapEl('.chip:nth-child(2)'); // Back view
  await sleep(1400);
  await snap('body-back');
  await tapEl('.body-bottom .btn');
  await sleep(600);
  await snap('freeze-areas');
  await onScreen('theme');
  await sleep(1500);
  await snap('theme-1');

  // Swipe to the next theme twice.
  for (let i = 0; i < 2; i++) {
    await page.tap('.swipe-hint button:nth-child(2)');
    await sleep(1300);
  }
  await snap('theme-3');
  await tapEl('.theme-screen > .btn');
  await onScreen('idea');
  await sleep(1500);
  await snap('idea');
  await page.type('.idea-box textarea', 'A realistic koi swimming up through cherry blossoms, black and grey with a touch of red.');
  await sleep(400);
  await snap('idea-typed');
  await tapEl('.idea-box .btn');
  await onScreen('desk');
  await sleep(2500);
  await snap('desk-blank');

  // Upload three references in one go.
  const input = await page.$('.desk-screen input[type=file]');
  await input.uploadFile('art-src/raw/theme-japanese.jpg', 'art-src/raw/theme-floral.jpg', 'art-src/raw/man-a.jpg', 'art-src/raw/theme-wildlife.jpg');
  await until(() => document.querySelectorAll('.file-pill').length === 4 && !document.querySelector('.desk-screen .btn--ghost:disabled') && /Continue$/.test(document.querySelectorAll('.desk-screen .btn')[1]?.textContent ?? ''), 'uploads', 60000);
  await sleep(2500);
  await snap('desk-papers');
  await tapEl('.desk-screen .btn:not(.btn--ghost)');
  await onScreen('summary');
  await sleep(2500);
  await snap('summary');

  await tapEl('.summary-screen .btn-row .btn:not(.btn--ghost)');
  await sleep(500);
  await snap('freeze-budget');
  await onScreen('atm');
  await sleep(1500);
  await snap('atm');
  for (const k of ['2', '5', '0', '0']) {
    await page.tap(`[data-key="${k}"]`);
    await sleep(180);
  }
  await snap('atm-typed');
  await page.tap('[data-key="enter"]');
  await page.waitForSelector('.receipt', { timeout: 30000 });
  await sleep(2200);
  await snap('receipt');
  const receipt = await page.$eval('.receipt', (el) => el.innerText);
  log(`receipt:\n${receipt}`);
  if (mockEmail) {
    if (!emailPayload) throw new Error('no request reached Web3Forms');
    const envKey = (await fs.readFile('.env', 'utf8').catch(() => '')).match(/^WEB3FORMS_ACCESS_KEY=(.*)$/m)?.[1]?.trim();
    const { access_key, ...fields } = emailPayload;
    log(`email request: access key ${access_key && access_key === envKey ? 'matches .env' : 'DOES NOT match .env'}`);
    for (const [k, v] of Object.entries(fields)) log(`  ${k}: ${String(v).replace(/\n/g, ' | ').slice(0, 160)}`);
  }
} catch (err) {
  log(`FAILED: ${err.message}`);
  await snap('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  if (problems.length) log(`console problems:\n  ${[...new Set(problems)].slice(0, 30).join('\n  ')}`);
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
  process.exit(process.exitCode ?? 0);
}
