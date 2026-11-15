// Theme select: swipe through photographic sets. Each set has real depth, so a
// swipe is a parallax dolly (near objects travel further than far ones) with
// a soft wipe, and every set has its own atmosphere (petals, embers, dust).
import * as THREE from 'three/webgpu';
import { Fn, uniform, uv, vec2, vec4, float, texture, mix, smoothstep, select, clamp, abs, sign, mx_noise_float, mx_fractal_noise_float, vec3, luminance, length, max } from 'three/tsl';
import { coverUV } from '../engine/backdrop';
import { projector, withProjector, type ScreenSpec } from '../engine/cinema';
import { CinemaFilm, type FilmSpec, type ViewRect } from '../engine/film';
import { themeScape, themeBed } from '../content/soundscapes';
import type { Soundscape } from '../engine/audio';
import { BaseScreen } from './base';
import { Particles } from '../engine/particles';
import { loadTexture, loadVideo, media, playVideo } from '../engine/assets';
import { h, tween, easeOut } from '../ui/dom';
import { THEMES } from '../../shared/catalog.mjs';
import type { App } from '../app/context';

type Theme = (typeof THEMES)[number];
const BLANK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLANK.needsUpdate = true;

/** The set's film loop (a still shows until it can play). */
export function themeVideo(theme: Theme) {
  if ((theme as { film?: boolean }).film === false) return Promise.reject(new Error('still set'));
  return loadVideo(media(`${theme.image}-loop.mp4`));
}

/** Seconds for the ink to spread from one set to the next. */
const SWAP = 0.55;

type Screened = { screen?: ScreenSpec; reel?: FilmSpec };

export async function themeTextures(theme: Theme) {
  const [color, depth] = await Promise.all([
    loadTexture(media(`${theme.image}.webp`)),
    loadTexture(media(`${theme.image}-depth.webp`), { color: false }),
  ]);
  return { color, depth };
}

class SlideBackdrop {
  readonly mesh: THREE.Mesh;
  readonly u = {
    slide: uniform(0),
    offset: uniform(new THREE.Vector2()),
    zoom: uniform(1.07),
    imageAspect: uniform(1080 / 1935),
    viewAspect: uniform(1),
    time: uniform(0),
    /** 1 when the set in that slot has the cinema screen. */
    screenOnA: uniform(0),
    screenOnB: uniform(0),
  };
  readonly colorA = texture(BLANK);
  readonly depthA = texture(BLANK);
  readonly colorB = texture(BLANK);
  readonly depthB = texture(BLANK);

  constructor(private distance = 50) {
    const { u, colorA, depthA, colorB, depthB } = this;
    const m = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false });
    m.colorNode = Fn(() => {
      const ratio = u.viewAspect.div(u.imageAspect);
      const b = uv();
      const fitted = select(ratio.greaterThan(1), vec2(b.x, b.y.sub(0.5).div(ratio).add(0.5)), vec2(b.x.sub(0.5).mul(ratio).add(0.5), b.y));
      const base = fitted.sub(0.5).div(u.zoom).add(0.5);
      const k = abs(u.slide);
      const s = sign(u.slide);
      const look = u.offset.mul(0.035);
      // A gentle push in the direction of travel (near things move more), under the ink.
      const DRIFT = 0.1;
      const dA = depthA.sample(base).r;
      const uvA = base.add(vec2(s.mul(k).mul(dA.mul(0.5).add(0.22)).mul(DRIFT), 0)).add(look.mul(dA.sub(0.35)));
      const dB = depthB.sample(base).r;
      const uvB = base.sub(vec2(s.mul(float(1).sub(k)).mul(dB.mul(0.5).add(0.22)).mul(DRIFT), 0)).add(look.mul(dB.sub(0.35)));
      const a0 = colorA.sample(clamp(uvA, 0.001, 0.999)).rgb;
      const c0 = colorB.sample(clamp(uvB, 0.001, 0.999)).rgb;
      // The cinema set's screen follows its projector (image coordinates have the top at 0).
      const a = withProjector(a0, vec2(uvA.x, float(1).sub(uvA.y)), u.screenOnA);
      const c = withProjector(c0, vec2(uvB.x, float(1).sub(uvB.y)), u.screenOnB);
      // The same ink bleed as the change from the title to the next screen (src/engine/stage.ts): a
      // noisy front spreads from the side the new set comes in, edged in wet black ink and a hot
      // sunset line.
      const asp = vec2(u.viewAspect, 1);
      const origin = vec2(select(s.greaterThan(0), float(1.05), float(-0.05)), 0.5);
      // Distance across the screen (0 at the entry side, about 1 at the far side), whatever its shape.
      const d = length(vec2(b.x.sub(origin.x), b.y.sub(0.5).mul(0.6))).div(1.12);
      const n = mx_fractal_noise_float(vec3(b.mul(asp).mul(2.6), u.time.mul(0.12)), 4, 2.0, 0.55);
      const field = d.mul(0.78).add(n.mul(0.22)).add(0.06);
      const edge = k.mul(1.18);
      const showB = float(1).sub(smoothstep(edge.sub(0.012), edge.add(0.012), field));
      const live = smoothstep(0.0, 0.04, k).mul(float(1).sub(smoothstep(0.96, 1.0, k)));
      const rim = float(1).sub(smoothstep(0.0, 0.05, abs(field.sub(edge)))).mul(live);
      const glow = float(1).sub(smoothstep(0.0, 0.01, abs(field.sub(edge).add(0.018)))).mul(live);
      const on = select(k.greaterThan(0.001), float(1), float(0));
      const mixed = mix(a, c, showB.mul(on)).mul(float(1).sub(rim.mul(0.92).mul(on)));
      return vec4(mixed.add(vec3(1.0, 0.36, 0.48).mul(glow).mul(1.6).mul(on)), 1);
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }

  /** Brightness of the current set at a screen point (drives the beam dust). */
  lightAt(st: any) {
    const { u } = this;
    return luminance(this.colorA.sample(clamp(coverUV(st, u.viewAspect, u.imageAspect, u.zoom), 0.001, 0.999)).rgb);
  }

  fit(camera: THREE.PerspectiveCamera) {
    const hgt = 2 * this.distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    this.mesh.position.set(0, 0, -this.distance);
    this.mesh.scale.set(hgt * camera.aspect, hgt, 1);
    this.u.viewAspect.value = camera.aspect;
  }
}

export class ThemeScreen extends BaseScreen {
  readonly id = 'theme' as const;
  private bg = new SlideBackdrop();
  private index = 0;
  private target: number | null = null;
  private particles: Particles | null = null;
  private beamDust: Particles | null = null;
  /** The previous set's effects, fading out while the new set's fade in. */
  private fading: Particles[] = [];
  private nameEl: HTMLElement | null = null;
  private dots: HTMLElement | null = null;
  private drag: { x: number; t: number; dir: number } | null = null;
  private animating = false;
  private playing = new Map<string, HTMLVideoElement>();
  /** The cinema set's live film, when a set with one is on screen. */
  private film: CinemaFilm;
  private filmOn = false;

  constructor(app: App) {
    super(app, 40);
    this.camera.add(this.bg.mesh);
    this.film = new CinemaFilm(app.audio, app.sfx);
  }

  protected soundscape(): Soundscape {
    return themeScape(THEMES[this.index].id);
  }

  protected async load() {
    const chosen = this.app.store.consult?.theme;
    this.index = Math.max(0, THEMES.findIndex((t) => t.id === chosen));
    const { color, depth } = await themeTextures(THEMES[this.index]);
    this.bg.colorA.value = color;
    this.bg.depthA.value = depth;
    this.animate(this.index, 'A');
    this.setScreen('A', this.index);
    this.setParticles(THEMES[this.index]);
    // The rest stream in behind the first set.
    for (const t of THEMES) void themeTextures(t).catch(() => {});
  }

  protected onEnter() {
    this.app.store.set({ step: 'theme' });
    for (const v of this.playing.values()) playVideo(v);
    this.setScreen('A', this.index);
  }

  protected onLeave() {
    // The film is a page element, not part of the 3D frame: get it out of the way before the freeze-frame.
    this.film.pause();
  }

  protected onExit() {
    for (const v of this.playing.values()) v.pause();
    this.film.destroy();
    this.filmOn = false;
  }

  protected render() {
    this.nameEl = h('div', { class: 'theme-name', 'aria-live': 'polite' });
    this.dots = h('div', { class: 'dots', 'aria-hidden': 'true' }, ...THEMES.map(() => h('i')));
    const zone = h('div', {
      class: 'live',
      style: { position: 'absolute', inset: '0', touchAction: 'none' },
      onpointerdown: (e: PointerEvent) => this.onDown(e),
      onpointermove: (e: PointerEvent) => this.onMove(e),
      onpointerup: (e: PointerEvent) => this.onUp(e),
      onpointercancel: (e: PointerEvent) => this.onUp(e),
    });
    const root = h(
      'section',
      { class: 'theme-screen' },
      zone,
      h('div', { style: { position: 'absolute', top: 'var(--top)', left: 'var(--pad)', right: 'var(--pad)' } }, h('span', { class: 'kicker' }, 'Choose your theme'), h('p', { class: 'lede' }, 'Swipe through the sets. Pick the world your tattoo belongs to.')),
      h(
        'div',
        { class: 'swipe-hint' },
        h('button', { class: 'live', 'aria-label': 'Previous theme', onclick: () => void this.go(-1) }, '‹'),
        h('button', { class: 'live', 'aria-label': 'Next theme', onclick: () => void this.go(1) }, '›'),
      ),
      this.nameEl,
      this.dots,
      h('button', { class: 'btn btn--block live', style: { position: 'relative' }, onclick: () => void this.next() }, 'Continue'),
    );
    this.showName(false);
    return root;
  }

  private showName(animate: boolean) {
    const t = THEMES[this.index];
    this.nameEl?.replaceChildren(h('h2', { class: `title${animate ? ' swap' : ''}` }, t.label));
    this.dots?.querySelectorAll('i').forEach((d, i) => d.classList.toggle('is-on', i === this.index));
  }

  /** A box that just fills the view between 3 and 6 m, so no particle is wasted off screen. */
  private viewBox() {
    const z = 4.5;
    const h = 2 * z * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.15;
    return { center: new THREE.Vector3(0, 0, -z), size: new THREE.Vector3(h * this.camera.aspect, h, 3) };
  }

  private setParticles(theme: Theme) {
    // The old set's petals, snow or dust don't stop dead: they fade out over the new set's fading in.
    for (const p of [this.particles, this.beamDust]) if (p) this.fading.push(p);
    const q = this.app.stage.quality.particles;
    const p = theme.particles;
    this.particles = null;
    this.beamDust = null;
    if (!p) return;
    this.particles = new Particles({
      kind: p.kind as any,
      color: p.color,
      count: Math.round(p.count * q),
      wind: p.wind as [number, number],
      box: this.viewBox(),
    });
    this.particles.u.opacity.value = 0;
    this.camera.add(this.particles.object);
    this.beamDust = null;
    const beams = (theme as { beams?: { count: number; color: string } }).beams;
    if (beams) {
      // Airborne dust that only shows inside the set's light beams.
      this.beamDust = new Particles({
        kind: 'dust',
        color: beams.color,
        count: Math.round(beams.count * q),
        wind: [0.012, 0.018],
        box: this.viewBox(),
        size: 0.017,
        light: (st) => this.bg.lightAt(st),
      });
      this.beamDust.u.opacity.value = 0;
      this.camera.add(this.beamDust.object);
    }
  }

  /** Fades the current effects in and the previous set's out (about 0.9 s each way). */
  private fadeParticles(dt: number) {
    const k = Math.min(1, dt / 0.9);
    for (const p of [this.particles, this.beamDust]) if (p) p.u.opacity.value = Math.min(1, p.u.opacity.value + k);
    this.fading = this.fading.filter((p) => {
      p.u.opacity.value -= k;
      if (p.u.opacity.value > 0) return true;
      this.camera.remove(p.object);
      return false;
    });
  }

  /** Swaps a slot's still for the set's film once it can play; only the shown sets play. */
  private animate(i: number, slot: 'A' | 'B') {
    const theme = THEMES[i];
    themeVideo(theme)
      .then(({ video, texture }) => {
        const wanted = slot === 'A' ? this.index === i : this.target === i;
        if (!wanted) return;
        (slot === 'A' ? this.bg.colorA : this.bg.colorB).value = texture;
        this.playing.set(theme.id, video);
        playVideo(video);
      })
      .catch(() => {});
  }

  /** Pause every film except the sets currently on screen. */
  private syncPlayback() {
    const keep = new Set([THEMES[this.index].id, this.target !== null ? THEMES[this.target].id : '']);
    for (const [id, v] of this.playing) {
      if (keep.has(id)) continue;
      v.pause();
      this.playing.delete(id);
    }
  }

  /** Marks whether a slot's set has the cinema screen, and starts or pauses its film to match. */
  private setScreen(slot: 'A' | 'B', i: number | null) {
    const scr = i === null ? undefined : (THEMES[i] as Screened).screen;
    const u = this.bg.u;
    (slot === 'A' ? u.screenOnA : u.screenOnB).value = scr ? 1 : 0;
    if (scr) void projector.load(scr).catch(() => {});
    this.syncScreens();
  }

  /** The set on screen (in either slot) that has a live film, if any. */
  private filmSet() {
    const u = this.bg.u;
    for (const [on, i] of [[u.screenOnA.value, this.index], [u.screenOnB.value, this.target]] as const) {
      const t = on && i !== null ? (THEMES[i] as Screened) : null;
      if (t?.reel) return t;
    }
    return null;
  }

  private syncScreens() {
    const set = this.filmSet();
    const film = !!set?.reel && !!set.screen && !this.film.failed;
    if (film) this.film.play({ src: media(set!.reel!.src) }, media(set!.screen!.mask));
    else if (this.filmOn) this.film.pause();
    this.filmOn = film;
  }

  /**
   * Where a set's screen is on the page right now (CSS pixels), following the same cover fit, zoom,
   * gyro parallax and swipe dolly the backdrop shader applies (see SlideBackdrop), for slot A.
   */
  private screenRect(r: ScreenSpec, slide: number): ViewRect {
    const { u } = this.bg;
    const { width: W, height: H } = this.app.stage.size;
    const ratio = u.viewAspect.value / u.imageAspect.value;
    const zoom = u.zoom.value;
    const d = r.depth ?? 0;
    const k = Math.abs(slide);
    const dx = Math.sign(slide) * k * (d * 0.5 + 0.22) + u.offset.value.x * 0.035 * (d - 0.35);
    const dy = u.offset.value.y * 0.035 * (d - 0.35);
    const toView = (ix: number, iyTop: number) => {
      const fx = (ix - dx - 0.5) * zoom + 0.5;
      const fy = (1 - iyTop - dy - 0.5) * zoom + 0.5;
      const bx = ratio > 1 ? fx : (fx - 0.5) / ratio + 0.5;
      const by = ratio > 1 ? (fy - 0.5) * ratio + 0.5 : fy;
      return [bx * W, (1 - by) * H];
    };
    const [x0, y0] = toView(r.left, r.top);
    const [x1, y1] = toView(r.right, r.bottom);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  private async prepare(dir: number) {
    const ni = (this.index + dir + THEMES.length) % THEMES.length;
    this.target = ni;
    const { color, depth } = await themeTextures(THEMES[ni]);
    if (this.target !== ni) return false;
    this.bg.colorB.value = color;
    this.bg.depthB.value = depth;
    this.setScreen('B', ni);
    this.animate(ni, 'B');
    this.app.audio.preload([themeBed(THEMES[ni].id)]);
    return true;
  }

  private async go(dir: number) {
    if (this.animating) return;
    this.animating = true;
    try {
      if (!(await this.prepare(dir))) return;
      this.app.sfx.whoosh(0.7);
      // The ambience crossfades over the same time as the picture.
      this.app.audio.scene(themeScape(THEMES[this.target!].id), SWAP);
      const from = this.bg.u.slide.value;
      await tween(SWAP, (k) => (this.bg.u.slide.value = from + (dir - from) * k), (k) => k * k * (3 - 2 * k));
      this.settle();
    } finally {
      this.animating = false;
    }
  }

  private settle() {
    this.index = this.target!;
    this.target = null;
    this.bg.colorA.value = this.bg.colorB.value;
    this.bg.depthA.value = this.bg.depthB.value;
    this.bg.u.slide.value = 0;
    this.setScreen('A', this.index);
    this.setScreen('B', null);
    this.syncPlayback();
    this.setParticles(THEMES[this.index]);
    this.showName(true);
    this.app.sfx.tick();
  }

  private onDown(e: PointerEvent) {
    if (this.animating) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    this.drag = { x: e.clientX, t: performance.now(), dir: 0 };
  }

  private onMove(e: PointerEvent) {
    if (!this.drag || this.animating) return;
    const dx = e.clientX - this.drag.x;
    const dir = dx < 0 ? 1 : -1;
    if (Math.abs(dx) < 6) return;
    if (dir !== this.drag.dir) {
      this.drag.dir = dir;
      void this.prepare(dir);
    }
    this.bg.u.slide.value = THREE.MathUtils.clamp(-dx / innerWidth, -1, 1) * 1.1;
  }

  private onUp(e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    if (!d || this.animating) return;
    const dx = e.clientX - d.x;
    const v = Math.abs(dx) / Math.max(1, performance.now() - d.t);
    if (d.dir !== 0 && (Math.abs(dx) > innerWidth * 0.22 || v > 0.5)) {
      void this.go(d.dir);
    } else if (this.bg.u.slide.value !== 0) {
      const from = this.bg.u.slide.value;
      void tween(0.35, (k) => (this.bg.u.slide.value = from * (1 - k)), easeOut).then(() => {
        this.target = null;
        this.setScreen('B', null);
      });
    }
  }

  private async next() {
    if (this.animating) return;
    const theme = THEMES[this.index];
    this.app.sfx.tick();
    this.app.store.set({ theme: theme.id });
    void this.app.store.flush().catch(() => {});
    await this.app.director.show(this.app.screen('idea'), {
      kind: 'ink',
      origin: [0.5, 0.15],
      freeze: { name: theme.label, tape: 'Theme locked in', lines: ['Good choice.'], hold: 1.5 },
    });
  }

  update(dt: number, t: number) {
    const { look } = this.app;
    this.bg.u.offset.value.set(look.value.x, look.value.y);
    for (const ps of [this.particles, this.beamDust, ...this.fading]) ps?.u.look.value.copy(look.value);
    this.fadeParticles(dt);
    this.bg.u.time.value = t;
    this.bg.u.zoom.value = 1.07 + Math.sin(t * 0.08) * 0.01;
    if (this.filmOn) {
      if (this.film.failed) return this.syncScreens(); // the screen stays lit white, as photographed
      // The film shows only over slot A's screen, once this screen has finished transitioning in,
      // and fades out in the first quarter of a swipe away.
      const set = THEMES[this.index] as Screened;
      const slide = this.bg.u.slide.value;
      const here = !!set.reel && !!set.screen && this.app.stage.active === this;
      const rect = here ? this.screenRect(set.screen!, slide) : null;
      const k = Math.min(1, Math.abs(slide) / 0.25);
      this.film.frame(dt, rect, 1 - k * k * (3 - 2 * k));
    }
  }

  protected onResize() {
    this.bg.fit(this.camera);
  }
}
