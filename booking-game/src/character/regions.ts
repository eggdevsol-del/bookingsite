// The single owner of "which tattoo zone is this point of skin in".
// Zones are decided per pixel from smooth measurements of the body (height
// bands, angle around each limb, distance to each bone), so boundaries are
// clean curves that follow the body's shape and every point lands in exactly
// one zone, with no gaps. The same function drives the highlight, the GPU tap
// picking and the email pictures, so they can never disagree.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, int, If, select, uniformArray, normalize, length, dot, abs, atan, clamp, min, max,
  floor, mix, smoothstep, pow,
} from 'three/tsl';
import { REGION_INDEX } from '../../shared/catalog.mjs';

type V3 = [number, number, number];
export interface Landmarks {
  height: number;
  crotchY: number;
  armpitY: number;
  shoulderY: number;
  chinY: number;
  eyeY: number;
  rArm: number;
  head: { center: V3; noseZ: number };
  neck: { cx: number; cz: number; rx: number; rz: number; y: number };
  arms: Record<'l' | 'r', { shoulder: V3; elbow: V3; wrist: V3; tip: V3 }>;
  legs: Record<'l' | 'r', { hip: V3; knee: V3; ankle: V3 }>;
  torsoRange: [number, number];
  torsoProfile: [number, number, number, number][];
  legRange: [number, number];
  legProfile: number[];
}

const DEG = 180 / Math.PI;
// Arm proportions along shoulder → fingertip (segment lengths as fractions of height).
const T_ELBOW = 0.186 / 0.44;
const T_WRIST = (0.186 + 0.146) / 0.44;

type Node = ReturnType<typeof float>;

/** Builds the zone function for one body. Returns a TSL function: (point in model space) → zone index, or -1. */
export function zoneFunction(L: Landmarks) {
  const torso = uniformArray(L.torsoProfile.map(([a, b, c, d]) => new THREE.Vector4(a, b, c, d)), 'vec4');
  const legR = uniformArray(L.legProfile, 'float');
  const [t0, t1] = L.torsoRange;
  const [l0, l1] = L.legRange;
  const TN = L.torsoProfile.length - 1;
  const LN = L.legProfile.length - 1;
  const id = (s: string) => {
    const i = REGION_INDEX.get(s);
    if (i === undefined) throw new Error(`unknown zone ${s}`);
    return float(i);
  };
  const v3 = (a: V3) => vec3(a[0], a[1], a[2]);
  const neckBaseY = L.shoulderY + 0.025 * L.height;

  const torsoAt = (y: Node) => {
    const f = clamp(y.sub(t0).div(t1 - t0), 0, 1).mul(TN);
    const i0 = floor(f);
    return mix(torso.element(int(i0)), torso.element(int(min(i0.add(1), float(TN)))), f.sub(i0));
  };
  const legRadiusAt = (y: Node) => {
    const f = clamp(y.sub(l0).div(l1 - l0), 0, 1).mul(LN);
    const i0 = floor(f);
    return max(mix(legR.element(int(i0)), legR.element(int(min(i0.add(1), float(LN)))), f.sub(i0)), float(0.03));
  };
  /** Closest point on segment a→b, with its 0..1 position in w. */
  const closest = (p: any, a: any, b: any) => {
    const ab = b.sub(a);
    const t = clamp(dot(p.sub(a), ab).div(dot(ab, ab)), 0, 1);
    return vec4(a.add(ab.mul(t)), t);
  };

  return Fn(([p]: [any]) => {
    const zone = float(-1).toVar();
    const left = p.x.greaterThanEqual(0); // the body faces +Z, so its left side is +X
    const sideSign = select(left, float(1), float(-1));
    const sided = (base: string) => select(left, id(`${base}-l`), id(`${base}-r`));
    const hc = v3(L.head.center);
    // Head/neck boundary: along the jaw, rising toward the base of the skull.
    const headLine = float(L.chinY + 0.012).add(hc.z.sub(p.z).mul(0.35));
    const ankle = select(left, v3(L.legs.l.ankle), v3(L.legs.r.ankle));

    If(p.y.greaterThan(headLine), () => {
      const d = normalize(p.sub(hc));
      If(d.y.greaterThan(0.62), () => {
        zone.assign(id('head-top'));
      })
        .ElseIf(d.z.greaterThan(0.42), () => {
          zone.assign(id('face'));
        })
        .ElseIf(d.z.lessThan(-0.38), () => {
          zone.assign(id('head-back'));
        })
        .Else(() => {
          zone.assign(sided('head-side'));
        });
    })
      .ElseIf(p.y.lessThan(ankle.y.sub(0.02)), () => {
        zone.assign(sided('foot'));
      })
      .Else(() => {
        // Each candidate part reports a normalised distance; the smallest wins.
        const shoulder = select(left, v3(L.arms.l.shoulder), v3(L.arms.r.shoulder));
        const tip = select(left, v3(L.arms.l.tip), v3(L.arms.r.tip));
        const ac = closest(p, shoulder, tip);
        const armOff = p.sub(ac.xyz);
        const ts = torsoAt(p.y); // cx, cz, half-width, half-depth
        const armN = length(armOff).div(L.rArm * 1.25).toVar();
        // Skin inside the torso's own width (armpit, lats) belongs to the torso.
        If(p.y.greaterThan(L.crotchY).and(p.y.lessThan(L.shoulderY - 0.03)).and(abs(p.x.sub(ts.x)).lessThan(ts.z.mul(0.97))), () => {
          armN.mulAssign(1.8);
        });

        const hip = select(left, v3(L.legs.l.hip), v3(L.legs.r.hip));
        const knee = select(left, v3(L.legs.l.knee), v3(L.legs.r.knee));
        const c1 = closest(p, hip, knee);
        const c2 = closest(p, knee, ankle);
        const d1 = length(p.sub(c1.xyz));
        const d2 = length(p.sub(c2.xyz));
        const legC = select(d1.lessThan(d2), c1.xyz, c2.xyz);
        const legN = min(d1, d2).div(legRadiusAt(p.y).mul(1.15));

        const big = float(99);
        const ex = p.x.sub(ts.x).div(ts.z);
        const ez = p.z.sub(ts.y).div(ts.w);
        const inTorso = p.y.greaterThanEqual(L.crotchY - 0.01).and(p.y.lessThanEqual(neckBaseY + 0.02));
        const torsoN = select(inTorso, length(vec2(ex, ez)).mul(select(p.y.greaterThan(L.armpitY), float(1.05), float(0.9))), big).toVar();
        // Just above the crotch the hip slice spans both legs; skin inside a leg's column is thigh.
        If(p.y.lessThan(L.crotchY + 0.1).and(legN.lessThan(1.1)), () => {
          torsoN.mulAssign(1.7);
        });

        const nx = p.x.sub(L.neck.cx).div(L.neck.rx);
        const nz = p.z.sub(L.neck.cz).div(L.neck.rz);
        const neckN = select(p.y.greaterThan(L.shoulderY - 0.005), length(vec2(nx, nz)).mul(0.95), big);
        const best = min(min(armN, legN), min(torsoN, neckN));

        If(neckN.lessThanEqual(best), () => {
          const a = atan(abs(nx), nz).mul(DEG);
          If(a.lessThan(55), () => {
            zone.assign(id('neck-front'));
          })
            .ElseIf(a.greaterThan(125), () => {
              zone.assign(id('neck-back'));
            })
            .Else(() => {
              zone.assign(sided('neck-side'));
            });
        })
          .ElseIf(torsoN.lessThanEqual(best), () => {
            const t = p.y.sub(L.crotchY).div(L.shoulderY - L.crotchY);
            const a = atan(abs(ex), ez).mul(DEG); // 0 front … 180 back
            If(t.greaterThan(0.92).and(a.greaterThan(30)).or(t.greaterThan(0.86).and(a.greaterThan(115))), () => {
              zone.assign(sided('traps'));
            })
              .ElseIf(a.lessThan(50), () => {
                // Pec fold: lowest under the middle of each pec, rising toward the sternum and armpit.
                const across = abs(ex);
                const fold = float(0.655).add(smoothstep(0.5, 0.95, across).mul(0.07)).add(float(1).sub(smoothstep(0.0, 0.22, across)).mul(0.02));
                zone.assign(select(t.greaterThan(fold), sided('chest'), id('stomach')));
              })
              .ElseIf(a.lessThan(130), () => {
                zone.assign(select(t.greaterThan(0.2), sided('ribs'), sided('thigh-outer')));
              })
              .Else(() => {
                zone.assign(select(t.greaterThan(0.27), id('back'), sided('buttock')));
              });
          })
          .ElseIf(armN.lessThanEqual(best), () => {
            const t = ac.w;
            const dir = normalize(tip.sub(shoulder));
            const perp = normalize(armOff.sub(dir.mul(dot(armOff, dir))));
            // Inner faces the body (bicep / palm side); the back of the arm is outer.
            const want = normalize(vec3(sideSign.negate(), 0, 0.2));
            const inner = dot(perp, want).greaterThan(0.1).and(perp.z.greaterThan(-0.35));
            If(t.greaterThan(T_WRIST + 0.03), () => {
              zone.assign(-1); // hand: not a tattoo zone
            })
              .ElseIf(t.lessThan(0.16), () => {
                zone.assign(sided('shoulder'));
              })
              .ElseIf(t.lessThan(T_ELBOW), () => {
                zone.assign(select(inner, sided('inner-bicep'), sided('upper-arm-outer')));
              })
              .Else(() => {
                zone.assign(select(inner, sided('forearm-inner'), sided('forearm-outer')));
              });
          })
          .Else(() => {
            // Legs: quadrants around the leg's own axis.
            const off = p.sub(legC);
            const th = atan(off.x.mul(sideSign), off.z).mul(DEG); // 0 front, + outer, - inner
            const front = abs(th).lessThan(45);
            const back = abs(th).greaterThan(135);
            const outer = th.greaterThan(0);
            If(abs(p.y.sub(knee.y)).lessThan(0.045), () => {
              zone.assign(select(abs(th).lessThan(90), sided('knee'), sided('knee-back')));
            })
              .ElseIf(p.y.greaterThan(knee.y), () => {
                If(front, () => {
                  zone.assign(sided('thigh-front'));
                })
                  .ElseIf(back, () => {
                    // Gluteal fold: dips under the middle of each buttock, rises at the sides.
                    const across = abs(off.x).div(legRadiusAt(p.y));
                    const fold = float(L.crotchY - 0.035).add(smoothstep(0.2, 1.0, across).mul(0.03));
                    zone.assign(select(p.y.greaterThan(fold), sided('buttock'), sided('thigh-back')));
                  })
                  .Else(() => {
                    zone.assign(select(outer, sided('thigh-outer'), sided('thigh-inner')));
                  });
              })
              .Else(() => {
                If(front, () => {
                  zone.assign(sided('shin'));
                })
                  .ElseIf(back, () => {
                    zone.assign(sided('calf'));
                  })
                  .Else(() => {
                    zone.assign(select(outer, sided('calf-outer'), sided('calf-inner')));
                  });
              });
          });
      });
    return zone;
  });
}

/**
 * How much of a point is covered by the knitted balaclava (0 skin … 1 fabric), with a
 * single eye opening. Smooth at the edges so the hem and eye slot read as rolled knit.
 */
export function balaclavaFunction(L: Landmarks) {
  const hc = vec3(...L.head.center);
  const hemY = L.shoulderY + 0.45 * (L.chinY - L.shoulderY);
  const eyeHalfW = 0.06;
  const eyeHalfH = 0.017;
  return Fn(([p]: [any]) => {
    // Hem around mid-neck, a little lower at the throat as a real balaclava sits.
    const hem = float(hemY).sub(p.z.sub(L.neck.cz).mul(0.15));
    const covered = smoothstep(hem.sub(0.002), hem.add(0.002), p.y);
    // Eye opening: a rounded slot across both eyes, on the front of the face only.
    const dx = p.x.sub(hc.x).div(eyeHalfW);
    const dy = p.y.sub(L.eyeY).div(eyeHalfH);
    const shape = pow(abs(dx), float(4)).add(pow(abs(dy), float(4)));
    const front = smoothstep(L.head.noseZ - 0.075, L.head.noseZ - 0.055, p.z);
    const slot = float(1).sub(smoothstep(0.75, 1.0, shape)).mul(front);
    return covered.mul(float(1).sub(slot));
  });
}
