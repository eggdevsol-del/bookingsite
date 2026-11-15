// Prepares the generated 3D bodies for phones and tags every vertex with its body area.
//  1. Faces the model toward +Z, feet on the floor, real-world height in metres.
//  2. Simplifies 500k triangles to ~80k and compresses geometry (meshopt) and textures (WebP).
//  3. Measures the body from the mesh itself (legs, arms, torso slices, head, eyes, neck).
//  4. Writes public/models/<name>.glb and <name>.json. The JSON feeds the zone shader in
//     src/character/regions.ts, which decides each tattoo zone per pixel.
// Usage: node scripts/models.mjs
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { weld, simplify, dedup, prune, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs/promises';

const MODELS = [
  { name: 'male', src: 'art-src/raw/male.glb', height: 1.8 },
  { name: 'female', src: 'art-src/raw/female.glb', height: 1.68 },
];
const TARGET_TRIS = 80_000;

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await fs.mkdir('public/models', { recursive: true });

const v3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
};

/** Closest point on segment ab to p; returns distance and the 0..1 position along it. */
function toSegment(p, a, b) {
  const ab = v3.sub(b, a);
  const t = Math.max(0, Math.min(1, v3.dot(v3.sub(p, a), ab) / v3.dot(ab, ab)));
  const c = v3.add(a, v3.mul(ab, t));
  return { d: v3.len(v3.sub(p, c)), t, c };
}

/** Groups x-sorted points of one horizontal slice into separate blobs (limbs, torso). */
function clusters(points, gap) {
  points.sort((a, b) => a[0] - b[0]);
  const out = [];
  let cur = null;
  for (const p of points) {
    if (!cur || p[0] - cur.xmax > gap) {
      cur = { xmin: p[0], xmax: p[0], zmin: p[2], zmax: p[2], sx: 0, sz: 0, n: 0 };
      out.push(cur);
    }
    cur.xmax = p[0];
    cur.zmin = Math.min(cur.zmin, p[2]);
    cur.zmax = Math.max(cur.zmax, p[2]);
    cur.sx += p[0];
    cur.sz += p[2];
    cur.n++;
  }
  for (const c of out) {
    c.cx = (c.xmin + c.xmax) / 2;
    c.cz = (c.zmin + c.zmax) / 2;
    c.hw = (c.xmax - c.xmin) / 2;
    c.hd = (c.zmax - c.zmin) / 2;
  }
  return out.filter((c) => c.n >= 4);
}

/** Fits a 3D line through points (centroid + main direction). */
function fitLine(pts) {
  const n = pts.length;
  const c = pts.reduce((s, p) => v3.add(s, p), [0, 0, 0]).map((x) => x / n);
  // Power iteration on the covariance matrix.
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) {
    const d = v3.sub(p, c);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i * 3 + j] += d[i] * d[j];
  }
  let v = [0, -1, 0];
  for (let k = 0; k < 50; k++) v = v3.norm([0, 1, 2].map((i) => cov[i * 3] * v[0] + cov[i * 3 + 1] * v[1] + cov[i * 3 + 2] * v[2]));
  if (v[1] > 0) v = v3.mul(v, -1); // point downward
  return { c, d: v };
}

function analyse(pos, count, H) {
  const P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const step = 0.01;
  const slices = [];
  const buckets = Array.from({ length: Math.ceil(H / step) + 1 }, () => []);
  for (let i = 0; i < count; i++) {
    const p = P(i);
    const k = Math.round(p[1] / step);
    if (k >= 0 && k < buckets.length && Math.abs(p[1] - k * step) < 0.004) buckets[k].push(p);
  }
  for (let k = 0; k < buckets.length; k++) slices.push({ y: k * step, cl: clusters(buckets[k], 0.018) });
  const spans0 = (c) => c.xmin < 0.01 && c.xmax > -0.01;

  // Crotch: highest slice in the lower body where no blob crosses the midline.
  let crotchY = 0.45 * H;
  for (const s of slices) {
    if (s.y < 0.3 * H || s.y > 0.62 * H) continue;
    if (s.cl.length >= 2 && !s.cl.some(spans0)) crotchY = s.y;
  }
  // Armpit: highest slice above the crotch where the outer blobs are separate from the torso.
  let armpitY = 0.72 * H;
  for (const s of slices) {
    if (s.y < crotchY + 0.05 || s.y > 0.86 * H) continue;
    const torso = s.cl.find(spans0);
    if (torso && s.cl.some((c) => c.xmax < torso.xmin) && s.cl.some((c) => c.xmin > torso.xmax)) armpitY = s.y;
  }

  // Arms: outermost blobs from just under the armpit to the fingertips.
  const armPts = { l: [], r: [] };
  const armRad = [];
  for (const s of slices) {
    if (s.y > armpitY - 0.03 || s.y < 0.2 * H || s.cl.length < 3) continue;
    const left = s.cl.at(-1);
    const right = s.cl[0];
    if (left.xmin > 0.06) {
      armPts.l.push([left.cx, s.y, left.cz]);
      if (s.y > crotchY) armRad.push(Math.max(left.hw, left.hd));
    }
    if (right.xmax < -0.06) armPts.r.push([right.cx, s.y, right.cz]);
  }
  const arm = {};
  for (const side of ['l', 'r']) {
    const pts = armPts[side];
    const line = fitLine(pts);
    // Fingertip: the arm vertex farthest down the arm line.
    let tip = null;
    let best = -Infinity;
    for (let i = 0; i < count; i++) {
      const p = P(i);
      if ((side === 'l' ? p[0] < 0.05 : p[0] > -0.05) || p[1] > armpitY) continue;
      const along = v3.dot(v3.sub(p, line.c), line.d);
      const off = v3.len(v3.sub(v3.sub(p, line.c), v3.mul(line.d, along)));
      if (off < 0.08 && along > best) {
        best = along;
        tip = p;
      }
    }
    const tipOnLine = v3.add(line.c, v3.mul(line.d, best));
    const shoulder = v3.sub(tipOnLine, v3.mul(line.d, 0.44 * H));
    const elbow = v3.add(shoulder, v3.mul(line.d, 0.186 * H));
    const wrist = v3.add(elbow, v3.mul(line.d, 0.146 * H));
    arm[side] = { shoulder, elbow, wrist, tip: tipOnLine, d: line.d };
  }
  const rArm = armRad.length ? armRad.sort((a, b) => a - b)[Math.floor(armRad.length * 0.6)] : 0.04;

  // Legs: the two blobs either side of the midline below the crotch.
  const leg = { l: [], r: [] };
  for (const s of slices) {
    if (s.y > crotchY - 0.01 || s.y < 0.02) continue;
    const inner = s.cl.filter((c) => !(c.xmin > arm.l.wrist[0] - 0.02 && s.y < arm.l.wrist[1] + 0.05) && !(c.xmax < arm.r.wrist[0] + 0.02 && s.y < arm.r.wrist[1] + 0.05));
    const l = inner.filter((c) => c.cx > 0).sort((a, b) => a.cx - b.cx)[0];
    const r = inner.filter((c) => c.cx < 0).sort((a, b) => b.cx - a.cx)[0];
    if (l) leg.l.push({ y: s.y, c: [l.cx, s.y, l.cz], hw: l.hw, hd: l.hd });
    if (r) leg.r.push({ y: s.y, c: [r.cx, s.y, r.cz], hw: r.hw, hd: r.hd });
  }
  const legAt = (side, y) => {
    const arr = leg[side];
    let best = arr[0];
    for (const e of arr) if (Math.abs(e.y - y) < Math.abs(best.y - y)) best = e;
    return best;
  };
  const kneeY = 0.285 * H;
  const ankleY = 0.05 * H;
  const legs = {};
  for (const side of ['l', 'r']) {
    const top = legAt(side, crotchY - 0.02);
    legs[side] = {
      hip: [top.c[0], crotchY + 0.05 * H, top.c[2]],
      knee: legAt(side, kneeY).c,
      ankle: legAt(side, ankleY + 0.02).c,
    };
  }
  const legRadius = (side, y) => {
    const e = legAt(side, Math.min(y, crotchY - 0.02));
    return Math.max(e.hw, e.hd, 0.03);
  };

  // Torso cross-sections; above the armpit the blob includes the arms, so hold the chest width.
  const torso = [];
  let chest = null;
  for (const s of slices) {
    if (s.y < crotchY - 0.12 || s.y > 0.9 * H) continue;
    const t = s.cl.find(spans0);
    if (!t) continue;
    let { cx, cz, hw, hd } = t;
    if (s.y <= armpitY - 0.02) chest = { hw, cx };
    else if (chest) {
      hw = chest.hw * 1.02;
      cx = chest.cx;
    }
    torso.push({ y: s.y, cx, cz, hw, hd });
  }
  const torsoAt = (y) => {
    let best = torso[0];
    for (const e of torso) if (Math.abs(e.y - y) < Math.abs(best.y - y)) best = e;
    return best;
  };
  const shoulderY = (arm.l.shoulder[1] + arm.r.shoulder[1]) / 2;
  const neckBaseY = shoulderY + 0.025 * H;
  const chinY = 0.872 * H;

  // Head: the nose tip is the most forward point of the face; the skull centre sits ~11.5 cm behind it.
  const hh = H - chinY;
  let noseZ = -Infinity;
  let hxMin = Infinity;
  let hxMax = -Infinity;
  for (let i = 0; i < count; i++) {
    const p = P(i);
    if (p[1] < chinY + 0.25 * hh || p[1] > chinY + 0.7 * hh) continue;
    if (Math.abs(p[0]) < 0.03) noseZ = Math.max(noseZ, p[2]);
    hxMin = Math.min(hxMin, p[0]);
    hxMax = Math.max(hxMax, p[0]);
  }
  const head = { center: [(hxMin + hxMax) / 2, chinY + 0.5 * hh, noseZ - 0.115], noseZ };
  // Eyes: the sockets are the most recessed band of the face between cheekbone and brow.
  let eyeY = chinY + 0.55 * hh;
  let best = Infinity;
  for (let y = chinY + 0.42 * hh; y <= chinY + 0.72 * hh; y += 0.003) {
    let z = -Infinity;
    for (let i = 0; i < count; i++) {
      const p = P(i);
      if (Math.abs(p[1] - y) > 0.002) continue;
      const ax = Math.abs(p[0] - head.center[0]);
      if (ax > 0.022 && ax < 0.042) z = Math.max(z, p[2]);
    }
    if (z > -Infinity && z < best) {
      best = z;
      eyeY = y;
    }
  }
  // Neck: the narrowest cross-section between the shoulders and the chin.
  let neckSlice = null;
  for (const sl of slices) {
    if (sl.y < shoulderY + 0.02 || sl.y > chinY - 0.005) continue;
    const c = sl.cl.find(spans0);
    if (c && (!neckSlice || c.hw < neckSlice.hw)) neckSlice = { ...c, y: sl.y };
  }
  neckSlice ??= { cx: 0, cz: 0, hw: 0.06, hd: 0.065, y: chinY - 0.04 };
  const neck = { cx: neckSlice.cx, cz: neckSlice.cz, rx: Math.max(0.045, neckSlice.hw), rz: Math.max(0.05, neckSlice.hd), y: neckSlice.y };

  // Sampled profiles for the shader: torso cross-sections and leg thickness by height.
  const N = 24;
  const t0 = crotchY - 0.12;
  const t1 = shoulderY + 0.06;
  const torsoProfile = Array.from({ length: N }, (_, k) => {
    const y = t0 + ((t1 - t0) * k) / (N - 1);
    const e = torsoAt(y);
    return [e.cx, e.cz, e.hw, e.hd];
  });
  const legProfile = Array.from({ length: N }, (_, k) => {
    const y = 0.02 + ((crotchY - 0.04) * k) / (N - 1);
    return (legRadius('l', y) + legRadius('r', y)) / 2;
  });
  return {
    H, crotchY, armpitY, shoulderY, neckBaseY, chinY, kneeY, ankleY, arm, legs, rArm, legRadius, torsoAt,
    head, eyeY, neck, torsoProfile, torsoRange: [t0, t1], legProfile, legRange: [0.02, crotchY - 0.02],
  };
}

for (const M of MODELS) {
  const doc = await io.read(M.src);
  const root = doc.getRoot();
  const prim = root.listMeshes()[0].listPrimitives()[0];

  // --- orient and scale -------------------------------------------------
  const posAcc = prim.getAttribute('POSITION');
  const n0 = posAcc.getCount();
  const raw = posAcc.getArray();
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n0; i++) {
    minY = Math.min(minY, raw[i * 3 + 1]);
    maxY = Math.max(maxY, raw[i * 3 + 1]);
  }
  // Which way is the face pointing? The nose and toes stick out the front.
  let nose = 0;
  let toes = 0;
  for (let i = 0; i < n0; i++) {
    const y = (raw[i * 3 + 1] - minY) / (maxY - minY);
    const z = raw[i * 3 + 2];
    if (y > 0.9 && y < 0.95 && Math.abs(raw[i * 3]) < 0.03) nose = Math.abs(z) > Math.abs(nose) ? z : nose;
    if (y < 0.03) toes = Math.abs(z) > Math.abs(toes) ? z : toes;
  }
  const flip = nose + toes < 0 ? -1 : 1; // rotate 180° about Y when the front faces -Z
  const scale = M.height / (maxY - minY);
  for (let i = 0; i < n0; i++) {
    raw[i * 3] = raw[i * 3] * scale * flip;
    raw[i * 3 + 1] = (raw[i * 3 + 1] - minY) * scale;
    raw[i * 3 + 2] = raw[i * 3 + 2] * scale * flip;
  }
  posAcc.setArray(raw);
  const nrm = prim.getAttribute('NORMAL');
  if (nrm && flip < 0) {
    const a = nrm.getArray();
    for (let i = 0; i < a.length; i += 3) {
      a[i] *= -1;
      a[i + 2] *= -1;
    }
    nrm.setArray(a);
  }
  // Centre the body over x = 0 using the torso at chest height.
  {
    const a = posAcc.getArray();
    let sx = 0;
    let k = 0;
    for (let i = 0; i < a.length / 3; i++) {
      const y = a[i * 3 + 1] / M.height;
      if (y > 0.6 && y < 0.65 && Math.abs(a[i * 3]) < 0.2) {
        sx += a[i * 3];
        k++;
      }
    }
    const cx = k ? sx / k : 0;
    for (let i = 0; i < a.length; i += 3) a[i] -= cx;
    posAcc.setArray(a);
  }

  // --- landmarks, measured on the dense mesh (sparse meshes leave gaps in the slices) ---
  const dense = posAcc.getArray();
  const L = analyse(dense, dense.length / 3, M.height);

  // --- simplify (keeps the original smooth normals and UVs) ---------------
  const tris0 = (prim.getIndices()?.getCount() ?? n0) / 3;
  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: TARGET_TRIS / tris0, error: 0.0008, lockBorder: false }),
    dedup(),
    prune(),
  );

  const count = root.listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getCount();
  const p2 = root.listMeshes()[0].listPrimitives()[0];

  // --- material and textures -------------------------------------------
  const mat = p2.getMaterial();
  mat.setMetallicFactor(0); // skin and cotton are not metal
  mat.setRoughnessFactor(1);
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 86, resize: [2048, 2048], slots: /baseColor/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 92, resize: [2048, 2048], slots: /normal/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 80, resize: [1024, 1024], slots: /metallicRoughness/ }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await io.write(`public/models/${M.name}.glb`, doc);

  const round = (a) => a.map((v) => +v.toFixed(4));
  // Everything src/character/regions.ts needs to decide zones per pixel.
  const meta = {
    height: M.height,
    crotchY: +L.crotchY.toFixed(4),
    armpitY: +L.armpitY.toFixed(4),
    shoulderY: +L.shoulderY.toFixed(4),
    chinY: +L.chinY.toFixed(4),
    eyeY: +L.eyeY.toFixed(4),
    rArm: +L.rArm.toFixed(4),
    head: { center: round(L.head.center), noseZ: +L.head.noseZ.toFixed(4) },
    neck: Object.fromEntries(Object.entries(L.neck).map(([k, v]) => [k, +v.toFixed(4)])),
    arms: Object.fromEntries(Object.entries(L.arm).map(([s, a]) => [s, { shoulder: round(a.shoulder), elbow: round(a.elbow), wrist: round(a.wrist), tip: round(a.tip) }])),
    legs: Object.fromEntries(Object.entries(L.legs).map(([s, g]) => [s, { hip: round(g.hip), knee: round(g.knee), ankle: round(g.ankle) }])),
    torsoRange: round(L.torsoRange),
    torsoProfile: L.torsoProfile.map(round),
    legRange: round(L.legRange),
    legProfile: round(L.legProfile),
  };
  await fs.writeFile(`public/models/${M.name}.json`, JSON.stringify(meta, null, 1));
  const stat = await fs.stat(`public/models/${M.name}.glb`);
  console.log(`${M.name}: ${count} verts, ${(stat.size / 1048576).toFixed(2)} MB, flip=${flip}, crotch=${L.crotchY.toFixed(2)} armpit=${L.armpitY.toFixed(2)} shoulder=${L.shoulderY.toFixed(2)} chin=${L.chinY.toFixed(2)} eyes=${L.eyeY.toFixed(3)} (${((L.eyeY - L.chinY) / (M.height - L.chinY)).toFixed(2)} of chin→crown)`);
}
