// Downloads the generated ambience beds and encodes them, with the house music, for the web:
// loudness-matched (EBU R128) so every scene sits at the same level before the
// mixer's per-scene gains, AAC in .m4a (decodes on iOS, Android and desktop).
//
//   node scripts/audio.mjs            download anything missing, then encode all
//   node scripts/audio.mjs --encode   re-encode from art-src/raw/audio only
//
// Seams are handled at runtime (src/engine/audio.ts crossfades overlapping copies of a bed, and
// repeats the music on the beat: see scripts/music-loop.mjs), so the files are encoded whole.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';

const run = promisify(execFile);

// name → Morphic asset URL (generation ids are logged in art-src/generations.json), or null for a
// file supplied by hand into art-src/raw/audio/<name>.mp3.
const SOUNDS = {
  music: null, // "Pulse of the Deep", P Mason's own track (made with Suno)
  'amb-studio': 'https://mcp.morphic.com/m/034xt1Z5A2cKOeHawdUnQh',
  'amb-study': 'https://mcp.morphic.com/m/034xscU6eJh00OL9wQVysi',
  'amb-garden': 'https://mcp.morphic.com/m/034xscVdtEJOrzDD9MEBAw',
  'amb-portraits': 'https://mcp.morphic.com/m/034xscXkhwqSVeTJcmZets',
  'amb-renaissance': 'https://mcp.morphic.com/m/034xt1hxd5rckS3qk1ICO2',
  'amb-attic': 'https://mcp.morphic.com/m/034xt1bLvEO8XLkcgNWcrm',
  'amb-cinema': 'https://mcp.morphic.com/m/034xsceNIKePEcxL4mETTl',
  'amb-mythology': 'https://mcp.morphic.com/m/034xscgVffWvDhlPBgW6dG',
  'amb-cathedral': 'https://mcp.morphic.com/m/034xt1cij992Zj4EYh4QYj',
  'amb-glasshouse': 'https://mcp.morphic.com/m/034xscjxXnLXMxsLxHIdAq',
  'amb-forest': 'https://mcp.morphic.com/m/034xscm5Kv3ixPqXSZRwHq',
  'amb-museum': 'https://mcp.morphic.com/m/034xscneibnY71dg1otofX',
  'amb-street': 'https://mcp.morphic.com/m/034xscpoMdXwUZnlblLCPe',
  'amb-fan': 'https://mcp.morphic.com/m/034xscs1W9C5mx0NY8lnpr',
  'amb-photo': 'https://mcp.morphic.com/m/034xt1f0ewG3BUcQg98yuU',
};

const encodeOnly = process.argv.includes('--encode');
await fs.mkdir('art-src/raw/audio', { recursive: true });
await fs.mkdir('public/audio', { recursive: true });

const exists = (p) => fs.access(p).then(() => true, () => false);

await Promise.all(
  Object.entries(SOUNDS).map(async ([name, url]) => {
    const raw = `art-src/raw/audio/${name}.mp3`;
    if (!encodeOnly && !(await exists(raw))) {
      if (!url) throw new Error(`${name}: put the source file at ${raw}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${name}: download failed (${res.status})`);
      await fs.writeFile(raw, Buffer.from(await res.arrayBuffer()));
    }
    const music = name === 'music';
    // Music a little louder than the beds; the mixer balances them per scene.
    const target = music ? -16 : -22;
    // Two passes: measure, then apply one fixed gain (linear) so quiet details stay quiet.
    const { stderr } = await run('ffmpeg', ['-hide_banner', '-i', raw, '-af', `loudnorm=I=${target}:TP=-2:LRA=20:print_format=json`, '-f', 'null', '-']);
    const from = stderr.lastIndexOf('{');
    const m = JSON.parse(stderr.slice(from, stderr.indexOf('}', from) + 1));
    const filter = `loudnorm=I=${target}:TP=-2:LRA=20:linear=true:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}`;
    await run('ffmpeg', [
      '-loglevel', 'error', '-y', '-i', raw,
      '-vn', '-map_metadata', '-1', // no cover art or tags (titles, ids) in the served copy
      '-af', filter,
      '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', music ? '128k' : '96k',
      '-movflags', '+faststart', `public/audio/${name}.m4a`,
    ]);
    const { size } = await fs.stat(`public/audio/${name}.m4a`);
    console.log(`${name}: ${(size / 1024).toFixed(0)} KB, source ${m.input_i} LUFS`);
  }),
);
