// Scene sound. The house music plays from the first touch to the receipt, looping without a break; every set
// has a looping ambience bed under it, and each scene has its own synthesised
// room (reverb) that taps, whooshes and beeps play into: a tap in the cathedral rings for seconds, a tap
// in the study stays dry. One AudioContext owns it all; nothing plays until the
// first touch (browsers require a gesture), and it all goes quiet when the app
// is hidden or the sound button is off.

/** The acoustics of a space. */
export interface Room {
  /** Seconds for the tail to fall 60 dB. */
  decay: number;
  /** Seconds before the first reflection: bigger rooms, longer gap. */
  predelay: number;
  /** How much of each sound goes into the room (0..1). */
  wet: number;
  /** Brightness of the tail in Hz: stone and glass ring bright, carpet and curtains are dark. */
  damp: number;
}

export interface Bed {
  /** File name in /audio without the extension. */
  id: string;
  gain: number;
}

export interface Soundscape {
  beds: Bed[];
  room: Room;
}

const FADE = 2.2; // seconds for scene changes
const MARGIN = 0.06; // seconds skipped at each end of a bed (codec padding)
const SEAM = 2.5; // seconds each loop copy overlaps the next
const KEEP = 5; // decoded beds kept in memory (about 8 MB each)
/**
 * Overall levels. music 0 switches the house music off entirely (it isn't even downloaded);
 * ambience scales every scene's beds; effects scales taps, whooshes, beeps and paper sounds.
 */
const LEVELS = { music: 0.5, ambience: 0.2, effects: 0.15 };
const MUSIC_GAIN = LEVELS.music;
/**
 * The house music, "Pulse of the Deep". `period`: seconds from one start to the next, 40 bars at 139 BPM
 * measured by scripts/music-loop.mjs (re-run it for a new track). Each repeat starts as the song begins to
 * fade, so the fade-out plays over the next opening, on the beat, and the music never stops.
 */
const MUSIC = { url: '/audio/music.m4a', period: 68.86 };
const STORE_KEY = 'ink.sound';

const curve = (f: (x: number) => number) => Float32Array.from({ length: 64 }, (_, i) => f(i / 63));
// Equal-power: two uncorrelated recordings crossfaded this way keep the same loudness throughout.
const RISE = curve((x) => Math.sin((x * Math.PI) / 2));
const FALL = curve((x) => Math.cos((x * Math.PI) / 2));

/**
 * Plays a buffer forever by overlapping copies. An ambience bed starts somewhere random and each copy
 * crossfades into the next with equal power, so the seam is never heard. A song (`period` given) plays
 * whole from the top, and each repeat starts `period` seconds after the last, over the song's own fade-out.
 */
class LoopVoice {
  private timer = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private stopped = false;

  constructor(private ctx: AudioContext, private buffer: AudioBuffer, private out: AudioNode, private period = 0) {}

  start() {
    const at = this.ctx.currentTime + 0.03;
    if (this.period) return this.play(at, 0, false);
    const end = this.buffer.duration - MARGIN;
    // Start somewhere random, so coming back to a scene never replays the same opening.
    const from = MARGIN + Math.random() * Math.max(0, end - MARGIN - SEAM * 3);
    this.play(at, from, false);
  }

  private play(at: number, from: number, fadeIn: boolean) {
    if (this.stopped) return;
    const { ctx } = this;
    const song = this.period > 0;
    at = Math.max(at, ctx.currentTime + 0.02);
    const length = song ? this.buffer.duration : this.buffer.duration - MARGIN - from;
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    const g = ctx.createGain();
    if (fadeIn) {
      g.gain.setValueAtTime(0, at);
      g.gain.setValueCurveAtTime(RISE, at, SEAM);
    }
    if (!song) g.gain.setValueCurveAtTime(FALL, at + length - SEAM, SEAM);
    src.connect(g).connect(this.out);
    src.start(at, from, length);
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      g.disconnect();
    };
    const nextAt = song ? at + this.period : at + length - SEAM;
    const arm = () => {
      // While the context is suspended (app hidden) its clock stands still: wait rather than pile up copies.
      if (ctx.state !== 'running') return void (this.timer = window.setTimeout(arm, 500));
      this.play(nextAt, song ? 0 : MARGIN, !song);
    };
    this.timer = window.setTimeout(arm, Math.max(0, (nextAt - ctx.currentTime - 1.5) * 1000));
  }

  stop(at: number) {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const s of this.sources) {
      try {
        s.stop(at);
      } catch {
        /* already stopped */
      }
    }
  }
}

/** A synthetic impulse response: decaying noise that darkens as it fades, plus a few early reflections. */
function impulse(ctx: BaseAudioContext, r: Room) {
  const rate = ctx.sampleRate;
  const pre = Math.floor(r.predelay * rate);
  const n = pre + Math.ceil(r.decay * 1.05 * rate);
  const buf = ctx.createBuffer(2, n, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / rate;
      const env = Math.pow(10, (-3 * t) / r.decay);
      const fc = r.damp * Math.pow(0.3, t / r.decay) + 250;
      lp += (1 - Math.exp((-2 * Math.PI * fc) / rate)) * (Math.random() * 2 - 1 - lp);
      d[i] = lp * env;
    }
    for (let k = 0; k < 7; k++) {
      const at = pre + Math.floor(rate * (0.002 + Math.random() * (r.predelay * 1.6 + 0.01)));
      if (at < n) d[at] += (Math.random() < 0.5 ? -1 : 1) * 0.5 * Math.pow(0.82, k);
    }
  }
  return buf;
}

const sameRoom = (a: Room | null, b: Room) => !!a && a.decay === b.decay && a.predelay === b.predelay && a.damp === b.damp;

interface Layer {
  id: string;
  gain: GainNode;
  pan: StereoPannerNode;
  voice: LoopVoice | null;
  level: number;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  /** One-shot effects connect here: they play dry and into the current room. */
  fx: GainNode | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicSend: GainNode | null = null;
  private beds: GainNode | null = null;
  private fxSend: GainNode | null = null;
  private rooms: { conv: ConvolverNode; level: GainNode; room: Room | null }[] = [];
  private live = 0;
  private irs = new Map<string, AudioBuffer>();
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private layers = new Map<string, Layer>();
  private music: Promise<void> | null = null;
  private wanted: Soundscape | null = null;
  private ducked = 1;
  private listeners = new Set<(on: boolean) => void>();
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem(STORE_KEY) === 'off';
    } catch {
      /* private mode: sound defaults on */
    }
    document.addEventListener('visibilitychange', () => this.applyRunning());
  }

  /** Must run inside a user gesture (iOS and Safari only start audio from one). */
  unlock() {
    if (!this.ctx) this.build();
    if (!this.ctx) return;
    this.startMusic();
    this.applyRunning();
  }

  get unlocked() {
    return !!this.ctx;
  }

  private build() {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx: AudioContext = new AC({ latencyHint: 'playback' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    // A gentle limiter so stacked beds, music and effects never clip on phone speakers.
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -6;
    limit.knee.value = 6;
    limit.ratio.value = 8;
    limit.attack.value = 0.005;
    limit.release.value = 0.25;
    this.master.connect(limit).connect(ctx.destination);

    const roomIn = ctx.createGain();
    for (let i = 0; i < 2; i++) {
      const conv = ctx.createConvolver();
      const level = ctx.createGain();
      level.gain.value = 0;
      roomIn.connect(level).connect(conv).connect(this.master);
      this.rooms.push({ conv, level, room: null });
    }
    this.fx = ctx.createGain();
    this.fx.gain.value = LEVELS.effects;
    this.fx.connect(this.master);
    this.fxSend = ctx.createGain();
    this.fx.connect(this.fxSend).connect(roomIn);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);
    this.musicSend = ctx.createGain();
    this.musicBus.connect(this.musicSend).connect(roomIn);
    this.beds = ctx.createGain();
    this.beds.gain.value = LEVELS.ambience;
    this.beds.connect(this.master);
    if (this.wanted) this.scene(this.wanted);
    this.startMusic();
  }

  /** Runs only while the app is visible, unlocked and not muted. */
  private applyRunning() {
    const ctx = this.ctx;
    if (!ctx) return;
    const run = !document.hidden && !this.muted;
    if (run && ctx.state !== 'running') void ctx.resume().catch(() => {});
    if (!run && ctx.state === 'running') void ctx.suspend().catch(() => {});
  }

  setMuted(off: boolean) {
    this.muted = off;
    try {
      localStorage.setItem(STORE_KEY, off ? 'off' : 'on');
    } catch {
      /* not remembered: fine */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(off ? 0 : 1, this.ctx.currentTime, 0.05);
    this.applyRunning();
    for (const f of this.listeners) f(!off);
  }

  /** Called with true/false whenever sound is switched on or off. */
  onToggle(f: (on: boolean) => void) {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  /** Decodes a bed once; keeps the few most recent in memory. */
  private buffer(id: string) {
    let p = this.buffers.get(id);
    if (p) {
      this.buffers.delete(id); // re-insert: most recently used last
      this.buffers.set(id, p);
      return p;
    }
    const ctx = this.ctx!;
    p = fetch(`/audio/${id}.m4a`)
      .then((r) => {
        if (!r.ok) throw new Error(`${id}: ${r.status}`);
        return r.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data));
    p.catch(() => this.buffers.delete(id));
    this.buffers.set(id, p);
    for (const key of this.buffers.keys()) {
      if (this.buffers.size <= KEEP) break;
      if (!this.layers.has(key)) this.buffers.delete(key);
    }
    return p;
  }

  /** Warm the decoder for beds that are about to be needed (e.g. the next theme). */
  preload(ids: string[]) {
    if (!this.ctx) return;
    for (const id of ids) void this.buffer(id).catch(() => {});
  }

  /** Crossfades to a scene's beds, room and music. Safe to call before unlock: it applies on unlock. */
  scene(s: Soundscape, fade = FADE) {
    this.wanted = s;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const keep = new Set(s.beds.map((b) => b.id));
    for (const [id, layer] of this.layers) {
      if (keep.has(id)) continue;
      this.ramp(layer.gain.gain, 0, fade);
      layer.voice?.stop(now + fade + 0.1);
      this.layers.delete(id);
      window.setTimeout(() => {
        layer.gain.disconnect();
        layer.pan.disconnect();
      }, (fade + 0.3) * 1000);
    }
    for (const b of s.beds) {
      let layer = this.layers.get(b.id);
      if (!layer) {
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const pan = ctx.createStereoPanner();
        pan.connect(gain).connect(this.beds!);
        layer = { id: b.id, gain, pan, voice: null, level: b.gain };
        this.layers.set(b.id, layer);
        const l = layer;
        this.buffer(b.id)
          .then((buf) => {
            if (this.layers.get(b.id) !== l) return; // the scene moved on while it decoded
            l.voice = new LoopVoice(ctx, buf, l.pan);
            l.voice.start();
            this.ramp(l.gain.gain, l.level * this.ducked, fade);
          })
          .catch(() => {});
      } else if (layer.voice) this.ramp(layer.gain.gain, b.gain * this.ducked, fade);
      layer.level = b.gain;
    }
    this.setRoom(s.room, fade);
  }

  /** Pans a live bed, -1 (left) to 1 (right). */
  pan(id: string, value: number) {
    const l = this.layers.get(id);
    if (l && this.ctx) l.pan.pan.setTargetAtTime(value, this.ctx.currentTime, 0.1);
  }

  /** Ducks every bed and the music (0..1 of normal), e.g. while a film plays with sound. */
  duck(level: number) {
    if (!this.ctx) return;
    this.ducked = level;
    for (const l of this.layers.values()) if (l.voice) this.ramp(l.gain.gain, l.level * level, 1);
    this.ramp(this.musicBus!.gain, MUSIC_GAIN * level, 1);
  }

  private setRoom(room: Room, fade: number) {
    const ctx = this.ctx!;
    const cur = this.rooms[this.live];
    this.fxSend!.gain.setTargetAtTime(room.wet, ctx.currentTime, fade / 4);
    // The music gets a little of the room too, so it sounds like it is in the space, not on top of it.
    this.musicSend!.gain.setTargetAtTime(room.wet * 0.3, ctx.currentTime, fade / 4);
    if (sameRoom(cur.room, room)) return;
    const key = `${room.decay}/${room.predelay}/${room.damp}`;
    let ir = this.irs.get(key);
    if (!ir) {
      ir = impulse(ctx, room);
      this.irs.set(key, ir);
    }
    this.live = 1 - this.live;
    const next = this.rooms[this.live];
    next.conv.buffer = ir;
    next.room = room;
    this.ramp(next.level.gain, 1, fade * 0.6);
    this.ramp(cur.level.gain, 0, fade * 0.6);
  }

  /**
   * Decodes the music and starts it (fading in), once. It is decoded rather than streamed so every repeat
   * can be scheduled to the sample: a media element's own loop leaves a gap and can't overlap the fade-out.
   */
  private startMusic() {
    const ctx = this.ctx;
    if (!ctx || this.music || LEVELS.music === 0) return; // music 0: switched off, never downloaded
    this.music = fetch(MUSIC.url)
      .then((r) => {
        if (!r.ok) throw new Error(`music: ${r.status}`);
        return r.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data))
      .then((buf) => {
        new LoopVoice(ctx, buf, this.musicBus!, MUSIC.period).start();
        this.ramp(this.musicBus!.gain, MUSIC_GAIN * this.ducked, FADE);
      })
      .catch(() => {
        this.music = null; // try again on the next unlock (e.g. it was offline)
      });
  }

  private ramp(p: AudioParam, to: number, seconds: number) {
    const now = this.ctx!.currentTime;
    if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(now);
    else {
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
    }
    p.linearRampToValueAtTime(to, now + seconds);
  }
}
