// Converts the raw generated art in art-src/raw into phone-sized WebP files in public/media.
// Usage: node scripts/images.mjs [name ...]   (default: every job)
// Careful: sets with a film loop get their still from scripts/videos.mjs (the loop's first frame);
// re-running those here would replace it with the raw art and the swap to video would jump.
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const SRC = 'art-src/raw';
const OUT = 'public/media';

// name in public/media -> [source file, max width, quality]
const JOBS = {
  title: ['title.jpg', 1080, 80],
  profile: ['profile.jpg', 1080, 78],
  gender: ['gender-balaclava-a.jpg', 1080, 82],
  atm: ['atm-a.jpg', 1200, 82],
  wood: ['wood.jpg', 1024, 82],
  'theme-japanese': ['theme-japanese.jpg', 1080, 80],
  'theme-portraits': ['theme-portraits.jpg', 1080, 80],
  'theme-renaissance': ['theme-renaissance.jpg', 1080, 80],
  'theme-illustrative': ['theme-illustrative.jpg', 1080, 80],
  'theme-popculture': ['theme-popculture.jpg', 1080, 82], // the old curtained cinema; a live film plays behind the curtains
  'theme-mythology': ['theme-mythology.jpg', 1080, 80],
  'theme-religious': ['theme-religious.jpg', 1080, 80],
  'theme-floral': ['theme-floral.jpg', 1080, 80],
  'theme-wildlife': ['theme-wildlife.jpg', 1080, 80],
  'theme-cultural': ['theme-cultural.jpg', 1080, 80],
};

await fs.mkdir(OUT, { recursive: true });
const only = process.argv.slice(2);
for (const [name, [file, width, quality]] of Object.entries(JOBS)) {
  if (only.length && !only.includes(name)) continue;
  const src = path.join(SRC, file);
  try {
    await fs.access(src);
  } catch {
    console.warn(`skip ${name}: ${src} missing`);
    continue;
  }
  const out = path.join(OUT, `${name}.webp`);
  const info = await sharp(src).resize({ width, withoutEnlargement: true }).webp({ quality, effort: 6 }).toFile(out);
  console.log(`${out}  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(0)} KB`);
}
