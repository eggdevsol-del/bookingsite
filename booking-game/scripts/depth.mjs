// Makes a depth map for each backdrop with Depth Anything V2 (runs locally, on the CPU).
// Near = white, far = black. The map is softened so parallax never tears hard edges.
// Usage: node scripts/depth.mjs [name ...]   (default: every backdrop in public/media)
import { pipeline, RawImage } from '@huggingface/transformers';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const DIR = 'public/media';
const NAMES = process.argv.slice(2);
const all = (await fs.readdir(DIR))
  .filter((f) => f.endsWith('.webp') && !f.endsWith('-depth.webp'))
  .map((f) => f.slice(0, -5))
  .filter((n) => !['wood', 'desk'].includes(n));
const targets = NAMES.length ? NAMES : all;

const estimate = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: 'fp32' });

for (const name of targets) {
  const src = path.join(DIR, `${name}.webp`);
  const { width, height } = await sharp(src).metadata();
  const png = await sharp(src).png().toBuffer();
  const image = await RawImage.fromBlob(new Blob([png], { type: 'image/png' }));
  const { depth } = await estimate(image);
  // depth is a single-channel RawImage at the model's working size; scale back up and soften.
  const raw = Buffer.from(depth.data);
  const out = path.join(DIR, `${name}-depth.webp`);
  await sharp(raw, { raw: { width: depth.width, height: depth.height, channels: 1 } })
    .resize(Math.round(width / 2), Math.round(height / 2), { fit: 'fill' })
    .blur(3)
    .normalise()
    .webp({ quality: 85 })
    .toFile(out);
  console.log(`${out}`);
}
