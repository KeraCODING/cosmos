// Positions and orientations from astronomy-engine (VSOP87 / NOVAS-derived models, IAU rotation elements).
// All vectors are in the J2000 mean ecliptic frame. Distances are AU unless stated otherwise.
import * as A from 'astronomy-engine';
import { satellite, satelliteOffsetKm, SATELLITE_IDS } from './satellites';

export type V3 = [number, number, number];
const PRIMARY_IDS = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] as const;
type PrimaryId = (typeof PRIMARY_IDS)[number];
export const BODY_IDS = [...PRIMARY_IDS, ...SATELLITE_IDS] as const;
export type BodyId = (typeof BODY_IDS)[number];
export const AU_KM = 149597870.7;

const BODY: Record<PrimaryId, A.Body> = {
  sun: A.Body.Sun, mercury: A.Body.Mercury, venus: A.Body.Venus, earth: A.Body.Earth, moon: A.Body.Moon,
  mars: A.Body.Mars, jupiter: A.Body.Jupiter, saturn: A.Body.Saturn, uranus: A.Body.Uranus, neptune: A.Body.Neptune,
};
const EQJ_ECL = A.Rotation_EQJ_ECL();
const rad = Math.PI / 180;

const toEcl = (x: number, y: number, z: number, t: A.AstroTime): V3 => {
  const v = A.RotateVector(EQJ_ECL, new A.Vector(x, y, z, t));
  return [v.x, v.y, v.z];
};
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: V3): V3 => { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export const astroTime = (date: Date | A.AstroTime) => (date instanceof A.AstroTime ? date : A.MakeTime(date));

export function helioEcliptic(id: BodyId, date: Date | A.AstroTime): V3 {
  if (id === 'sun') return [0, 0, 0];
  const sat = satellite(id);
  if (sat) { const p = helioEcliptic(sat.parent as BodyId, date), o = satelliteOffsetKm(id, astroTime(date)); return [p[0] + o[0] / AU_KM, p[1] + o[1] / AU_KM, p[2] + o[2] / AU_KM]; }
  const t = astroTime(date), v = A.HelioVector(BODY[id as PrimaryId], t);
  return toEcl(v.x, v.y, v.z, t);
}
export function emBarycenterEcliptic(date: Date | A.AstroTime): V3 {
  const t = astroTime(date), v = A.HelioVector(A.Body.EMB, t);
  return toEcl(v.x, v.y, v.z, t);
}
export function geoMoonEcliptic(date: Date | A.AstroTime): V3 {
  const t = astroTime(date), v = A.GeoMoon(t);
  return toEcl(v.x, v.y, v.z, t);
}

export interface BodyBasis { north: V3; primeMeridian: V3; east: V3; spinDeg: number }

/** Body-fixed axes in the ecliptic frame, following the IAU pole / prime-meridian definition. */
export function bodyBasis(id: BodyId, date: Date | A.AstroTime): BodyBasis {
  if (satellite(id)) {
    // These moons are treated as tidally locked: one face toward the planet, spinning once per orbit.
    const t = astroTime(date), o = satelliteOffsetKm(id, t), o2 = satelliteOffsetKm(id, t.AddDays(0.005)), north = normalize(cross(o, [o2[0] - o[0], o2[1] - o[1], o2[2] - o[2]])), primeMeridian = normalize([-o[0], -o[1], -o[2]]);
    return { north, primeMeridian, east: cross(north, primeMeridian), spinDeg: 0 };
  }
  const t = astroTime(date), axis = A.RotationAxis(BODY[id as PrimaryId], t);
  const pole: V3 = [axis.north.x, axis.north.y, axis.north.z];
  const node = normalize(cross([0, 0, 1], pole));
  const q2 = cross(pole, node), w = axis.spin * rad, c = Math.cos(w), s = Math.sin(w);
  const pm: V3 = [node[0] * c + q2[0] * s, node[1] * c + q2[1] * s, node[2] * c + q2[2] * s];
  const north = toEcl(...pole, t), primeMeridian = toEcl(...pm, t);
  return { north, primeMeridian, east: cross(north, primeMeridian), spinDeg: axis.spin };
}

/** Sub-solar point on a body in planetographic-style east longitude and latitude, degrees. */
export function subsolarPoint(id: BodyId, date: Date | A.AstroTime) {
  const b = bodyBasis(id, date), p = helioEcliptic(id, date), s = normalize([-p[0], -p[1], -p[2]]);
  return { latDeg: Math.asin(dot(s, b.north)) / rad, lonDeg: Math.atan2(dot(s, b.east), dot(s, b.primeMeridian)) / rad };
}

/** Angle between a body's angular-momentum vector and the pole of its own orbit, degrees (over 90 means retrograde). */
export function obliquityDeg(id: BodyId, date: Date): number {
  const later = new Date(date.getTime() + 86400000), a = helioEcliptic(id, date), b = helioEcliptic(id, later);
  const orbitPole = normalize(cross(a, [b[0] - a[0], b[1] - a[1], b[2] - a[2]]));
  const basis = bodyBasis(id, date), sense = Math.sign(bodyBasis(id, later).spinDeg - basis.spinDeg);
  return Math.acos(Math.max(-1, Math.min(1, sense * dot(orbitPole, basis.north)))) / rad;
}

/** True orbit sampled from the ephemeris: heliocentric for planets, relative to the parent for moons. */
export function orbitSamples(id: BodyId, center: Date, periodDays: number, n: number): V3[] {
  const out: V3[] = [], t0 = center.getTime() - (periodDays * 86400000) / 2;
  for (let i = 0; i <= n; i++) {
    const d = new Date(t0 + (i / n) * periodDays * 86400000);
    if (satellite(id)) { const o = satelliteOffsetKm(id, d); out.push([o[0] / AU_KM, o[1] / AU_KM, o[2] / AU_KM]); } else out.push(id === 'moon' ? geoMoonEcliptic(d) : helioEcliptic(id, d));
  }
  return out;
}
