// Art-direction screenshots of the 3D body screen (dev server must be running).
// Usage: node scripts/shot-body.mjs <label>   → test-output/body-<label>-<gender>-<view>.png
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';

const label = process.argv[2] ?? 'now';
const base = process.env.URL ?? 'http://localhost:5173';
await fs.mkdir('test-output', { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
});
const views = [
  ['front', 0, null],
  ['three-quarter', 0.7, null],
  ['back', Math.PI, null],
  ['closeup', 0.35, { distance: 1.0, targetY: 1.3 }],
];
for (const gender of ['male', 'female']) {
  const page = await browser.newPage();
  await page.emulate({
    viewport: { width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${base}/?screen=body&gender=${gender}&regions=forearm-outer-l,chest-r`);
  await page.waitForFunction(() => window.__ink?.stage.active?.id === 'body' && window.__ink.screen('body').character, { timeout: 60000 });
  await page.evaluate(() => document.querySelector('.hint .btn')?.click());
  if (process.env.ZONES) await page.evaluate(() => (window.__ink.screen('body').character.u.debug.value = 1));
  for (const [name, yaw, extra] of views) {
    await page.evaluate((yaw, extra) => {
      const s = window.__ink.screen('body');
      s['orbit'].flyTo({ yaw, ...(extra ?? {}) });
      s['orbit'].snap();
    }, yaw, extra);
    await new Promise((r) => setTimeout(r, 1500));
    if (process.env.ZONES) {
      // Print each visible zone's name at a point inside it.
      await page.evaluate(async () => {
        document.querySelectorAll('.zone-label').forEach((e) => e.remove());
        const s = window.__ink.screen('body');
        const map = await s.character.zoneMap(window.__ink.stage.renderer, s.camera, innerWidth, innerHeight);
        for (const [id, p] of Object.entries(map)) {
          if (p.pixels < 12) continue;
          const el = document.createElement('div');
          el.className = 'zone-label';
          el.textContent = id;
          Object.assign(el.style, { position: 'fixed', left: `${p.x}px`, top: `${p.y}px`, transform: 'translate(-50%,-50%)', font: '600 7px system-ui', color: '#fff', textShadow: '0 0 2px #000,0 0 2px #000', zIndex: 99, pointerEvents: 'none', whiteSpace: 'nowrap' });
          document.body.append(el);
        }
      });
      await page.evaluate(() => document.querySelectorAll('[data-screen]').forEach((e) => (e.style.opacity = '0')));
    }
    const file = `test-output/body-${label}-${gender}-${name}.png`;
    await page.screenshot({ path: file });
    console.log(file);
  }
  if (errors.length) console.log('errors:', errors.slice(0, 5).join('\n'));
  await page.close();
}
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 4000))]);
process.exit(0);
