// Bakes Cesium's Tycho-2 sky cube into one equirectangular map in equatorial (ICRS) coordinates.
// The orientation of every face is not assumed: it is solved by matching Hipparcos star positions.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import jpeg from 'jpeg-js';

const names = ['px', 'mx', 'py', 'my', 'pz', 'mz'];
const faces = names.map((n) => jpeg.decode(readFileSync(`node_modules/cesium/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_${n}.jpg`), { useTArray: true, maxMemoryUsageInMB: 2000 }));
const W = faces[0].width;
const cat = JSON.parse(readFileSync('src/renderer/src/data/generated/stars.json', 'utf8'));
const rad = Math.PI / 180;
const stars = [];
for (let i = 0; i < cat.rows.length; i += 4) {
  if (cat.rows[i + 2] > 4.5) continue;
  const ra = cat.rows[i] * rad, de = cat.rows[i + 1] * rad;
  stars.push([Math.cos(de) * Math.cos(ra), Math.cos(de) * Math.sin(ra), Math.sin(de)]);
}
const D = [
  (a, b) => [a, b], (a, b) => [-a, b], (a, b) => [a, -b], (a, b) => [-a, -b],
  (a, b) => [b, a], (a, b) => [-b, a], (a, b) => [b, -a], (a, b) => [-b, -a],
];
function region(v) {
  const k = [0, 1, 2].reduce((m, i) => (Math.abs(v[i]) > Math.abs(v[m]) ? i : m), 0);
  const m = Math.abs(v[k]), o = [0, 1, 2].filter((i) => i !== k);
  return { id: k * 2 + (v[k] < 0 ? 1 : 0), a: v[o[0]] / m, b: v[o[1]] / m };
}
function lum(f, px, py) {
  const x = Math.max(0, Math.min(W - 1, px)), y = Math.max(0, Math.min(W - 1, py)), i = (y * W + x) * 4;
  return (f.data[i] + f.data[i + 1] + f.data[i + 2]) / 3;
}
const solved = [];
for (let id = 0; id < 6; id++) {
  const here = stars.map(region).filter((r) => r.id === id);
  let best = { score: -1 }, second = -1;
  for (let fi = 0; fi < 6; fi++) for (let di = 0; di < 8; di++) {
    let s = 0;
    for (const r of here) {
      const [u, v] = D[di](r.a, r.b), px = Math.floor((u + 1) / 2 * W), py = Math.floor((v + 1) / 2 * W);
      let peak = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) peak = Math.max(peak, lum(faces[fi], px + dx, py + dy));
      s += peak;
    }
    s /= here.length;
    if (s > best.score) { second = best.score; best = { score: s, fi, di }; } else if (s > second) second = s;
  }
  solved[id] = best;
  console.log(`sky region ${id}: face ${names[best.fi]} transform ${best.di}, star match ${best.score.toFixed(0)} vs runner-up ${second.toFixed(0)} (${here.length} stars)`);
  if (best.score < second * 1.5) throw new Error('ambiguous sky orientation');
}
function sample(v) {
  const r = region(v), s = solved[r.id], f = faces[s.fi], [u, w] = D[s.di](r.a, r.b);
  const x = (u + 1) / 2 * W - 0.5, y = (w + 1) / 2 * W - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, out = [0, 0, 0];
  for (const [dx, dy, g] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
    const i = (Math.max(0, Math.min(W - 1, y0 + dy)) * W + Math.max(0, Math.min(W - 1, x0 + dx))) * 4;
    for (let c = 0; c < 3; c++) out[c] += f.data[i + c] * g;
  }
  return out;
}
const OW = 4096, OH = 2048, data = new Uint8Array(OW * OH * 4);
for (let y = 0; y < OH; y++) {
  const de = (0.5 - (y + 0.5) / OH) * Math.PI, c = Math.cos(de), z = Math.sin(de);
  for (let x = 0; x < OW; x++) {
    const ra = (x + 0.5) / OW * 2 * Math.PI, p = sample([c * Math.cos(ra), c * Math.sin(ra), z]), i = (y * OW + x) * 4;
    data[i] = p[0]; data[i + 1] = p[1]; data[i + 2] = p[2]; data[i + 3] = 255;
  }
}
mkdirSync('src/renderer/public/textures', { recursive: true });
writeFileSync('src/renderer/public/textures/milkyway.jpg', jpeg.encode({ data, width: OW, height: OH }, 88).data);
console.log('sky map written');
