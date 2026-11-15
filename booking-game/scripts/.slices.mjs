import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const arr = prim.getAttribute('POSITION').getArray();
let minY = Infinity, maxY = -Infinity;
for (let i = 1; i < arr.length; i += 3) { minY = Math.min(minY, arr[i]); maxY = Math.max(maxY, arr[i]); }
const H = maxY - minY;
const rows = [];
for (let f2 = 0.04; f2 < 1; f2 += 0.04) {
  const y = minY + f2 * H; const pts = [];
  for (let i = 0; i < arr.length; i += 3) if (Math.abs(arr[i + 1] - y) < 0.004) pts.push([arr[i], arr[i + 2]]);
  pts.sort((p, q) => p[0] - q[0]);
  const cl = []; let cur = null;
  for (const p of pts) { if (!cur || p[0] - cur[1] > 0.02) { cur = [p[0], p[0], 0, p[1], p[1]]; cl.push(cur); } cur[1] = p[0]; cur[2]++; cur[3] = Math.min(cur[3], p[1]); cur[4] = Math.max(cur[4], p[1]); }
  rows.push(`${f2.toFixed(2)} n=${pts.length} ` + cl.map(c => `x[${c[0].toFixed(2)},${c[1].toFixed(2)}] z[${c[3].toFixed(2)},${c[4].toFixed(2)}] #${c[2]}`).join(' | '));
}
console.log(rows.join('\n'));
