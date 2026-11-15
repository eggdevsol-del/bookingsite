// Cuts the curtain mask for the cinema set: the part of the screen you can see between the red
// curtains (the bright white area of the still). The live film is laid out as a full 16:9 screen
// centred on that strip, mostly hidden behind the curtains, and this mask shows only the strip.
//
//   node scripts/cinema-mask.mjs
//
// Writes public/media/theme-popculture-screen.png (grey + alpha, both = visible screen, covering
// exactly the film rectangle: the 3D view reads the grey, the page's CSS mask reads the alpha) and prints the rectangle and its depth for shared/catalog.mjs.
import sharp from 'sharp';

const SRC = 'art-src/raw/theme-popculture.jpg';
// The set plays a film loop made from this still, which can sit a pixel or two off it, so the mask
// grows by GROW pixels (the film then just covers the screen's edges) and the rectangle gets PAD.
const GROW = 5;
const PAD = 8;
const DEPTH = 'public/media/theme-popculture-depth.webp';
const OUT = 'public/media/theme-popculture-screen.png';
// Where to look for the screen (image fractions), and how white a pixel must be to count.
const SEARCH = { x0: 0.12, x1: 0.32, y0: 0.3, y1: 0.52 };
const MIN_LUMA = 175;
const MAX_CHROMA = 40;

const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const white = (x, y) => {
  const i = (y * W + x) * 3;
  const r = data[i], g = data[i + 1], b = data[i + 2];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > MIN_LUMA && Math.max(r, g, b) - Math.min(r, g, b) < MAX_CHROMA;
};
// Per row, the longest run of white (small gaps from haze bridged). Thin highlights on the curtain
// edges and the valance fringe make short runs; the screen makes one long run.
const runs = [];
for (let y = Math.floor(SEARCH.y0 * H); y < SEARCH.y1 * H; y++) {
  let best = [0, -1], start = -1, gap = 0;
  for (let x = Math.floor(SEARCH.x0 * W); x < SEARCH.x1 * W; x++) {
    if (white(x, y)) {
      if (start < 0) start = x;
      gap = 0;
      if (x - start > best[1] - best[0]) best = [start, x];
    } else if (start >= 0 && ++gap > 4) start = -1;
  }
  runs.push([y, ...best]);
}
const widest = Math.max(...runs.map(([, a, b]) => b - a));
const screenRows = runs.filter(([, a, b]) => b - a > widest * 0.5);
const lit = new Uint8Array(W * H);
let top = H, bottom = 0, left = W, right = 0;
for (const [y, a, b] of screenRows) {
  for (let x = a; x <= b; x++) lit[y * W + x] = 1;
  top = Math.min(top, y);
  bottom = Math.max(bottom, y);
  left = Math.min(left, a);
  right = Math.max(right, b);
}

// Grow the visible strip a little in every direction.
const grown = new Uint8Array(W * H);
for (let y = top - GROW; y <= bottom + GROW; y++)
  for (let x = left - GROW; x <= right + GROW; x++) {
    let hit = 0;
    for (let dy = -GROW; dy <= GROW && !hit; dy++)
      for (let dx = -GROW; dx <= GROW && !hit; dx++) if (dx * dx + dy * dy <= GROW * GROW && lit[(y + dy) * W + x + dx]) hit = 1;
    grown[y * W + x] = hit;
  }
lit.set(grown);
top -= PAD;
bottom += PAD;

// The film: 16:9, as tall as the visible screen, centred on the strip.
const h = bottom - top + 1;
const w = Math.round((h * 16) / 9);
const cx = (left + right) / 2;
const fx0 = Math.round(cx - w / 2);
const mask = Buffer.alloc(w * h * 2);
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const ix = fx0 + x;
    if (ix >= 0 && ix < W && lit[(top + y) * W + ix]) mask.fill(255, (y * w + x) * 2, (y * w + x) * 2 + 2);
  }
await sharp(mask, { raw: { width: w, height: h, channels: 2 } }).blur(1.6).png({ compressionLevel: 9 }).toFile(OUT);

// Depth of the visible screen, for gyro parallax.
const d = await sharp(DEPTH).greyscale().raw().toBuffer({ resolveWithObject: true });
let sum = 0, n = 0;
for (let y = Math.floor((top / H) * d.info.height); y < (bottom / H) * d.info.height; y++)
  for (let x = Math.floor((left / W) * d.info.width); x < (right / W) * d.info.width; x++) {
    sum += d.data[y * d.info.width + x];
    n++;
  }
const f = (v) => +v.toFixed(4);
console.log(`${OUT}  ${w}x${h}`);
console.log(`screen: { left: ${f(fx0 / W)}, right: ${f((fx0 + w) / W)}, top: ${f(top / H)}, bottom: ${f((bottom + 1) / H)}, depth: ${f(sum / n / 255)} }`);
console.log(`visible strip: x ${f(left / W)}..${f(right / W)}`);
