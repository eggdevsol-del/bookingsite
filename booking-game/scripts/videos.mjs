// Turns generated clips into seamless, phone-sized loops for public/media.
//
//   node scripts/videos.mjs name[=https://…] [--pingpong] [--full] [--fade=seconds] …
//
// With a URL the clip is downloaded to art-src/raw/<name>.mp4 first; without one the existing
// raw clip is re-encoded. Two loop styles:
//   crossfade (default): the last D seconds dissolve into the first D seconds, so the end flows
//     into the start with no seam and nothing ever plays backwards. Best for water, smoke,
//     flames, foliage. Also writes the loop's first frame as the still (<name>.webp) shown while
//     the video loads, so even that swap is invisible.
//   --pingpong: forward then backward. Only for people idling, where a crossfade would ghost limbs.
//   --full: keep the clip's own width instead of 720 px (the desk plate fills the screen behind
//     crisp 3D paper, so it needs every pixel).
//   --fade: crossfade length (default 2 s); shorter for short clips such as the cinema's 4 s.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import sharp from 'sharp';

const run = promisify(execFile);
const fadeArg = process.argv.find((a) => a.startsWith('--fade='));
const D = fadeArg ? Number(fadeArg.slice(7)) : 2; // crossfade seconds
const STILLS = { profile: 'profile', title: 'title' }; // poster name per clip (themes use their own name)

const args = process.argv.slice(2);
const pingpong = args.includes('--pingpong');
const full = args.includes('--full');
const jobs = args.filter((a) => !a.startsWith('--')).map((a) => a.split(/=(.+)/).slice(0, 2));

async function duration(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(stdout.trim());
}

await Promise.all(
  jobs.map(async ([name, url]) => {
    const raw = `art-src/raw/${name}.mp4`;
    if (url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${name}: download failed (${res.status})`);
      await fs.writeFile(raw, Buffer.from(await res.arrayBuffer()));
    }
    const out = `public/media/${name}-loop.mp4`;
    const T = await duration(raw);
    const L = +(T - D).toFixed(3);
    const pre = `scale=${full ? 'trunc(iw/2)*2' : 720}:-2:flags=lanczos,fps=30,format=yuv420p`;
    const graph = pingpong
      ? `[0:v]${pre},split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1[out]`
      : `[0:v]${pre},split=3[a][b][c];` +
        `[a]trim=start=${L},setpts=PTS-STARTPTS[tail];` +
        `[b]trim=end=${D},setpts=PTS-STARTPTS[head];` +
        `[c]trim=start=${D}:end=${L},setpts=PTS-STARTPTS[mid];` +
        `[tail][head]blend=all_expr='A*(1-T/${D})+B*(T/${D})':shortest=1[x];` +
        `[x][mid]concat=n=2:v=1[out]`;
    await run('ffmpeg', [
      '-v', 'error', '-y', '-i', raw, '-filter_complex', graph, '-map', '[out]', '-an',
      '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '23', '-preset', 'slow',
      '-movflags', '+faststart', out,
    ]);
    if (!pingpong) {
      // The loop starts on the raw clip's frame at L: save it, full resolution, as the still.
      const png = `art-src/raw/${name}-poster.png`;
      await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(L), '-i', raw, '-frames:v', '1', png]);
      const still = STILLS[name] ?? name;
      await sharp(png).resize({ width: 1080 }).webp({ quality: 80, effort: 6 }).toFile(`public/media/${still}.webp`);
    }
    const { size } = await fs.stat(out);
    console.log(`${out}  ${(size / 1048576).toFixed(1)} MB  (${pingpong ? 'ping-pong' : `crossfade, ${L}s loop`})`);
  }),
);
