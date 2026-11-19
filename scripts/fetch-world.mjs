// Downloads real data for the galaxy explorer (SIMBAD) and the Mars rover region (NASA Mars Trek).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'), retrieved = new Date().toISOString().slice(0, 10);
const put = (rel, data) => { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); console.log('wrote', rel); };
const OBJECTS = [['sgra', 'Sgr A*', 'blackhole', 0.02], ['lmc', 'LMC', 'irregular', 5], ['smc', 'SMC', 'irregular', 3], ['m31', 'M 31', 'spiral', 30], ['m33', 'M 33', 'spiral', 9], ['m81', 'M 81', 'spiral', 14], ['m82', 'M 82', 'irregular', 6], ['ngc253', 'NGC 253', 'spiral', 14], ['cena', 'NGC 5128', 'elliptical', 15], ['m51', 'M 51', 'spiral', 12], ['m101', 'M 101', 'spiral', 25], ['m104', 'M 104', 'lenticular', 15], ['m87', 'M 87', 'elliptical', 40]];
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
async function tap(query) {
  for (const host of ['https://simbad.cfa.harvard.edu', 'https://simbad.cds.unistra.fr']) {
    try { const r = await fetch(`${host}/simbad/sim-tap/sync?` + new URLSearchParams({ request: 'doQuery', lang: 'adql', format: 'json', query }), { signal: AbortSignal.timeout(40000) }); if (r.ok) return await r.json(); console.log(host, r.status); } catch (e) { console.log(host, String(e.message)); }
  }
  throw new Error('SIMBAD unavailable');
}
async function galaxies() {
  const out = [];
  for (const [id, name, kind, visualRadiusKpc] of OBJECTS) {
    const q = `SELECT b.ra, b.dec, d.dist, d.unit FROM ident AS i JOIN basic AS b ON i.oidref = b.oid LEFT JOIN mesDistance AS d ON d.oidref = b.oid WHERE i.id = '${name}'`, j = await tap(q), rows = j.data ?? [];
    if (!rows.length) throw new Error('not found ' + name);
    const scale = { pc: 1e-3, kpc: 1, Mpc: 1000 }, values = rows.map((r) => (r[2] > 0 && scale[String(r[3]).trim()] ? r[2] * scale[String(r[3]).trim()] : NaN)).filter(Number.isFinite);
    if (id === 'sgra') values.splice(0, values.length, 8.178); // GRAVITY Collaboration 2019, A&A 625, L10
    if (!values.length) throw new Error('no distance for ' + name);
    out.push({ id, simbad: name, kind, visualRadiusKpc, ra: rows[0][0], dec: rows[0][1], distanceKpc: +median(values).toPrecision(4), measurements: values.length }); console.log(id, out.at(-1).distanceKpc, 'kpc from', values.length, 'measurements');
  }
  put('src/renderer/src/data/generated/galaxies.json', JSON.stringify({ source: 'SIMBAD Astronomical Database (CDS)', url: 'https://simbad.cds.unistra.fr/simbad/', retrieved, objects: out }, null, 1) + '\n');
}
async function mars() {
  const tile = async (layer, ext, z, r, c) => { const u = `https://trek.nasa.gov/tiles/Mars/EQ/${layer}/1.0.0/default/default028mm/${z}/${r}/${c}.${ext}`, x = await fetch(u); if (!x.ok) throw new Error(u + ' ' + x.status); return Buffer.from(await x.arrayBuffer()); };
  // Viking colour mosaic around Jezero crater: 3 x 3 tiles at level 7.
  const N = 768, rgba = Buffer.alloc(N * N * 4, 255);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { const t = jpeg.decode(await tile('Mars_Viking_MDIM21_ClrMosaic_global_232m', 'jpg', 7, 49 + r, 182 + c), { useTArray: true }); for (let y = 0; y < 256; y++) t.data.copy ? 0 : 0, Buffer.from(t.data.buffer, t.data.byteOffset + y * 1024, 1024).copy(rgba, ((r * 256 + y) * N + c * 256) * 4); }
  put('src/renderer/public/mars/region.jpg', Buffer.from(jpeg.encode({ data: rgba, width: N, height: N }, 86).data));
  // MOLA elevation is available to level 5; the matching part of one tile is cut out and smoothed.
  const png = PNG.sync.read(await tile('Mars_MGS_MOLA_DEM_mosaic_global_463m_8', 'png', 5, 12, 45)), S = 5.625, west = (182 * 1.40625 - 180), north = 90 - 49 * 1.40625, span = 3 * 1.40625, lonLeft = 45 * S - 180, latTop = 90 - 12 * S, H = 257, h = new Uint16Array(H * H);
  const at = (x, y) => png.data[(Math.max(0, Math.min(255, y)) * 256 + Math.max(0, Math.min(255, x))) * 4];
  for (let j = 0; j < H; j++) for (let i = 0; i < H; i++) { const lon = west + (i / (H - 1)) * span, lat = north - (j / (H - 1)) * span, px = ((lon - lonLeft) / S) * 256, py = ((latTop - lat) / S) * 256, x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0; h[j * H + i] = Math.round(((at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy) * 256); }
  put('src/renderer/public/mars/elevation.bin', Buffer.from(h.buffer));
  put('src/renderer/src/data/generated/mars-region.json', JSON.stringify({ source: 'NASA Mars Trek: Viking MDIM 2.1 colour mosaic and MGS MOLA elevation', url: 'https://trek.nasa.gov/mars/', retrieved, name: 'Jezero', west, north, spanDeg: span, centerLat: north - span / 2, centerLon: west + span / 2, elevationSize: H }, null, 1) + '\n');
}
if (!process.argv.includes('--mars')) await galaxies();
if (!process.argv.includes('--galaxies')) await mars();
