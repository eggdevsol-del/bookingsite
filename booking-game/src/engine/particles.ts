// Atmosphere: dust in light beams, drifting petals, rising embers, pollen.
// Every particle is animated on the GPU from its index, so there is no
// per-frame CPU work no matter how many there are.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, instanceIndex, hash, vec2, vec3, float, sin, cos, mod, uv, length, smoothstep, mix, time, color, screenUV, pow,
} from 'three/tsl';

export type ParticleKind = 'dust' | 'petals' | 'embers' | 'pollen';

export interface ParticleOptions {
  kind: ParticleKind;
  color: string;
  count: number;
  wind: [number, number];
  /** Box the particles live in, in the parent's space. */
  box: { center: THREE.Vector3; size: THREE.Vector3 };
  /**
   * Scene brightness at a screen point (0..1+). When given, motes glow inside light beams
   * and almost vanish in shadow, the way real airborne dust only shows where light hits it.
   */
  light?: (st: any) => any;
  size?: number;
}

export class Particles {
  readonly object: THREE.Sprite;
  readonly u = { opacity: uniform(1), speed: uniform(1), look: uniform(new THREE.Vector2()) };

  constructor(opts: ParticleOptions) {
    const { kind, wind, box } = opts;
    const { u } = this;
    const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    material.blending = kind === 'petals' ? THREE.NormalBlending : THREE.AdditiveBlending;

    const seed = (k: number) => hash(instanceIndex.add(k * 7919));
    const size = vec3(box.size.x, box.size.y, box.size.z);
    const origin = vec3(box.center.x, box.center.y, box.center.z).sub(size.mul(0.5));
    const rise = kind === 'embers' ? 0.12 : kind === 'pollen' ? 0.02 : 0;
    const fall = kind === 'petals' ? -0.09 : 0;
    const speed = kind === 'dust' ? 0.25 : kind === 'pollen' ? 0.5 : 1;

    material.positionNode = Fn(() => {
      const t = time.mul(u.speed);
      const start = vec3(seed(1), seed(2), seed(3));
      const drift = vec3(wind[0], wind[1] + rise + fall, 0).mul(speed).mul(t).div(size);
      const wobble = vec3(
        sin(t.mul(seed(4).mul(0.6).add(0.3)).add(seed(5).mul(6.28))).mul(0.015),
        cos(t.mul(seed(6).mul(0.5).add(0.2)).add(seed(7).mul(6.28))).mul(0.012),
        0,
      );
      const p = mod(start.add(drift).add(wobble), 1);
      // Parallax: like the photo behind, near motes slide further than far ones as the phone tilts.
      const near = seed(3); // 0 = back of the box … 1 = front (z never drifts)
      const shift = vec3(u.look.mul(near.mul(1.3).sub(0.3)).mul(-0.07), 0);
      return origin.add(p.mul(size)).add(shift);
    })();

    const baseSize = opts.size ?? (kind === 'petals' ? 0.05 : kind === 'embers' ? 0.022 : kind === 'pollen' ? 0.018 : 0.012);
    material.scaleNode = Fn(() => {
      // Depth of field: the nearer a mote is to the lens, the bigger and blurrier its disc.
      const dof = mix(float(0.75), float(2.1), pow(seed(3), float(2)));
      // Mostly small specks with the odd large, soft, out-of-focus mote (like real dust in light).
      const s = (opts.light ? pow(seed(8), float(3)).mul(2.6).add(0.35).mul(baseSize) : seed(8).mul(0.9).add(0.4).mul(baseSize)).mul(dof);
      return kind === 'petals' ? vec2(s, s.mul(0.62)) : vec2(s);
    })();
    if (kind === 'petals') material.rotationNode = time.mul(seed(9).sub(0.5).mul(2.2)).add(seed(10).mul(6.28));

    const tint = color(opts.color);
    material.colorNode = Fn(() => {
      if (kind === 'embers') return mix(tint, vec3(1, 0.95, 0.8), smoothstep(0.3, 0.0, length(uv().sub(0.5)))).mul(3);
      if (kind === 'petals') return mix(tint.mul(0.75), tint, uv().y);
      return tint.mul(kind === 'dust' ? 1.6 : 2.2);
    })();
    material.opacityNode = Fn(() => {
      const r = length(uv().sub(0.5));
      const near = pow(seed(3), float(2));
      // Far motes are crisp points; near ones are soft discs with dimmer centres (out of focus).
      const shape = kind === 'petals'
        ? smoothstep(0.5, mix(float(0.36), float(0.12), near), r)
        : smoothstep(0.5, mix(float(0.12), float(0.0), near), r).mul(mix(float(1), smoothstep(0.0, 0.5, r).mul(0.5).add(0.5), near));
      const spread = mix(float(1), float(0.35), near); // light spread over a bigger disc
      const twinkle = kind === 'petals' ? float(1) : sin(time.mul(seed(11).mul(opts.light ? 0.8 : 2).add(0.3)).add(seed(12).mul(6.28))).mul(0.4).add(0.6);
      const strength = kind === 'petals' ? 0.92 : kind === 'embers' ? 0.9 : 0.55;
      // Big soft motes are dimmer per pixel, as out-of-focus discs are.
      const soft = opts.light ? float(1).sub(pow(seed(8), float(3)).mul(0.65)) : float(1);
      const lit = opts.light ? mix(float(0.04), float(3.4), smoothstep(0.04, 0.32, opts.light(screenUV))).mul(soft) : float(1);
      return shape.mul(twinkle).mul(strength).mul(lit).mul(spread).mul(u.opacity);
    })();

    this.object = new THREE.Sprite(material);
    this.object.count = opts.count;
    this.object.frustumCulled = false;
    this.object.renderOrder = 5;
  }
}
