// Works out how the house music loops: each repeat starts a whole number of bars after the
// last, just as the song begins its fade-out, so the fade-out plays over the next opening in
// time and the music never stops. Prints the period for MUSIC.period in src/engine/audio.ts.
//
//   node scripts/music-loop.mjs [file=public/audio/music.m4a]
//
// Assumes a steady tempo in 4/4 (true of most produced tracks; check the printed tempo).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const file = process.argv[2] ?? 'public/audio/music.m4a';
const RATE = 22050;
const N = 1024; // FFT size
const HOP = 128; // ~5.8 ms per onset frame
const FPS = RATE / HOP;

const { stdout } = await run('ffmpeg', ['-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], {
  encoding: 'buffer',
  maxBuffer: 1 << 28,
});
const pcm = new Float32Array(stdout.buffer, stdout.byteOffset, stdout.byteLength >> 2);
const seconds = pcm.length / RATE;

// Spectral flux: how much new energy each frame brings, the usual "onset strength" for beat tracking.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(a * k), wi = Math.sin(a * k);
        const xr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const xi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k + len / 2] = re[i + k] - xr;
        im[i + k + len / 2] = im[i + k] - xi;
        re[i + k] += xr;
        im[i + k] += xi;
      }
    }
  }
}
const window = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
const frames = Math.floor((pcm.length - N) / HOP);
const flux = new Float32Array(frames);
const rms = new Float32Array(frames);
let prev = new Float32Array(N / 2);
for (let f = 0; f < frames; f++) {
  const re = new Float32Array(N), im = new Float32Array(N);
  let e = 0;
  for (let i = 0; i < N; i++) {
    const x = pcm[f * HOP + i];
    re[i] = x * window[i];
    e += x * x;
  }
  rms[f] = Math.sqrt(e / N);
  fft(re, im);
  const mag = new Float32Array(N / 2);
  let s = 0;
  for (let k = 1; k < N / 2; k++) {
    mag[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
    s += Math.max(0, mag[k] - prev[k]);
  }
  flux[f] = s;
  prev = mag;
}
const mean = flux.reduce((a, b) => a + b, 0) / frames;
const onset = flux.map((v) => v - mean);

const corr = (lag) => {
  let s = 0;
  for (let i = 0; i + lag < frames; i++) s += onset[i] * onset[i + lag];
  return s / (frames - lag);
};
// Peak of the autocorrelation near a lag, refined between frames with a parabola.
const peakNear = (lag, span) => {
  let best = lag, bv = -Infinity;
  for (let l = Math.max(1, Math.round(lag - span)); l <= Math.round(lag + span); l++) {
    const v = corr(l);
    if (v > bv) [bv, best] = [v, l];
  }
  const a = corr(best - 1), b = bv, c = corr(best + 1);
  const d = a - 2 * b + c;
  return { lag: best + (d < 0 ? (0.5 * (a - c)) / d : 0), value: bv };
};

// The beat: the strongest periodicity between 70 and 180 BPM.
let beat = 0, bestV = -Infinity;
for (let l = Math.round((60 / 180) * FPS); l <= Math.round((60 / 70) * FPS); l++) {
  const v = corr(l);
  if (v > bestV) [bestV, beat] = [v, l];
}
// Refine it over many beats: an error of one frame shrinks to 1/n of a frame.
let n = 1;
for (let k = 2; (k * beat) / FPS < seconds - 12; k *= 2) {
  const p = peakNear(k * beat, 4);
  beat = p.lag / k;
  n = k;
}
const beatS = beat / FPS;
const bar = beatS * 4;

// Where the song starts to fade: the last moment it is still near its typical loud level.
const second = Math.round(FPS);
const level = [];
for (let f = 0; f + second <= frames; f += Math.round(FPS / 10)) {
  let s = 0;
  for (let i = f; i < f + second; i++) s += rms[i] * rms[i];
  level.push({ t: f / FPS, db: 10 * Math.log10(s / second + 1e-12) });
}
const sorted = level.map((l) => l.db).sort((a, b) => a - b);
const typical = sorted[Math.floor(sorted.length * 0.6)];
const fadeAt = [...level].reverse().find((l) => l.db >= typical - 3).t + 1;

// Repeat on the bar nearest the start of the fade; whole phrases (4 bars) when one is close.
const bars = Math.round(fadeAt / bar);
const phrase = Math.round(fadeAt / bar / 4) * 4;
const chosen = Math.abs(phrase * bar - fadeAt) < bar ? phrase : bars;
const nominal = chosen * bar;

// When a beat falls in a stretch of the song (seconds from the start): slide a comb of beat-spaced
// teeth over the onsets and keep the best fit. Generated and live tracks drift a little, so the
// average tempo alone can put the repeat a fraction of a beat off.
const phaseOf = (from, to) => {
  let best = 0, bv = -Infinity;
  for (let p = 0; p < beat; p += 0.25) {
    let s = 0;
    for (let t = from * FPS + p; t < to * FPS; t += beat) {
      const i = Math.floor(t), w = t - i;
      s += (onset[i] ?? 0) * (1 - w) + (onset[i + 1] ?? 0) * w;
    }
    if (s > bv) [bv, best] = [s, p];
  }
  return from + best / FPS;
};
const wrap = (x) => ((((x + beatS / 2) % beatS) + beatS) % beatS) - beatS / 2;
const lead = 1; // a second of full music before the fade steadies the tail's measurement
const overlap = seconds - nominal;
// Line the outgoing tail's beats up with the opening's beats they will play over.
const correction = wrap(phaseOf(nominal - lead, seconds) - nominal - phaseOf(0, overlap + lead));
const period = nominal + correction;
const open4 = phaseOf(0, 4);
const drift = [];
for (let t = 0; t + 4 <= nominal; t += 4) drift.push((wrap(phaseOf(t, t + 4) - open4) * 1000).toFixed(0));

console.log(`length ${seconds.toFixed(2)} s, tempo ${(60 / beatS).toFixed(3)} BPM (refined over ${n} beats), bar ${bar.toFixed(4)} s`);
console.log(`fade starts near ${fadeAt.toFixed(1)} s; ${chosen} bars at the average tempo = ${nominal.toFixed(4)} s`);
console.log(`beat drift against the opening, every 4 s (ms; a jump of ~${((beatS / 2) * 1000).toFixed(0)} is an off-beat misread): ${drift.join(' ')}`);
console.log(`tail beats land ${(correction * 1000).toFixed(1)} ms from the opening's: repeat every ${period.toFixed(3)} s (overlap ${(seconds - period).toFixed(2)} s)`);
console.log(`check: after the correction the tail is ${(wrap(phaseOf(period - lead, seconds) - period - phaseOf(0, seconds - period + lead)) * 1000).toFixed(1)} ms off`);
