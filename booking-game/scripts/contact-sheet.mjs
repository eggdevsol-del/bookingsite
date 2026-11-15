import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
const [dir, out, ...names] = process.argv.slice(2);
const W = 300, H = 534, cols = Math.min(names.length, 5);
const rows = Math.ceil(names.length / cols);
const tiles = await Promise.all(names.map(async (n, i) => ({
  input: await sharp(path.join(dir, n)).resize(W, H, { fit: 'cover' }).toBuffer(),
  left: (i % cols) * W, top: Math.floor(i / cols) * H,
})));
await sharp({ create: { width: cols * W, height: rows * H, channels: 3, background: '#000' } }).composite(tiles).jpeg({ quality: 80 }).toFile(out);
console.log(out);
