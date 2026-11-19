// Planetary moons. Galilean moons use astronomy-engine's dedicated theory; the others use mean orbits fitted to JPL Horizons.
import * as A from 'astronomy-engine';
import data from '../data/generated/moons.json';

export const SATELLITES = data.moons;
export const SATELLITE_IDS = ['phobos', 'deimos', 'io', 'europa', 'ganymede', 'callisto', 'mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'titan', 'iapetus', 'miranda', 'ariel', 'umbriel', 'titania', 'oberon', 'triton'] as const;
export type SatelliteId = (typeof SATELLITE_IDS)[number];
type V = [number, number, number];
const byId = new Map(SATELLITES.map((m) => [m.id, m])), rad = Math.PI / 180, AU_KM = 149597870.7;
export const satellite = (id: string) => byId.get(id);
export const satellitesOf = (parent: string) => SATELLITES.filter((m) => m.parent === parent);
const PLANET: Record<string, A.Body> = { mars: A.Body.Mars, jupiter: A.Body.Jupiter, saturn: A.Body.Saturn, uranus: A.Body.Uranus, neptune: A.Body.Neptune };
const EQJ_ECL = A.Rotation_EQJ_ECL(), REF_TIME = A.MakeTime(new Date(Date.UTC(2026, 6, 1)));
const toEcl = (v: V): V => { const r = A.RotateVector(EQJ_ECL, new A.Vector(v[0], v[1], v[2], REF_TIME)); return [r.x, r.y, r.z]; };
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** Axes of each planet's equatorial frame, expressed in the J2000 ecliptic. */
const frames = new Map<string, { x: V; y: V; z: V }>();
function frame(parent: string) {
  let f = frames.get(parent);
  if (!f) { const n = A.RotationAxis(PLANET[parent], REF_TIME).north, z: V = [n.x, n.y, n.z], x = unit(cross([0, 0, 1], z)), y = cross(z, x); f = { x: toEcl(x), y: toEcl(y), z: toEcl(z) }; frames.set(parent, f); }
  return f;
}
let jovian: { t: number; v: A.JupiterMoonsInfo } | null = null;
const GALILEAN: Record<string, 'io' | 'europa' | 'ganymede' | 'callisto'> = { io: 'io', europa: 'europa', ganymede: 'ganymede', callisto: 'callisto' };

/** Position relative to the parent planet in km, J2000 ecliptic. `time` is a date or engine time. */
export function satelliteOffsetKm(id: string, time: Date | A.AstroTime): V {
  const t = time instanceof A.AstroTime ? time : A.MakeTime(time), g = GALILEAN[id];
  if (g) { if (jovian?.t !== t.tt) jovian = { t: t.tt, v: A.JupiterMoons(t) }; const s = jovian.v[g]; return toEcl([s.x, s.y, s.z]).map((c) => c * AU_KM) as V; }
  const m = byId.get(id)!, d = t.tt + 2451545 - data.refJd, node = (m.node + m.nodeRate * d) * rad, peri = (m.peri + m.periRate * d) * rad, lon = (m.lon + m.lonRate * d) * rad, M = lon - peri, w = peri - node, i = m.i * rad, e = m.e;
  let E = M + e * Math.sin(M); for (let k = 0; k < 6; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const px = m.a * (Math.cos(E) - e), py = m.a * Math.sqrt(1 - e * e) * Math.sin(E), cw = Math.cos(w), sw = Math.sin(w), x1 = px * cw - py * sw, y1 = px * sw + py * cw, cn = Math.cos(node), sn = Math.sin(node), ci = Math.cos(i), si = Math.sin(i);
  const x = x1 * cn - y1 * ci * sn, y = x1 * sn + y1 * ci * cn, z = y1 * si, f = frame(m.parent);
  return [0, 1, 2].map((k) => f.x[k] * x + f.y[k] * y + f.z[k] * z) as V;
}
