// The render engine: one WebGPU renderer (WebGL2 fallback), two off-screen
// targets for the outgoing and incoming screens, and a final compositing pass
// that does transitions, the freeze-frame grade, blur, grain and vignette.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, texture, screenUV, screenCoordinate, vec2, vec3, vec4, float, mix, smoothstep, length, luminance,
  abs, clamp, pow, If, mx_fractal_noise_float, max, renderOutput, fract, sin, dot,
} from 'three/tsl';

export type TransitionKind = 'ink' | 'push' | 'flash';
const MODE: Record<TransitionKind | 'none', number> = { none: 0, ink: 1, push: 2, flash: 3 };

/** Everything the director needs from one screen of the experience. */
export interface Screen {
  readonly id: string;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  /** Loads assets; must be safe to call repeatedly. */
  preload(): Promise<void>;
  /** Called just before the screen first renders: mount DOM, reset state. */
  enter(): void;
  /** Called as the transition away begins (before any freeze-frame), e.g. to hide DOM overlays. */
  leave?(): void;
  /** Called once the screen is fully gone. */
  exit(): void;
  update(dt: number, t: number): void;
  resize(width: number, height: number): void;
  /** Blur (in pixels) applied to the whole screen while it is showing, e.g. behind a receipt. */
  blur?: number;
  /** Optional custom render into the target (e.g. extra passes such as ambient occlusion). */
  renderTo?(renderer: THREE.WebGPURenderer, target: THREE.RenderTarget): void;
}

const POISSON: [number, number][] = [
  [-0.326, -0.406], [-0.84, -0.074], [-0.696, 0.457], [-0.203, 0.621], [0.962, -0.195], [0.473, -0.48],
  [0.519, 0.767], [0.185, -0.893], [0.507, 0.064], [0.896, 0.412], [-0.322, -0.933], [-0.792, -0.598],
];

export interface Quality {
  /** Upper bound on device pixel ratio for the 3D render. */
  maxPixelRatio: number;
  /** Upper bound on rendered pixels per frame. */
  pixelBudget: number;
  msaa: number;
  shadows: boolean;
  particles: number; // multiplier
}

function detectQuality(): Quality {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as any).deviceMemory ?? 4;
  const low = coarse && (cores <= 4 || mem <= 3);
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'low' || low) return { maxPixelRatio: 1.5, pixelBudget: 1.1e6, msaa: 0, shadows: false, particles: 0.5 };
  if (coarse) return { maxPixelRatio: 2, pixelBudget: 1.9e6, msaa: 4, shadows: true, particles: 0.8 };
  return { maxPixelRatio: 2, pixelBudget: 3.4e6, msaa: 4, shadows: true, particles: 1 };
}

export class Stage {
  readonly renderer: THREE.WebGPURenderer;
  readonly quality = detectQuality();
  readonly backend: 'webgpu' | 'webgl2';
  private pipeline: THREE.RenderPipeline;
  private rtA: THREE.RenderTarget;
  private rtB: THREE.RenderTarget;
  private texA: ReturnType<typeof texture>;
  private texB: ReturnType<typeof texture>;

  readonly u = {
    progress: uniform(0),
    mode: uniform(0),
    freeze: uniform(0),
    time: uniform(0),
    origin: uniform(new THREE.Vector2(0.5, 0.5)),
    aspect: uniform(1),
    blur: uniform(0),
    grain: uniform(0.035),
    vignette: uniform(0.45),
    fade: uniform(1), // 1 = black, 0 = visible
    texel: uniform(new THREE.Vector2(1, 1)),
  };

  active: Screen | null = null;
  incoming: Screen | null = null;
  /** While frozen the outgoing screen stops rendering and its last frame is held. */
  frozen = false;
  /** Dynamic resolution scale, adjusted from measured frame times. */
  private scale = 1;
  private emaDt = 1 / 60;
  private slowFor = 0;
  private fastFor = 0;
  private width = 1;
  private height = 1;
  private lastT = 0;
  private onUpdate: (dt: number, t: number) => void = () => {};
  readonly fps = { value: 60 };

  private constructor(renderer: THREE.WebGPURenderer) {
    this.renderer = renderer;
    this.backend = (renderer.backend as any).isWebGPUBackend ? 'webgpu' : 'webgl2';
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = this.quality.shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const opts = { type: THREE.HalfFloatType, samples: this.quality.msaa, depthBuffer: true };
    this.rtA = new THREE.RenderTarget(1, 1, opts);
    this.rtB = new THREE.RenderTarget(1, 1, opts);
    this.texA = texture(this.rtA.texture);
    this.texB = texture(this.rtB.texture);

    this.pipeline = new THREE.RenderPipeline(renderer);
    this.pipeline.outputNode = this.buildComposite();
  }

  static async create(canvas: HTMLCanvasElement): Promise<Stage> {
    const forceWebGL = new URLSearchParams(location.search).has('webgl');
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, alpha: false, forceWebGL, powerPreference: 'high-performance' });
    await renderer.init();
    const stage = new Stage(renderer);
    stage.resize();
    addEventListener('resize', () => stage.resize());
    visualViewport?.addEventListener('resize', () => stage.resize());
    return stage;
  }

  private buildComposite() {
    const { u, texA, texB } = this;
    return Fn(() => {
      const st = screenUV;
      const asp = vec2(u.aspect, 1);

      // Freeze-frame: a quick punch-in with a warm, crushed, half-desaturated grade.
      const zoom = mix(float(1), float(0.93), u.freeze);
      const uvA = st.sub(0.5).mul(zoom).add(0.5).toVar();

      // Push transition scales the outgoing frame up as it leaves.
      const isPush = abs(u.mode.sub(MODE.push)).lessThan(0.5);
      If(isPush, () => {
        uvA.assign(uvA.sub(0.5).div(float(1).add(u.progress.mul(0.35))).add(0.5));
      });

      const a = vec3(0).toVar();
      If(u.blur.greaterThan(0.01), () => {
        const acc = vec3(0).toVar();
        for (const [x, y] of POISSON) acc.addAssign(texA.sample(uvA.add(vec2(x, y).mul(u.blur).mul(u.texel))).rgb);
        a.assign(acc.div(POISSON.length));
      }).Else(() => {
        a.assign(texA.sample(uvA).rgb);
      });

      const lum = luminance(a);
      const frozen = mix(a, vec3(lum).mul(vec3(1.12, 0.98, 0.84)), 0.72);
      const crushed = pow(max(frozen, vec3(0)), vec3(1.25)).mul(1.15);
      const outA = mix(a, crushed, u.freeze).toVar();

      const col = outA.toVar();
      const p = u.progress;

      // Ink bleed: a noisy front spreads from the tap point, edged in wet black ink and a hot sunset line.
      If(abs(u.mode.sub(MODE.ink)).lessThan(0.5), () => {
        const b = texB.sample(st).rgb;
        const d = length(st.sub(u.origin).mul(asp)).div(max(u.aspect, 1).mul(1.25));
        const n = mx_fractal_noise_float(vec3(st.mul(asp).mul(2.6), u.time.mul(0.12)), 4, 2.0, 0.55);
        const field = d.mul(0.78).add(n.mul(0.22)).add(0.06);
        const edge = p.mul(1.18);
        const showB = float(1).sub(smoothstep(edge.sub(0.012), edge.add(0.012), field));
        const live = smoothstep(0.0, 0.04, p).mul(float(1).sub(smoothstep(0.96, 1.0, p)));
        const rim = float(1).sub(smoothstep(0.0, 0.05, abs(field.sub(edge)))).mul(live);
        const glow = float(1).sub(smoothstep(0.0, 0.01, abs(field.sub(edge).add(0.018)))).mul(live);
        const mixed = mix(outA, b, showB).mul(float(1).sub(rim.mul(0.92)));
        col.assign(mixed.add(vec3(1.0, 0.36, 0.48).mul(glow).mul(1.6)));
      });

      // Push: the next screen settles in from slightly larger, through a soft white bloom.
      If(isPush, () => {
        const uvB = st.sub(0.5).div(mix(float(1.18), float(1), p)).add(0.5);
        const b = texB.sample(uvB).rgb;
        const w = smoothstep(0.3, 0.7, p);
        const flash = pow(float(1).sub(abs(p.mul(2).sub(1))), float(3)).mul(0.55);
        col.assign(mix(outA, b, w).add(vec3(1.0, 0.92, 0.85).mul(flash)));
      });

      // Flash cut: hard cut at the midpoint hidden under a quick white pop.
      If(abs(u.mode.sub(MODE.flash)).lessThan(0.5), () => {
        const b = texB.sample(st).rgb;
        const flash = pow(float(1).sub(abs(p.mul(2).sub(1))), float(6)).mul(1.4);
        col.assign(mix(outA, b, smoothstep(0.49, 0.51, p)).add(vec3(flash)));
      });

      // Film grain and vignette on everything.
      // Fine film grain: per-pixel noise (small arguments keep it precise on phone GPUs),
      // a new pattern every frame, softer in deep shadows so blacks stay clean.
      const frame = u.time.mul(60).floor();
      const gp = screenCoordinate.floor().mod(512).add(vec2(frame.mod(97).mul(5.3), frame.mod(89).mul(3.7)));
      const g = fract(sin(dot(gp, vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5);
      col.addAssign(g.mul(u.grain).mul(smoothstep(0.0, 0.2, luminance(col)).mul(0.7).add(0.3)));
      const v = smoothstep(1.05, 0.25, length(st.sub(0.5).mul(vec2(u.aspect.mul(0.9).min(1.3), 1.15))));
      col.mulAssign(mix(float(1), v, u.vignette));
      col.mulAssign(float(1).sub(u.fade));
      return vec4(clamp(col, 0, 64), 1);
    })();
  }

  get size() {
    return { width: this.width, height: this.height };
  }

  /** Current render resolution relative to the canvas (budget cap × dynamic scale). */
  get renderScale() {
    const pr = Math.min(devicePixelRatio || 1, this.quality.maxPixelRatio);
    return Math.min(1, Math.sqrt(this.quality.pixelBudget / (this.width * this.height * pr * pr))) * this.scale;
  }

  resize() {
    const vw = Math.round(visualViewport?.width ?? innerWidth);
    const vh = fullHeight();
    document.documentElement.style.setProperty('--app-h', `${vh}px`);
    this.width = vw;
    this.height = vh;
    const pr = Math.min(devicePixelRatio || 1, this.quality.maxPixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(vw, vh, true);
    this.applyScale();
    this.u.aspect.value = vw / vh;
    this.active?.resize(vw, vh);
    this.incoming?.resize(vw, vh);
  }

  private applyScale() {
    const pr = Math.min(devicePixelRatio || 1, this.quality.maxPixelRatio);
    const budgetScale = Math.sqrt(this.quality.pixelBudget / (this.width * this.height * pr * pr));
    const s = Math.min(1, budgetScale) * this.scale;
    const w = Math.max(2, Math.floor(this.width * pr * s));
    const h = Math.max(2, Math.floor(this.height * pr * s));
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    this.u.texel.value.set(1 / w, 1 / h);
  }

  /** Lower the render resolution when frames run long; raise it back when there is headroom. */
  private adapt(dt: number) {
    this.emaDt += (dt - this.emaDt) * 0.05;
    this.fps.value = 1 / this.emaDt;
    if (this.emaDt > 1 / 52) {
      this.slowFor += dt;
      this.fastFor = 0;
    } else if (this.emaDt < 1 / 70) {
      this.fastFor += dt;
      this.slowFor = 0;
    } else {
      this.slowFor = Math.max(0, this.slowFor - dt);
      this.fastFor = Math.max(0, this.fastFor - dt);
    }
    if (this.slowFor > 1 && this.scale > 0.55) {
      this.scale = Math.max(0.55, this.scale * 0.85);
      this.slowFor = 0;
      this.applyScale();
    } else if (this.fastFor > 4 && this.scale < 1) {
      this.scale = Math.min(1, this.scale * 1.08);
      this.fastFor = 0;
      this.applyScale();
    }
  }

  setTransition(kind: TransitionKind | 'none', progress = 0) {
    this.u.mode.value = MODE[kind];
    this.u.progress.value = progress;
  }

  /** The incoming screen becomes the active one: swap the targets so its frame stays put. */
  commitTransition() {
    const a = this.rtA;
    this.rtA = this.rtB;
    this.rtB = a;
    this.texA.value = this.rtA.texture;
    this.texB.value = this.rtB.texture;
    this.active = this.incoming;
    this.incoming = null;
    this.setTransition('none');
  }

  start(onUpdate: (dt: number, t: number) => void) {
    this.onUpdate = onUpdate;
    this.renderer.setAnimationLoop((ms) => this.frame(ms / 1000));
  }

  private frame(t: number) {
    const dt = Math.min(0.1, this.lastT ? t - this.lastT : 1 / 60);
    this.lastT = t;
    this.adapt(dt);
    this.u.time.value = t;
    this.onUpdate(dt, t);

    const { renderer } = this;
    this.u.blur.value = this.active?.blur ?? 0;
    const draw = (s: Screen, target: THREE.RenderTarget) => {
      if (s.renderTo) s.renderTo(renderer, target);
      else {
        renderer.setRenderTarget(target);
        renderer.render(s.scene, s.camera);
      }
    };
    if (this.active && !this.frozen) {
      this.active.update(dt, t);
      draw(this.active, this.rtA);
    }
    if (this.incoming) {
      this.incoming.update(dt, t);
      draw(this.incoming, this.rtB);
    }
    renderer.setRenderTarget(null);
    this.pipeline.render();
  }

  /** Renders a scene off-screen at a fixed size and returns a PNG (used for the character snapshot). */
  async snapshot(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number): Promise<Blob> {
    // Render in HDR, then tone-map and encode to sRGB in a second pass, exactly as the screen does.
    const hdr = new THREE.RenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
    const rt = new THREE.RenderTarget(width, height, { type: THREE.UnsignedByteType, depthBuffer: false });
    const material = new THREE.NodeMaterial();
    material.fragmentNode = renderOutput(texture(hdr.texture, screenUV), this.renderer.toneMapping, THREE.SRGBColorSpace);
    const quad = new THREE.QuadMesh(material);
    try {
      this.renderer.setRenderTarget(hdr);
      this.renderer.render(scene, camera);
      this.renderer.setRenderTarget(rt);
      quad.render(this.renderer);
      this.renderer.setRenderTarget(null);
      const pixels = (await this.renderer.readRenderTargetPixelsAsync(rt, 0, 0, width, height)) as Uint8Array;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      const img = ctx.createImageData(width, height);
      // WebGL reads bottom-up; WebGPU reads top-down.
      const flip = this.backend === 'webgl2';
      for (let y = 0; y < height; y++) {
        const src = (flip ? height - 1 - y : y) * width * 4;
        img.data.set(pixels.subarray(src, src + width * 4), y * width * 4);
      }
      ctx.putImageData(img, 0, 0);
      return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('snapshot failed'))), 'image/png'));
    } finally {
      hdr.dispose();
      rt.dispose();
      material.dispose();
    }
  }
}

/**
 * The height to fill. In a browser tab that is the visible page (innerHeight): Chrome and Safari keep
 * their toolbars below it and a page can't draw there. Only an app opened from the home screen gets the
 * whole screen, where iOS can report a shorter innerHeight than the screen; use the screen there.
 */
function fullHeight() {
  const standalone = (navigator as any).standalone === true || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
  if (standalone && innerWidth < innerHeight) return Math.round(Math.max(innerHeight, screen.height));
  return Math.round(innerHeight);
}
