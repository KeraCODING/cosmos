// Downloads real reference data. Nothing here is typed in by hand:
//  - src/renderer/src/data/generated/planet-facts.json  (NASA NSSDCA Planetary Fact Sheet)
//  - tests/fixtures/horizons-vectors.json               (JPL Horizons state vectors, used only by tests)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const retrieved = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function save(rel, data) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
  console.log('wrote', rel);
}

const clean = (s) =>
  s.replace(/<sup>(.*?)<\/sup>/gi, '^$1').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

async function factSheet() {
  const url = 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/';
  const html = await (await fetch(url)).text();
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => clean(c[1])),
  );
  const header = rows.find((r) => r.some((c) => c.toUpperCase() === 'MERCURY'));
  if (!header) throw new Error('fact sheet header not found');
  const names = header.map((c) => c.toLowerCase());
  const fields = {
    massE24Kg: /^Mass/, diameterKm: /^Diameter/, densityKgM3: /^Density/, gravityMS2: /^Gravity/,
    escapeVelocityKmS: /^Escape Velocity/, rotationPeriodH: /^Rotation Period/, lengthOfDayH: /^Length of Day/,
    distanceFromSunE6Km: /^Distance from Sun/, orbitalPeriodDays: /^Orbital Period/,
    orbitalVelocityKmS: /^Orbital Velocity/, orbitalInclinationDeg: /^Orbital Inclination/,
    orbitalEccentricity: /^Orbital Eccentricity/, obliquityDeg: /^Obliquity/, meanTemperatureC: /^Mean Temperature/,
    moons: /^Number of Moons/,
  };
  const out = {};
  for (const [key, re] of Object.entries(fields)) {
    const row = rows.find((r) => re.test(r[0] ?? ''));
    if (!row) throw new Error('missing row ' + key);
    names.forEach((n, i) => {
      if (i === 0 || n === '') return;
      const raw = (row[i] ?? '').replace(/[*,]/g, '').trim();
      const v = Number(raw);
      (out[n] ??= {})[key] = raw !== '' && Number.isFinite(v) ? v : null; // "Unknown" stays null, never guessed
    });
  }
  save('src/renderer/src/data/generated/planet-facts.json', {
    source: 'NASA NSSDCA Planetary Fact Sheet', url, retrieved, bodies: out,
  });
}

async function vector(command, center, date) {
  const next = new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  const q = new URLSearchParams({
    format: 'json', COMMAND: `'${command}'`, OBJ_DATA: 'NO', MAKE_EPHEM: 'YES', EPHEM_TYPE: 'VECTORS',
    CENTER: `'${center}'`, START_TIME: `'${date}'`, STOP_TIME: `'${next}'`, STEP_SIZE: `'1d'`,
    OUT_UNITS: `'AU-D'`, REF_PLANE: `'ECLIPTIC'`, REF_SYSTEM: `'ICRF'`, VEC_TABLE: `'1'`, CSV_FORMAT: `'NO'`,
  });
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://ssd.jpl.nasa.gov/api/horizons.api?' + q);
    if (res.ok) {
      const { result } = await res.json();
      const body = result.split('$$SOE')[1];
      const jd = Number(/([\d.]+) = A\.D\./.exec(body)[1]);
      const m = /X\s*=\s*(\S+)\s*Y\s*=\s*(\S+)\s*Z\s*=\s*(\S+)/.exec(body);
      return { jdTdb: jd, au: [Number(m[1]), Number(m[2]), Number(m[3])] };
    }
    await sleep(1500 * (attempt + 1));
  }
  throw new Error('Horizons failed for ' + command);
}

async function fixtures() {
  const dates = ['1950-06-15', '2000-01-01', '2024-01-01', '2026-11-18', '2045-03-10'];
  const bodies = { mercury: '199', venus: '299', emb: '3', mars: '499', jupiter: '5', saturn: '6', uranus: '7', neptune: '8' };
  const out = { source: 'JPL Horizons API', retrieved, frame: 'ecliptic J2000, AU', heliocentric: {}, moonGeocentric: [] };
  for (const [name, id] of Object.entries(bodies)) {
    out.heliocentric[name] = [];
    for (const d of dates) { out.heliocentric[name].push({ date: d, ...(await vector(id, '500@10', d)) }); await sleep(120); }
    console.log('horizons', name);
  }
  for (const d of dates) { out.moonGeocentric.push({ date: d, ...(await vector('301', '500@399', d)) }); await sleep(120); }
  save('tests/fixtures/horizons-vectors.json', out);
}

async function sunFacts() {
  const url = 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html';
  const text = clean(await (await fetch(url)).text());
  const grab = (re) => { const m = re.exec(text); if (!m) throw new Error('sun fact missing ' + re); return Number(m[1].replace(/,/g, '')); };
  save('src/renderer/src/data/generated/sun-facts.json', {
    source: 'NASA NSSDCA Sun Fact Sheet', url, retrieved,
    massE24Kg: grab(/Mass \(10\^24 kg\)\s+([\d,.]+)/),
    radiusKm: grab(/Volumetric mean radius \(km\)\s+([\d,.]+)/),
    densityKgM3: grab(/Mean density \(kg\/m\^3\)\s+([\d,.]+)/),
    gravityMS2: grab(/Surface gravity \(eq\.\) \(m\/s\^2\)\s+([\d,.]+)/),
    escapeVelocityKmS: grab(/Escape velocity \(km\/s\)\s+([\d,.]+)/),
  });
}

async function naturalEarth() {
  const base = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
  for (const f of ['ne_110m_admin_0_boundary_lines_land.geojson', 'ne_110m_populated_places_simple.geojson']) {
    const res = await fetch(base + f);
    if (!res.ok) throw new Error('natural earth ' + f);
    const p = join(root, 'src/renderer/public/geo', f);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, await res.text());
    console.log('wrote', f);
  }
}

async function stars() {
  const url = 'https://vizier.cfa.harvard.edu/viz-bin/asu-tsv?-source=I/239/hip_main&-out=RAICRS,DEICRS,Vmag,B-V&Vmag=%3C6.5&-out.max=20000';
  const text = await (await fetch(url)).text();
  const rows = [];
  for (const line of text.split('\n')) {
    const c = line.split('\t');
    if (c.length < 3) continue;
    const [ra, de, v] = c.slice(0, 3).map(Number);
    if (!c[0].trim() || !c[2].trim() || ![ra, de, v].every(Number.isFinite)) continue;
    const bv = Number(c[3]);
    rows.push(+ra.toFixed(3), +de.toFixed(3), +v.toFixed(2), c[3]?.trim() && Number.isFinite(bv) ? +bv.toFixed(2) : 0.6);
  }
  if (rows.length < 4 * 5000) throw new Error('star catalogue too small: ' + rows.length / 4);
  save('src/renderer/src/data/generated/stars.json', {
    source: 'ESA Hipparcos Catalogue (I/239) via CDS VizieR', url: 'https://vizier.cfa.harvard.edu/viz-bin/VizieR?-source=I/239', retrieved,
    limitVmag: 6.5, columns: ['raDeg', 'decDeg', 'vMag', 'bMinusV'], count: rows.length / 4, rows,
  });
}

/** Binary catalogues loaded on demand: every Hipparcos star, and osculating orbits of real numbered small bodies. */
async function skyData() {
  const REF_JD = 2461000.5, dir = join(root, 'src/renderer/public/data'); mkdirSync(dir, { recursive: true });
  const text = await (await fetch('https://vizier.cfa.harvard.edu/viz-bin/asu-tsv?-source=I/239/hip_main&-out=RAICRS,DEICRS,Vmag,B-V&Vmag=%3C13&-out.max=200000')).text(), stars = [];
  for (const line of text.split('\n')) { const c = line.split('\t'); if (c.length < 3 || !/^\d/.test(c[0])) continue; const [ra, de, v] = c.slice(0, 3).map(Number), bv = Number(c[3]); if ([ra, de, v].every(Number.isFinite) && c[2].trim()) stars.push([ra, de, v, c[3]?.trim() && Number.isFinite(bv) ? bv : 0.6]); }
  if (stars.length < 100000) throw new Error('star catalogue too small: ' + stars.length);
  stars.sort((p, q) => p[2] - q[2]); writeFileSync(join(dir, 'stars.bin'), Buffer.from(Float32Array.from(stars.flat()).buffer));
  const rows = [], groups = [['MBA', 12000, 0], ['TJN', 1800, 1], ['TNO', 1800, 2]];
  for (const [cls, limit, group] of groups) {
    const q = new URLSearchParams({ fields: 'a,e,i,om,w,ma,epoch,H', 'sb-kind': 'a', 'sb-class': cls, sort: 'H', limit: String(limit), 'full-prec': '1' }), res = await fetch('https://ssd-api.jpl.nasa.gov/sbdb_query.api?' + q);
    if (!res.ok) throw new Error('SBDB ' + cls + ' ' + res.status); const { data } = await res.json();
    for (const d of data) { const [A, e, i, om, w, ma, epoch, H] = d.map(Number); if (![A, e, i, om, w, ma, epoch].every(Number.isFinite) || e >= 0.6 || A <= 0) continue; const n = 0.9856076686 / A ** 1.5, M = (((ma + n * (REF_JD - epoch)) % 360) + 360) % 360; rows.push([A, e, i, om, w, M, Number.isFinite(H) ? H : 15, group]); }
    console.log('small bodies', cls, data.length); await sleep(400);
  }
  writeFileSync(join(dir, 'small-bodies.bin'), Buffer.from(Float32Array.from(rows.flat()).buffer));
  save('src/renderer/src/data/generated/sky-meta.json', { retrieved, stars: { source: 'ESA Hipparcos Catalogue (I/239) via CDS VizieR', count: stars.length }, smallBodies: { source: 'JPL Small-Body Database Query API', count: rows.length, refJd: REF_JD } });
  const ceres = []; for (const d of ['2026-01-01', '2026-11-18', '2028-01-01']) { ceres.push({ date: d, ...(await vector('1;', '500@10', d)) }); await sleep(150); }
  const info = (await (await fetch('https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=1&full-prec=1')).json()).orbit, el = (n) => Number(info.elements.find((x) => x.name === n).value), orbit = [el('a'), el('e'), el('i'), el('om'), el('w'), el('ma'), Number(info.epoch)];
  save('tests/fixtures/ceres.json', { source: 'JPL Horizons and SBDB', retrieved, orbit, vectors: ceres });
}
if (process.argv.includes('--sky')) { await skyData(); process.exit(0); }
if (process.argv.includes('--stars-only')) { await stars(); process.exit(0); }
await factSheet();
await sunFacts();
await stars();
await naturalEarth();
if (!process.argv.includes('--no-fixtures')) await fixtures();
