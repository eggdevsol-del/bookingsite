// Renders a flat layout guide of the desk from the exact camera the 3D scene uses
// (shared/desk-plate.mjs). The guide was given to an image model to paint the desk plate,
// so the filmed desk lines up with the 3D sheets.
//
//   node scripts/desk-guide.mjs out.png
import puppeteer from 'puppeteer-core';
import { DESK_PLATE } from '../shared/desk-plate.mjs';
const out = process.argv[2];
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1920 });
await page.setContent('<canvas id=c width=1080 height=1920 style="display:block"></canvas>');
const info = await page.evaluate((plate) => {
  const W = 1080, H = 1920, aspect = W / H;
  const CAM = plate.camera;
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const f = norm(sub(CAM.look, CAM.pos));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const t = Math.tan((CAM.vfov * Math.PI) / 360);
  const P = (p) => { const d = sub(p, CAM.pos); const z = dot(d, f); return [((dot(d, r) / z / (t * aspect)) + 1) / 2 * W, (1 - dot(d, u) / z / t) / 2 * H]; };
  const g = document.getElementById('c').getContext('2d');
  const poly = (pts, fill) => { g.beginPath(); pts.map(P).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fillStyle = fill; g.fill(); };
  const rect = (x0, x1, z0, z1, y = 0) => [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];
  // Dark panelled room behind.
  const bg = g.createLinearGradient(0, 0, 0, H * 0.4); bg.addColorStop(0, '#0b0807'); bg.addColorStop(1, '#1c120d');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // Desk: front face, then top, leather inlay, gold border.
  poly([[-0.85, 0, 0.36], [0.85, 0, 0.36], [0.85, -0.06, 0.36], [-0.85, -0.06, 0.36]], '#24110a');
  g.fillStyle = '#050303'; const [, yb] = P([0, -0.06, 0.36]); g.fillRect(0, yb, W, H - yb);
  poly(rect(-0.85, 0.85, -0.55, 0.36), '#4a2414');
  poly(rect(-0.775, 0.775, -0.475, 0.285), '#1d4a2b');
  g.strokeStyle = '#b8933f'; g.lineWidth = 3; g.beginPath(); rect(-0.762, 0.762, -0.462, 0.272).map(P).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
  // Warm pool of lamplight from the upper left, falling off to dark.
  const [lx, ly] = P([-0.06, 0, -0.06]);
  const pool = g.createRadialGradient(lx, ly, 0, lx, ly, 760); pool.addColorStop(0, 'rgba(255,190,120,0.35)'); pool.addColorStop(0.55, 'rgba(255,160,90,0.08)'); pool.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = pool; g.fillRect(0, 0, W, H);
  const pts = { inlayFarL: P([-0.775, 0, -0.475]), inlayFarR: P([0.775, 0, -0.475]), inlayNearL: P([-0.775, 0, 0.285]), inlayNearR: P([0.775, 0, 0.285]), deskFar: P([0, 0, -0.55]), deskNear: P([0, 0, 0.36]), centre: P([0, 0, -0.05]) };
  // Visible half-width of the desk at a few depths for a 9:16 frame and a 0.46 phone.
  const widths = [-0.4, -0.2, 0, 0.2].map((z) => { const d = sub([0, 0, z], CAM.pos); const zc = dot(d, f); return [z, +(zc * t * aspect).toFixed(3), +(zc * t * 0.46).toFixed(3)]; });
  return { pts, widths };
}, DESK_PLATE);
await (await page.$('#c')).screenshot({ path: out });
console.log(JSON.stringify(info));
await browser.close();
