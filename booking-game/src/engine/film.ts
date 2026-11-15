// A real film on the cinema set's screen: the artist's own footage, served with the app. A hidden,
// muted, looping <video> feeds a texture that the set's shader projects onto the visible strip of
// screen (src/engine/cinema.ts withProjector), so it is lit, graded and moved with the photo rather
// than pasted on top. While it loads, the screen in the photo flickers like a projector
// lamp striking up; once it plays, the film fades in and the room shimmers faintly with its light.
// Muted inline video autoplays everywhere (iPhones included, Low Power Mode aside); if it still
// won't start, the screen shows as photographed and every tap asks again.
import * as THREE from 'three/webgpu';
import { projector } from './cinema';
import type { AudioEngine } from './audio';
import type { Sfx } from './sfx';

export interface FilmSpec {
  /** URL of the film file. */
  src: string;
}

/** Where the film rectangle is in the viewport, in CSS pixels. */
export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FIRST_FLICKER = 0.9; // seconds of flicker before the first reveal
const RETURN_FLICKER = 0.4;
const GIVE_UP = 9; // seconds of flicker while waiting before showing the screen as photographed

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export class CinemaFilm {
  private video: HTMLVideoElement | null = null;
  private tex: THREE.VideoTexture | null = null;
  private src = '';
  private wanted = false;
  private revealed = false;
  private everShown = false;
  /** The film has been on screen since play(): no more flicker until the set leaves and returns. */
  private lit = false;
  private flicker = 0; // seconds the current flicker has run
  private waited = 0; // seconds spent waiting for playback
  private step = -1;
  private lampTarget = 1;
  private shimmerTimer = 0;
  private shimmer = 1;
  private time = 0;

  constructor(_audio: AudioEngine, private sfx: Sfx) {
    // If the phone refused to autoplay, any tap is a gesture that lets it start.
    addEventListener('pointerdown', () => {
      if (this.wanted && this.video?.paused) void this.video.play().catch(() => {});
    }, true);
  }

  /** The film file is missing or can't be decoded here; the screen then stays lit as photographed. */
  get failed() {
    return !!this.video?.error;
  }

  private get playing() {
    const v = this.video;
    return !!v && !v.paused && v.readyState >= 3;
  }

  /** The set with this film is coming on screen: load it (or resume it) and strike up the projector. */
  play(spec: FilmSpec, _mask?: string) {
    if (!this.wanted) {
      this.flicker = 0;
      this.waited = 0;
      this.lit = false;
      this.sfx.projector(1.2);
    }
    this.wanted = true;
    if (!this.video || this.src !== spec.src) this.create(spec);
    void this.video!.play().catch(() => {});
  }

  /** The set is leaving the screen: fade the film out and pause it. */
  pause() {
    this.wanted = false;
    this.reveal(false);
    this.video?.pause();
    projector.reset();
  }

  /** Gone for good (the theme screen closed): free the video. */
  destroy() {
    this.pause();
    if (this.video) {
      this.video.removeAttribute('src');
      this.video.load(); // releases the decoder
      this.video.remove();
    }
    this.video = null;
    this.tex?.dispose();
    this.tex = null;
    this.src = '';
  }

  private create(spec: FilmSpec) {
    this.video?.remove();
    this.tex?.dispose();
    const v = document.createElement('video');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.autoplay = true;
    v.preload = 'auto';
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.disablePictureInPicture = true;
    v.setAttribute('aria-hidden', 'true');
    // iOS Safari won't autoplay (or keeps pausing) a video it thinks can't be seen: no opacity 0, no
    // 2px box. So it is a normal, fully opaque little video tucked under the 3D canvas, which covers it.
    v.style.cssText = 'position:fixed;left:0;bottom:0;width:96px;height:54px;z-index:-1;pointer-events:none';
    v.src = spec.src;
    v.addEventListener('loadedmetadata', () => projector.fitFilm(v.videoWidth, v.videoHeight));
    document.body.append(v);
    const tex = new THREE.VideoTexture(v);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    projector.film.value = tex;
    this.video = v;
    this.tex = tex;
    this.src = spec.src;
  }

  private reveal(on: boolean) {
    if (on === this.revealed) return;
    this.revealed = on;
    if (on) this.everShown = this.lit = true;
  }

  /**
   * Every frame: where the film rectangle is now (null when the screen isn't on show) and how visible
   * the film may be (0..1, e.g. fading out during a swipe). Drives the reveal and the projector light.
   */
  frame(dt: number, rect: ViewRect | null, opacity: number) {
    if (this.failed || !this.wanted) return;
    this.time += dt;
    projector.time.value = this.time;
    const playing = this.playing;
    const need = this.everShown ? RETURN_FLICKER : FIRST_FLICKER;
    const show = playing && !!rect && opacity > 0.01 && (this.lit || this.flicker >= need);
    this.reveal(show);
    // The film fades up on the screen like a lamp coming to full, and out with a swipe.
    const target = show ? opacity : 0;
    projector.show.value += (target - projector.show.value) * Math.min(1, dt * 4);
    if (!playing) {
      this.waited += dt;
      // Not playing yet (autoplay refused, slow network): stop the flicker and show the screen as
      // photographed; a tap or a late start still brings the film up.
      if (this.waited > GIVE_UP && !this.lit) this.lit = true;
    }

    const ease = Math.min(1, dt * 8);
    if (this.revealed) {
      // Under the film: the room shimmering faintly as the footage changes.
      projector.lamp.value += (1 - projector.lamp.value) * ease;
      this.shimmerTimer -= dt;
      if (this.shimmerTimer <= 0) {
        this.shimmerTimer = 0.2 + Math.random() * 0.5;
        this.shimmer = 0.965 + Math.random() * 0.05;
      }
      projector.glow.value += (this.shimmer - projector.glow.value) * Math.min(1, dt * 3);
    } else if (this.lit) {
      // Running but hidden mid-swipe: the screen as photographed.
      projector.lamp.value += (1 - projector.lamp.value) * ease;
      projector.glow.value += (1 - projector.glow.value) * ease;
    } else {
      // The projector lamp striking up: uneven bursts of light about 16 times a second.
      this.flicker += dt;
      const step = Math.floor(this.flicker * 16);
      if (step !== this.step) {
        this.step = step;
        const r = hash(step + this.waited * 7);
        this.lampTarget = r < 0.3 ? 0.08 + r * 0.4 : 0.55 + r * 0.6;
      }
      projector.lamp.value = this.lampTarget;
      projector.glow.value = 1 + (this.lampTarget - 1) * 0.08;
    }
  }
}
