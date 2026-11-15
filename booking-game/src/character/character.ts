// The 3D client body: photoreal skin, a knitted balaclava, the tattoo-zone
// highlight, breathing, and tap picking. Zones come from regions.ts and are
// evaluated per pixel, so edges are smooth curves that follow the body.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, uniformArray, varying, mix, vec2, vec3, vec4, float, sin, cos, smoothstep, time, color, texture, uv, dot,
  normalView, positionView, positionViewDirection, pow, clamp, hash, int, max, abs, fract, atan, luminance,
  positionGeometry, positionLocal, normalLocal, dFdx, dFdy, cross, normalize, sign, normalMap, select, fwidth,
  faceDirection,
} from 'three/tsl';
import { REGIONS, REGION_INDEX } from '../../shared/catalog.mjs';
import { loadModel } from '../engine/assets';
import { zoneFunction, balaclavaFunction, type Landmarks } from './regions';

export type ModelMeta = Landmarks;

/** Well-separated colour per zone (golden-ratio hues), grey where there is no zone (hands). */
const debugColour = (z: any) => {
  const h = fract(z.mul(0.618034));
  const c = vec3(0.5).add(vec3(0.5).mul(cos(vec3(h, h.add(0.333), h.add(0.667)).mul(6.28318))));
  return select(z.greaterThanEqual(0), c, vec3(0.08));
};

const cache = new Map<string, Promise<Character>>();

export class Character {
  /** Phones in the low tier evaluate one zone sample per pixel instead of five. */
  static supersample = true;

  readonly root = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly selected = new Set<string>();
  readonly u = {
    sel: uniformArray(new Array(REGIONS.length).fill(0), 'float'),
    flash: uniformArray(new Array(REGIONS.length).fill(0), 'float'),
    tintA: uniform(color('#ff3d7f')),
    tintB: uniform(color('#ffa041')),
    strength: uniform(1),
    /** Faint outlines of every zone, so clients can see where one ends and the next begins. */
    zoneLines: uniform(0),
    debug: uniform(0),
    breathe: uniform(1),
  };
  private flashes = new Map<number, number>();
  private skin: THREE.Material;
  private idMaterial: THREE.MeshBasicNodeMaterial;
  private pickScene = new THREE.Scene();
  private pickTarget: THREE.RenderTarget | null = null;

  static load(gender: 'male' | 'female'): Promise<Character> {
    let p = cache.get(gender);
    if (!p) {
      p = Promise.all([loadModel(`/models/${gender}.glb`), fetch(`/models/${gender}.json`).then((r) => r.json())]).then(
        ([scene, meta]) => new Character(scene, meta, gender),
      );
      cache.set(gender, p);
      p.catch(() => cache.delete(gender));
    }
    return p;
  }

  private constructor(scene: THREE.Group, readonly meta: ModelMeta, readonly gender: 'male' | 'female') {
    let found: THREE.Mesh | null = null;
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !found) found = o as THREE.Mesh;
    });
    if (!found) throw new Error('model has no mesh');
    this.mesh = found;
    this.mesh.updateMatrix();
    const { skin, id } = this.buildMaterials(this.mesh.material as THREE.MeshStandardMaterial);
    this.skin = skin;
    this.idMaterial = id;
    this.mesh.material = skin;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.root.add(scene);
  }

  private buildMaterials(src: THREE.MeshStandardMaterial) {
    const { u, meta } = this;
    const zoneOf = zoneFunction(meta);
    const balaclavaOf = balaclavaFunction(meta);
    const hc = vec3(...meta.head.center);

    // Positions in body space (metres, feet at 0, facing +Z), before breathing moves them.
    const meshMatrix = uniform(this.mesh.matrix);
    const pVertex = meshMatrix.mul(vec4(positionGeometry, 1)).xyz;
    const p = varying(pVertex);

    // Breathing swells the ribcage a few millimetres; the balaclava sits ~4 mm proud of the skin.
    const chest = smoothstep(meta.crotchY + 0.1, meta.armpitY, pVertex.y).mul(
      float(1).sub(smoothstep(meta.shoulderY - 0.02, meta.shoulderY + 0.06, pVertex.y)),
    );
    const breath = sin(time.mul(1.15)).mul(0.5).add(0.5);
    const scale = this.mesh.scale.x || 1;
    const lift = chest.mul(breath).mul(0.0035).mul(u.breathe).add(balaclavaOf(pVertex).mul(0.004)).div(scale);
    const positionNode = positionLocal.add(normalLocal.mul(lift));

    const zoneSel = (z: any) => select(z.greaterThanEqual(0), u.sel.element(int(max(z, 0))), float(0));

    // ---------- skin + balaclava ----------
    const m = new THREE.MeshSSSNodeMaterial({ metalness: 0, ior: 1.4 });
    m.positionNode = positionNode;
    const bal = balaclavaOf(p);
    const zone0 = zoneOf(p).toVar();

    // Zone coverage from a rotated-grid 4-tap sample about 2 px wide: anti-aliased, smooth edges,
    // and wide enough to draw a clean stencil line along every marked zone.
    const dx = dFdx(p).mul(2.6);
    const dy = dFdy(p).mul(2.6);
    const taps = Character.supersample
      ? [dx.mul(0.375).add(dy.mul(0.125)), dx.mul(-0.125).add(dy.mul(0.375)), dx.mul(-0.375).sub(dy.mul(0.125)), dx.mul(0.125).sub(dy.mul(0.375))]
      : [];
    const zones = taps.map((o) => zoneOf(p.add(o)));
    const coverage = taps.length ? zones.map(zoneSel).reduce((a: any, b: any) => a.add(b)).div(taps.length) : zoneSel(zone0);
    const zoneEdge = taps.length
      ? zones.map((z: any) => select(abs(z.sub(zone0)).greaterThan(0.5), float(1), float(0))).reduce((a: any, b: any) => a.add(b)).div(taps.length)
      : float(0);

    // Knit: vertical ribs around the head with stitch rows, faded out where too fine to resolve.
    const phi = atan(p.x.sub(hc.x), p.z.sub(hc.z));
    const ribs = phi.mul(90 / (2 * Math.PI));
    const rib = cos(ribs.mul(2 * Math.PI)).mul(0.5).add(0.5);
    const rows = abs(fract(p.y.mul(240)).sub(0.5)).mul(2);
    const knitFade = float(1).sub(smoothstep(0.25, 0.7, fwidth(ribs)));
    const knit = rib.mul(rows.mul(0.35).add(0.65)).mul(knitFade);

    m.colorNode = Fn(() => {
      const tex = texture(src.map!, uv()).rgb;
      // The generated texture is a little bright and flat: settle it into a natural skin range.
      const skin = mix(vec3(luminance(tex)), tex, float(1.06)).mul(0.82);
      const fabric = color('#1c1b1e').mul(knit.mul(0.45).add(0.6));
      const base = mix(skin, fabric, bal);
      // Marked zones look like a tattoo stencil: a translucent ink wash that keeps every pore,
      // edged with a crisp ink line. On the black knit the ink shows as a coloured sheen.
      const ink = mix(u.tintA, u.tintB, smoothstep(0.2, 1.6, p.y));
      const wash = mix(base.mul(mix(vec3(1), ink.mul(1.5), 0.55)), base.add(ink.mul(0.18)), bal);
      const fill = smoothstep(0.5, 1.0, coverage);
      const washed = mix(base, wash, fill.mul(u.strength));
      const line = float(1).sub(abs(coverage.mul(2).sub(1)));
      const lineColour = mix(color('#2a0620'), ink.mul(0.9), bal);
      const lined = mix(washed, lineColour, smoothstep(0.15, 0.6, line).mul(0.92).mul(u.strength));
      const outlined = mix(lined, lined.mul(mix(float(0.55), float(2.2), bal)), zoneEdge.mul(u.zoneLines));
      return mix(outlined, debugColour(zone0), u.debug);
    })();

    m.roughnessNode = mix(texture(src.roughnessMap!, uv()).g.mul(0.72), float(0.92), bal);
    m.specularIntensityNode = mix(float(0.55), float(0.18), bal);
    // Fabric sheen (the soft halo knit gets at grazing angles); none on skin.
    m.sheen = 1;
    m.sheenNode = vec3(bal.mul(0.42));
    m.sheenRoughnessNode = float(0.55);

    // Normals: the model's skin normal map, or a knit bump under the balaclava.
    // The generated normal map is coarse; at full strength it reads as lumpy skin.
    const skinN = src.normalMap ? normalMap(texture(src.normalMap, uv()), vec2(0.5, 0.5)) : normalView;
    const h = knit.mul(0.0011);
    const sx = dFdx(positionView);
    const sy = dFdy(positionView);
    const r1 = cross(sy, normalView);
    const r2 = cross(normalView, sx);
    const det = dot(sx, r1).mul(faceDirection);
    const grad = sign(det).mul(dFdx(h).mul(r1).add(dFdy(h).mul(r2)));
    const knitN = normalize(abs(det).mul(normalView).sub(grad));
    m.normalNode = normalize(mix(skinN, knitN, bal));

    // Subsurface: backlit skin glows warm red where it is thin to the camera: ears, fingers and
    // the silhouette. Without a thickness map, limit it to grazing angles, or the whole torso
    // would glow as if it were as thin as an ear.
    const thin = pow(float(1).sub(clamp(dot(normalView, positionViewDirection), 0, 1)), float(2.5));
    m.thicknessColorNode = color('#ff5a3a').mul(0.18).mul(thin).mul(float(1).sub(bal));
    m.thicknessDistortionNode = float(0.22);
    m.thicknessAmbientNode = float(0);
    m.thicknessAttenuationNode = float(0.5);
    m.thicknessPowerNode = float(3.5);
    m.thicknessScaleNode = float(2.2);

    // Marked zones glow clearly all over (so a front-facing area reads at a glance), brighter at
    // their edges, breathing gently; a flash when one is tapped.
    m.emissiveNode = Fn(() => {
      const fres = pow(float(1).sub(clamp(dot(normalView, positionViewDirection), 0, 1)), float(3));
      const pulse = sin(time.mul(2.4)).mul(0.5).add(0.5);
      const glow = coverage.mul(u.strength).mul(float(0.2).add(fres.mul(0.45)).add(pulse.mul(0.1)));
      const flash = select(zone0.greaterThanEqual(0), u.flash.element(int(max(zone0, 0))), float(0));
      const lit = mix(u.tintA, u.tintB, 0.4).mul(glow.add(flash.mul(0.35)));
      // Debug view: flat, unlit zone colours so the map can be read.
      return mix(lit, debugColour(zone0).mul(0.8), u.debug);
    })();

    // ---------- zone id, for tap picking (same zone function, same shape) ----------
    const id = new THREE.MeshBasicNodeMaterial();
    id.positionNode = positionNode;
    id.colorNode = vec3(zoneOf(p).add(1).div(255), 0, 0);
    return { skin: m, id };
  }

  setSelected(ids: Iterable<string>) {
    this.selected.clear();
    for (const id of ids) if (REGION_INDEX.has(id)) this.selected.add(id);
    const arr = this.u.sel.array as number[];
    arr.fill(0);
    for (const id of this.selected) arr[REGION_INDEX.get(id)!] = 1;
  }

  toggle(id: string): boolean {
    const on = !this.selected.has(id);
    if (on) this.selected.add(id);
    else this.selected.delete(id);
    (this.u.sel.array as number[])[REGION_INDEX.get(id)!] = on ? 1 : 0;
    this.flashes.set(REGION_INDEX.get(id)!, 1);
    return on;
  }

  update(dt: number) {
    const arr = this.u.flash.array as number[];
    for (const [i, k] of this.flashes) {
      const v = Math.max(0, k - dt * 2.2);
      arr[i] = v;
      if (v <= 0) this.flashes.delete(i);
      else this.flashes.set(i, v);
    }
  }

  /** Renders the zone ids (instead of the skin) through `camera` into `target`. */
  private renderIds(renderer: THREE.WebGPURenderer, camera: THREE.Camera, target: THREE.RenderTarget) {
    const parent = this.root.parent;
    this.pickScene.add(this.root);
    this.mesh.material = this.idMaterial;
    try {
      renderer.setRenderTarget(target);
      renderer.render(this.pickScene, camera);
    } finally {
      this.mesh.material = this.skin;
      parent?.add(this.root);
      renderer.setRenderTarget(null);
    }
  }

  /** The zone under a screen point (CSS pixels), read back from the GPU. Null over hands or empty space. */
  async pick(renderer: THREE.WebGPURenderer, camera: THREE.PerspectiveCamera, x: number, y: number, width: number, height: number) {
    this.pickTarget ??= new THREE.RenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: true });
    camera.setViewOffset(width, height, Math.floor(x), Math.floor(y), 1, 1);
    try {
      this.renderIds(renderer, camera, this.pickTarget);
    } finally {
      camera.clearViewOffset();
    }
    const px = (await renderer.readRenderTargetPixelsAsync(this.pickTarget, 0, 0, 1, 1)) as Uint8Array;
    const k = px[0] - 1;
    return k >= 0 ? REGIONS[k]?.id ?? null : null;
  }

  /** Where each visible zone sits on screen (CSS pixels): used by tests and camera helpers. */
  async zoneMap(renderer: THREE.WebGPURenderer, camera: THREE.PerspectiveCamera, width: number, height: number, res = 160) {
    const w = res;
    const h = Math.round((res * height) / width);
    const rt = new THREE.RenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: true });
    try {
      this.renderIds(renderer, camera, rt);
      const px = (await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h)) as Uint8Array;
      const flip = !(renderer.backend as any).isWebGPUBackend;
      const acc = new Map<string, { x: number; y: number; n: number }>();
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          const k = px[(j * w + i) * 4] - 1;
          if (k < 0) continue;
          const zid = REGIONS[k].id;
          const a = acc.get(zid) ?? { x: 0, y: 0, n: 0 };
          a.x += i + 0.5;
          a.y += (flip ? h - 1 - j : j) + 0.5;
          a.n++;
          acc.set(zid, a);
        }
      // The centroid of a curved zone can fall outside it, so report the zone's own pixel
      // nearest its centroid: a point that is guaranteed to be inside the zone.
      const best = new Map<string, { i: number; j: number; d: number }>();
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          const k = px[(j * w + i) * 4] - 1;
          if (k < 0) continue;
          const zid = REGIONS[k].id;
          const a = acc.get(zid)!;
          const jj = (flip ? h - 1 - j : j) + 0.5;
          const d = (i + 0.5 - a.x / a.n) ** 2 + (jj - a.y / a.n) ** 2;
          const b = best.get(zid);
          if (!b || d < b.d) best.set(zid, { i: i + 0.5, j: jj, d });
        }
      const out: Record<string, { x: number; y: number; pixels: number }> = {};
      for (const [zid, a] of acc) {
        const b = best.get(zid)!;
        out[zid] = { x: (b.i / w) * width, y: (b.j / h) * height, pixels: a.n };
      }
      return out;
    } finally {
      rt.dispose();
    }
  }
}
