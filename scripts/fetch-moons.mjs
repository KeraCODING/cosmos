// Fits mean orbits of major moons to a year of JPL Horizons elements, in each planet's equatorial frame,
// where orbits precess almost uniformly. Writes the app data and independent test vectors.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'), retrieved = new Date().toISOString().slice(0, 10), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOONS = [['phobos', 401, 'mars', 499], ['deimos', 402, 'mars', 499], ['io', 501, 'jupiter', 599], ['europa', 502, 'jupiter', 599], ['ganymede', 503, 'jupiter', 599], ['callisto', 504, 'jupiter', 599], ['mimas', 601, 'saturn', 699], ['enceladus', 602, 'saturn', 699], ['tethys', 603, 'saturn', 699], ['dione', 604, 'saturn', 699], ['rhea', 605, 'saturn', 699], ['titan', 606, 'saturn', 699], ['iapetus', 608, 'saturn', 699], ['miranda', 705, 'uranus', 799], ['ariel', 701, 'uranus', 799], ['umbriel', 702, 'uranus', 799], ['titania', 703, 'uranus', 799], ['oberon', 704, 'uranus', 799], ['triton', 801, 'neptune', 899]];
async function horizons(params) {
  const q = new URLSearchParams({ format: 'json', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, `'${v}'`])) });
  for (let i = 0; i < 5; i++) { const r = await fetch('https://ssd.jpl.nasa.gov/api/horizons.api?' + q); if (r.ok) { const j = await r.json(); if (j.result?.includes('$$SOE')) return j.result; throw new Error('Horizons: ' + String(j.result ?? j.error).slice(0, 300)); } await sleep(1500 * (i + 1)); }
  throw new Error('Horizons unavailable');
}
const num = (block, key) => { const m = new RegExp(`(?:^|\\s)${key}\\s*=\\s*(\\S+)`).exec(block); if (!m) throw new Error('missing ' + key); return Number(m[1]); };
function radiusKm(text, name) {
  const m = /(?:Vol\. )?(?:Mean )?Radius(?:,? *\(?km\)?| \(km\))\s*=\s*([\d.]+)(?:\s*[x+-]\s*([\d.]+))?(?:\s*x\s*([\d.]+))?/i.exec(text); if (!m) throw new Error('radius missing for ' + name);
  const a = Number(m[1]), b = /x/i.test(m[0].slice(m[0].indexOf(m[1]))) ? Number(m[2]) : NaN, c = Number(m[3]); return Number.isFinite(b) && Number.isFinite(c) ? Math.cbrt(a * b * c) : a;
}
function fit(t, y) { const n = t.length, mt = t.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n; let s = 0, d = 0; t.forEach((v, i) => { s += (v - mt) * (y[i] - my); d += (v - mt) ** 2; }); return { rate: s / d, at: my - (s / d) * mt }; }
const unwrap = (a, predicted = () => 0) => { const o = [a[0]]; for (let i = 1; i < a.length; i++) { const p = o[i - 1] + predicted(i); o.push(a[i] + 360 * Math.round((p - a[i]) / 360)); } return o; };

const REF_JD = 2461041.5, moons = [], vectors = {};
for (const [id, naif, parent, center] of MOONS) {
  const text = await horizons({ COMMAND: naif, OBJ_DATA: 'YES', MAKE_EPHEM: 'YES', EPHEM_TYPE: 'ELEMENTS', CENTER: `500@${center}`, START_TIME: '2026-01-01', STOP_TIME: '2027-01-01', STEP_SIZE: '5 d', OUT_UNITS: 'KM-D', REF_PLANE: 'BODY', REF_SYSTEM: 'ICRF', TP_TYPE: 'ABSOLUTE', CSV_FORMAT: 'NO' });
  const body = text.split('$$SOE')[1].split('$$EOE')[0], rows = body.split(/(?=\d{7}\.\d+ = A\.D\.)/).filter((b) => /A\.D\./.test(b)).map((b) => ({ t: Number(/^([\d.]+)/.exec(b.trim())[1]) - REF_JD, e: num(b, 'EC'), i: num(b, 'IN'), om: num(b, 'OM'), w: num(b, 'W'), n: num(b, 'N'), ma: num(b, 'MA'), a: num(b, 'A') }));
  const t = rows.map((r) => r.t), avg = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length, n0 = avg('n'), om = fit(t, unwrap(rows.map((r) => r.om))), w = fit(t, unwrap(rows.map((r) => (r.w + r.om) % 360))), u = fit(t, unwrap(rows.map((r) => (r.w + r.ma + r.om) % 360), (i) => n0 * (t[i] - t[i - 1])));
  // Longitudes are measured through the node so that nearly circular or equatorial orbits stay well defined.
  moons.push({ id, naif, parent, radiusKm: +radiusKm(text.split('$$SOE')[0], id).toFixed(2), a: +avg('a').toFixed(2), e: +avg('e').toFixed(6), i: +avg('i').toFixed(5), node: +om.at.toFixed(5), nodeRate: +om.rate.toFixed(8), peri: +w.at.toFixed(5), periRate: +w.rate.toFixed(8), lon: +u.at.toFixed(5), lonRate: +u.rate.toFixed(8), periodDays: +(360 / Math.abs(u.rate)).toFixed(5) });
  vectors[id] = [];
  for (const d of ['2026-03-10', '2026-11-19', '2027-02-15']) { const next = new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10), v = await horizons({ COMMAND: naif, OBJ_DATA: 'NO', MAKE_EPHEM: 'YES', EPHEM_TYPE: 'VECTORS', CENTER: `500@${center}`, START_TIME: d, STOP_TIME: next, STEP_SIZE: '1 d', OUT_UNITS: 'KM-D', REF_PLANE: 'ECLIPTIC', REF_SYSTEM: 'ICRF', VEC_TABLE: '1' }), b = v.split('$$SOE')[1]; vectors[id].push({ date: d, jdTdb: Number(/([\d.]+) = A\.D\./.exec(b)[1]), km: [num(b, 'X'), num(b, 'Y'), num(b, 'Z')] }); await sleep(100); }
  console.log(id, moons.at(-1).radiusKm, 'km, a', moons.at(-1).a, 'P', moons.at(-1).periodDays); await sleep(150);
}
const save = (rel, data) => { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(data, null, 1) + '\n'); };
save('src/renderer/src/data/generated/moons.json', { source: 'JPL Horizons', url: 'https://ssd.jpl.nasa.gov/horizons/', retrieved, refJd: REF_JD, moons });
save('tests/fixtures/moon-vectors.json', { source: 'JPL Horizons', retrieved, frame: 'planet-centred, ecliptic J2000, km', vectors });
