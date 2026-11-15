// Synthesised one-shots: UI ticks, transition whooshes, the freeze-frame slam,
// ATM key beeps, the receipt printer, paper and the cinema projector. They play
// through the AudioEngine's effects bus, so each lands in the current scene's room.
import type { AudioEngine } from './audio';

export class Sfx {
  constructor(private audio: AudioEngine) {}

  /** Must run inside a user gesture on iOS. */
  unlock() {
    this.audio.unlock();
  }

  private get ok() {
    const { ctx, fx } = this.audio;
    return ctx && fx && !this.audio.muted && ctx.state === 'running' ? { ctx, out: fx } : null;
  }

  private noise(ctx: AudioContext, seconds: number) {
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  tick() {
    const a = this.ok;
    if (!a) return;
    const { ctx, out } = a;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1800, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.05);
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.07);
    o.connect(g).connect(out);
    o.start();
    o.stop(ctx.currentTime + 0.08);
  }

  whoosh(duration = 0.9) {
    const a = this.ok;
    if (!a) return;
    const { ctx, out } = a;
    const n = this.noise(ctx, duration);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.9;
    f.frequency.setValueAtTime(300, ctx.currentTime);
    f.frequency.exponentialRampToValueAtTime(2600, ctx.currentTime + duration * 0.6);
    f.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + duration * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    n.connect(f).connect(g).connect(out);
    n.start();
  }

  /** Freeze-frame hit: a low thump with a camera-shutter click on top. */
  slam() {
    const a = this.ok;
    if (!a) return;
    const { ctx, out } = a;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.35);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g).connect(out);
    o.start();
    o.stop(t + 0.5);
    const n = this.noise(ctx, 0.06);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    n.connect(hp).connect(ng).connect(out);
    n.start();
  }

  beep(freq = 1250, length = 0.09) {
    const a = this.ok;
    if (!a) return;
    const { ctx, out } = a;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.setValueAtTime(0.08, ctx.currentTime + length - 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + length);
    o.connect(g).connect(out);
    o.start();
    o.stop(ctx.currentTime + length + 0.02);
  }

  /** Thermal printer: a buzzing chatter for the given seconds. */
  printer(seconds = 1.6) {
    const a = this.ok;
    if (!a) return;
    const { ctx, out } = a;
    const n = this.noise(ctx, seconds);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2200;
    f.Q.value = 3;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < seconds * 22; i++) {
      const at = t + i / 22;
      g.gain.setValueAtTime(0.32, at);
      g.gain.setValueAtTime(0.06, at + 0.025);
    }
    g.gain.setValueAtTime(0, t + seconds);
    n.connect(f).connect(g).connect(out);
    n.start();
  }

  /** One faint crackle of a paper edge lifting in moving air; `amount` (0..1) sets how loud. */
  rustle(amount: number) {
    const a = this.ok;
    if (!a || amount < 0.04) return;
    const { ctx, out } = a;
    const n = this.noise(ctx, 0.08);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2500 + Math.random() * 3500;
    f.Q.value = 1.4;
    const g = ctx.createGain();
    const t = ctx.currentTime + Math.random() * 0.03;
    const peak = Math.min(0.1, amount * 0.1) * (0.4 + Math.random() * 0.6);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + Math.random() * 0.03);
    n.connect(f).connect(g).connect(out);
    n.start(t);
  }

  /** A sheet landing on the desk: a soft slap of air and a short rustle. */
  paperDrop() {
    const a = this.ok;
    if (!a) return;
    const { ctx, out } = a;
    const t = ctx.currentTime;
    const n = this.noise(ctx, 0.35);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(400, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    n.connect(lp).connect(g).connect(out);
    n.start(t);
    for (let i = 0; i < 3; i++) window.setTimeout(() => this.rustle(0.5), 40 + i * 45);
  }

  /** A film projector clattering into life: 24 shutter clicks a second over a rising motor whirr. */
  projector(seconds = 1.2) {
    const a = this.ok;
    if (!a) return;
    const { ctx, out } = a;
    const t = ctx.currentTime;
    const n = this.noise(ctx, seconds);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    const clicks = Math.floor(seconds * 24);
    for (let i = 0; i < clicks; i++) {
      const at = t + i / 24 + Math.random() * 0.004;
      const level = 0.08 * Math.min(1, (i + 1) / 8) * Math.min(1, (clicks - i) / 8);
      g.gain.setValueAtTime(level, at);
      g.gain.exponentialRampToValueAtTime(0.002, at + 0.018);
    }
    n.connect(bp).connect(g).connect(out);
    n.start(t);
    const motor = ctx.createOscillator();
    motor.type = 'sawtooth';
    motor.frequency.setValueAtTime(70, t);
    motor.frequency.linearRampToValueAtTime(96, t + seconds * 0.6);
    const ml = ctx.createBiquadFilter();
    ml.type = 'lowpass';
    ml.frequency.value = 300;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(0.0001, t);
    mg.gain.exponentialRampToValueAtTime(0.05, t + 0.3);
    mg.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    motor.connect(ml).connect(mg).connect(out);
    motor.start(t);
    motor.stop(t + seconds + 0.05);
  }
}
