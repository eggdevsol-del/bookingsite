// Opens one screen in headless Chrome at phone size, screenshots it and reports what happened.
// For checking a scene without clicking through the whole consult (needs `npm run dev`).
//
//   node scripts/probe-scene.mjs "screen=desk" out.png [seconds=6] [--sample "js expression"]
//
// --sample evaluates the expression every 250 ms (with `s` = the active screen) and prints the
// results, e.g. --sample "s.paperLifts().join(',')" to watch the sheets lift.
import puppeteer from 'puppeteer-core';

const [query, out, secs = '6'] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--sample');
const sampleAt = process.argv.indexOf('--sample');
const sample = sampleAt > 0 ? process.argv[sampleAt + 1] : null;

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.emulate({
  viewport: { width: 393, height: 852, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
});
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warn') problems.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:5173/?${query}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (window).__ink?.stage?.active, { timeout: 30000 });
const until = Date.now() + Number(secs) * 1000;
const samples = [];
while (Date.now() < until) {
  if (sample) samples.push(await page.evaluate((e) => { const s = window.__ink.stage.active; try { return String(eval(e)); } catch (x) { return "ERR " + x.message; } }, sample));
  await new Promise((r) => setTimeout(r, 250));
}
await page.screenshot({ path: out });
if (samples.length) console.log('samples:', samples.join(' | '));
console.log(problems.length ? problems.join('\n') : 'no console errors');
await browser.close();
