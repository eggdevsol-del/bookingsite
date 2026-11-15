// Sheets of paper as small cloth simulations (position-based dynamics), made
// stiff like real paper. A sheet lies still until the fan points at it; then
// only the edge facing the fan lifts a few millimetres and trembles, and it
// settles again as the fan sweeps away. Friction with the desk and a soft
// tether to where each sheet was laid keep it in place. New sheets float down
// onto the desk with the photo already printed on them.
import * as THREE from 'three/webgpu';
import { Fn, texture, uv, frontFacing, select, color, mix, vec2, vec3, float, mx_noise_float, bumpMap } from 'three/tsl';

const NX = 8;
const NY = 11;
export const PAPER_W = 0.17;
export const PAPER_H = 0.235;
/** Gap kept between stacked sheets (metres): about a sheet's thickness, enough to stop depth clipping. */
const GAP = 0.0003;
const W = PAPER_W;
const H = PAPER_H;
const ITERATIONS = 6;

type Constraint = [number, number, number, number]; // a, b, rest length, stiffness

function makeConstraints(): Constraint[] {
  const idx = (x: number, y: number) => y * NX + x;
  const out: Constraint[] = [];
  const dx = W / (NX - 1);
  const dy = H / (NY - 1);
  const add = (a: number, b: number, len: number, k: number) => out.push([a, b, len, k]);
  for (let y = 0; y < NY; y++)
    for (let x = 0; x < NX; x++) {
      if (x < NX - 1) add(idx(x, y), idx(x + 1, y), dx, 1);
      if (y < NY - 1) add(idx(x, y), idx(x, y + 1), dy, 1);
      if (x < NX - 1 && y < NY - 1) {
        add(idx(x, y), idx(x + 1, y + 1), Math.hypot(dx, dy), 1);
        add(idx(x + 1, y), idx(x, y + 1), Math.hypot(dx, dy), 1);
      }
      // Paper resists bending: springs that skip one and two nodes make it curl in smooth arcs
      // instead of folding like cloth.
      if (x < NX - 2) add(idx(x, y), idx(x + 2, y), dx * 2, 0.95);
      if (y < NY - 2) add(idx(x, y), idx(x, y + 2), dy * 2, 0.95);
      if (x < NX - 3) add(idx(x, y), idx(x + 3, y), dx * 3, 0.7);
      if (y < NY - 3) add(idx(x, y), idx(x, y + 3), dy * 3, 0.7);
    }
  return out;
}
const CONSTRAINTS = makeConstraints();

/** Prints an image onto an off-white sheet with a margin, the way an inkjet would. */
export function paperCanvas(img: CanvasImageSource | null, iw = 1, ih = 1, label?: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = Math.round(512 * (H / W));
  const g = c.getContext('2d')!;
  g.fillStyle = '#efe9dd';
  g.fillRect(0, 0, c.width, c.height);
  // Paper grain: fine tooth plus a faint cloudy mottling (real paper is never perfectly even).
  const grain = g.createImageData(c.width, c.height);
  for (let i = 0; i < grain.data.length; i += 4) {
    const p = i / 4;
    const x = p % c.width;
    const y = Math.floor(p / c.width);
    const cloud = Math.sin(x * 0.031 + Math.sin(y * 0.017) * 2.1) * Math.sin(y * 0.023 + Math.sin(x * 0.013) * 1.7);
    const v = 226 + Math.random() * 22 + cloud * 7;
    grain.data[i] = v;
    grain.data[i + 1] = v - 4;
    grain.data[i + 2] = v - 12;
    grain.data[i + 3] = 46;
  }
  const tmp = document.createElement('canvas');
  tmp.width = c.width;
  tmp.height = c.height;
  tmp.getContext('2d')!.putImageData(grain, 0, 0);
  g.drawImage(tmp, 0, 0);
  if (img) {
    const m = c.width * 0.07;
    const bw = c.width - m * 2;
    const bh = c.height - m * 2.6;
    const s = Math.min(bw / iw, bh / ih);
    const w = iw * s;
    const hh = ih * s;
    // Ink on matte paper: multiplied in, blacks never quite black, colours a touch flatter.
    g.filter = 'contrast(0.9) saturate(0.92)';
    g.globalCompositeOperation = 'multiply';
    g.drawImage(img, (c.width - w) / 2, m + (bh - hh) / 2, w, hh);
    g.globalCompositeOperation = 'source-over';
    g.filter = 'none';
  } else if (label) {
    g.fillStyle = 'rgba(40,30,30,0.55)';
    g.font = '600 26px Manrope, sans-serif';
    g.textAlign = 'center';
    g.fillText(label, c.width / 2, c.height / 2);
  }
  return c;
}

/** Matte paper: fibre texture that shows under raking light, a soft sheen, and light glowing through it from behind. */
function paperMaterial(print: any) {
  const m = new THREE.MeshSSSNodeMaterial({ roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  // Tooth you can see on a phone (about 4 bumps a centimetre) over a gentle cockle across the sheet.
  const fibre = mx_noise_float(vec3(uv().mul(vec2(70, 97)), 0)).mul(0.55).add(mx_noise_float(vec3(uv().mul(vec2(9, 12)), 4)).mul(0.45));
  m.normalNode = bumpMap(fibre.mul(0.5).add(0.5), float(1.2));
  const paper = color('#ece5d8');
  m.colorNode = Fn(() => {
    const front = print.sample(uv()).rgb;
    // From behind, the print shows faintly through the sheet.
    const back = mix(paper, front, 0.1);
    return select(frontFacing, front, back);
  })();
  m.sheen = 1;
  m.sheenNode = vec3(0.16, 0.15, 0.13);
  m.sheenRoughnessNode = float(0.6);
  // Thin paper is translucent: a lifted edge with the lamp behind it glows warm.
  m.thicknessColorNode = paper.mul(0.4);
  m.thicknessDistortionNode = float(0.15);
  m.thicknessAmbientNode = float(0);
  m.thicknessAttenuationNode = float(0.8);
  m.thicknessPowerNode = float(3);
  m.thicknessScaleNode = float(1.4);
  return m;
}

export type Wind = (x: number, y: number, z: number, out: THREE.Vector3) => number;

export class Paper {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private prev: Float32Array;
  private rest: Float32Array;
  private geo: THREE.BufferGeometry;
  private tex: THREE.CanvasTexture;
  private texNode: ReturnType<typeof texture>;
  private center: THREE.Vector3;
  /** Height of the surface this sheet rests on (sheets are stacked a hair apart). */
  floor: number;
  private settleTime = 0;
  private asleep = false;
  private falling: boolean;
  /** Called once when a dropped sheet touches down. */
  onLand: (() => void) | null = null;
  /** Another sheet lies on top of this one: the draught can't get under it any more. */
  covered = false;
  private cos: number;
  private sin: number;

  constructor(center: THREE.Vector3, angle: number, readonly layer: number, canvas: HTMLCanvasElement, dropFrom = 0) {
    this.floor = 0.0008 + layer * 0.00035;
    this.center = center.clone();
    this.cos = Math.cos(angle);
    this.sin = Math.sin(angle);
    this.falling = dropFrom > 0;
    const n = NX * NY;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.rest = new Float32Array(n * 3);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let y = 0; y < NY; y++)
      for (let x = 0; x < NX; x++) {
        const i = (y * NX + x) * 3;
        const lx = (x / (NX - 1) - 0.5) * W;
        const lz = (y / (NY - 1) - 0.5) * H;
        const wx = center.x + lx * cos - lz * sin;
        const wz = center.z + lx * sin + lz * cos;
        this.rest[i] = wx;
        this.rest[i + 1] = this.floor;
        this.rest[i + 2] = wz;
        // A dropped sheet starts high, gently bowed and tilted, so it glides down rather than plummets.
        this.pos[i] = wx;
        this.pos[i + 1] = this.floor + dropFrom * (1 + lx * 0.6) + Math.sin((x / (NX - 1)) * Math.PI) * 0.006 * Math.sign(dropFrom);
        this.pos[i + 2] = wz;
      }
    this.prev.set(this.pos);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const uvs = new Float32Array(n * 2);
    const index: number[] = [];
    for (let y = 0; y < NY; y++)
      for (let x = 0; x < NX; x++) {
        uvs[(y * NX + x) * 2] = x / (NX - 1);
        uvs[(y * NX + x) * 2 + 1] = 1 - y / (NY - 1);
        if (x < NX - 1 && y < NY - 1) {
          const a = y * NX + x;
          index.push(a, a + NX, a + 1, a + 1, a + NX, a + NX + 1);
        }
      }
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geo.setIndex(index);
    this.geo.computeVertexNormals();

    this.tex = new THREE.CanvasTexture(canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.texNode = texture(this.tex);
    this.mesh = new THREE.Mesh(this.geo, paperMaterial(this.texNode));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  setCanvas(canvas: HTMLCanvasElement) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    this.texNode.value = t;
    this.tex.dispose();
    this.tex = t;
  }

  /** Highest point of the sheet above its resting height (metres): how far the fan lifts it. */
  maxLift() {
    let m = 0;
    for (let i = 1; i < this.pos.length; i += 3) m = Math.max(m, this.pos[i] - this.floor);
    return m;
  }

  /** Height of this sheet's surface over a desk point, or null when the point is off the sheet. */
  heightAt(x: number, z: number): number | null {
    const dx = x - this.center.x;
    const dz = z - this.center.z;
    const u = (dx * this.cos + dz * this.sin) / W + 0.5;
    const v = (-dx * this.sin + dz * this.cos) / H + 0.5;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const gx = u * (NX - 1), gy = v * (NY - 1);
    const x0 = Math.min(NX - 2, Math.floor(gx)), y0 = Math.min(NY - 2, Math.floor(gy));
    const fx = gx - x0, fy = gy - y0;
    const h = (xi: number, yi: number) => this.pos[(yi * NX + xi) * 3 + 1];
    return (h(x0, y0) * (1 - fx) + h(x0 + 1, y0) * fx) * (1 - fy) + (h(x0, y0 + 1) * (1 - fx) + h(x0 + 1, y0 + 1) * fx) * fy;
  }

  /**
   * Collision with a sheet lying under this one: wherever they overlap, this sheet stays a paper's
   * thickness above it, so a lifted or bowed sheet below pushes this one up instead of poking through.
   */
  restOn(below: Paper) {
    const { pos } = this;
    let moved = false;
    for (let i = 0; i < pos.length; i += 3) {
      const h = below.heightAt(pos[i], pos[i + 2]);
      if (h !== null && pos[i + 1] < h + GAP) {
        pos[i + 1] = h + GAP;
        this.prev[i + 1] = Math.min(this.prev[i + 1], pos[i + 1]); // no bounce: contact, not a kick
        moved = true;
      }
    }
    if (moved) {
      this.asleep = false;
      (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      this.geo.computeVertexNormals();
    }
  }

  dispose() {
    this.geo.dispose();
    this.tex.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  /** One simulation step. wind(p, out) writes the air velocity at p into out and returns its strength (0..1). */
  step(dt: number, wind: Wind, t: number) {
    const { pos, prev, rest, center } = this;
    const n = NX * NY;
    const w = new THREE.Vector3();
    // Sleep while the fan points elsewhere and the sheet is flat.
    const reach = Math.max(
      wind(center.x, this.floor, center.z, w),
      wind(rest[0], this.floor, rest[2], w),
      wind(rest[(NX - 1) * 3], this.floor, rest[(NX - 1) * 3 + 2], w),
      wind(rest[(n - NX) * 3], this.floor, rest[(n - NX) * 3 + 2], w),
      wind(rest[(n - 1) * 3], this.floor, rest[(n - 1) * 3 + 2], w),
    );
    if (this.asleep && (reach < 0.05 || this.covered)) return;
    this.asleep = false;

    const dt2 = dt * dt;
    const halfDiag = Math.hypot(W, H) / 2;
    let motion = 0;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const x = pos[k];
      const y = pos[k + 1];
      const z = pos[k + 2];
      const strength = wind(x, y, z, w);
      let lift = 0;
      if (strength > 0.002 && !this.covered) {
        // Air only gets under the edge that faces the fan: how far this node sits toward the fan,
        // along the horizontal wind direction, from the sheet's middle.
        const wl = Math.hypot(w.x, w.z) || 1;
        const facing = -((rest[k] - center.x) * w.x + (rest[k + 2] - center.z) * w.z) / wl / halfDiag;
        const edge = THREE.MathUtils.smoothstep(facing, 0.35, 1);
        // A small, quick tremble on top of the lift, like a real edge in a fan's draught.
        const tremble = 0.85 + 0.15 * Math.sin(t * 23 + i * 1.3) * Math.sin(t * 7.1 + i * 0.7);
        lift = strength * edge * tremble;
      }
      const airborne = y > this.floor + 0.0008;
      // Air resistance: paper is light and broad, so it moves slowly through air.
      const drag = airborne ? 0.9 : 0.97;
      let vx = (x - prev[k]) * drag;
      const vy = (y - prev[k + 1]) * drag;
      let vz = (z - prev[k + 2]) * drag;
      if (!airborne) {
        // Friction: a sheet grips the desk unless lifted.
        vx *= 0.4;
        vz *= 0.4;
      }
      const ay = -9.8 + lift * 90;
      prev[k] = x;
      prev[k + 1] = y;
      prev[k + 2] = z;
      pos[k] = x + vx;
      pos[k + 1] = y + vy + ay * dt2;
      pos[k + 2] = z + vz;
      // Soft tether to where the sheet was laid, so it never wanders off.
      const tether = airborne ? 0.02 : 0.08;
      pos[k] += (rest[k] - pos[k]) * tether;
      pos[k + 2] += (rest[k + 2] - pos[k + 2]) * tether;
      motion += Math.abs(vy);
    }
    for (let it = 0; it < ITERATIONS; it++) {
      for (const [a, b, len, stiff] of CONSTRAINTS) {
        const ka = a * 3;
        const kb = b * 3;
        const dx = pos[kb] - pos[ka];
        const dy = pos[kb + 1] - pos[ka + 1];
        const dz = pos[kb + 2] - pos[ka + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const corr = ((d - len) / d) * 0.5 * stiff;
        pos[ka] += dx * corr;
        pos[ka + 1] += dy * corr;
        pos[ka + 2] += dz * corr;
        pos[kb] -= dx * corr;
        pos[kb + 1] -= dy * corr;
        pos[kb + 2] -= dz * corr;
      }
      for (let i = 0; i < n; i++) if (pos[i * 3 + 1] < this.floor) pos[i * 3 + 1] = this.floor;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.geo.computeVertexNormals();
    if (this.falling && this.maxLift() < 0.003) {
      this.falling = false;
      this.onLand?.();
    }
    if (motion < 0.00002 * n && (reach < 0.05 || this.covered)) {
      this.settleTime += dt;
      if (this.settleTime > 0.5) this.asleep = true;
    } else this.settleTime = 0;
  }
}
