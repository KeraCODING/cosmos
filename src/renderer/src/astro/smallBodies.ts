import type { V3 } from './ephemeris';

/** Mean anomalies in the catalogue are stored for this Julian date. */
export const SMALL_BODY_REF_JD = 2461000.5;
export const SMALL_BODY_REF_MS = (SMALL_BODY_REF_JD - 2440587.5) * 86400000;
export interface OrbitElements { a: number; e: number; i: number; om: number; w: number; M: number }
const rad = Math.PI / 180;
export const meanMotionDeg = (a: number) => 0.9856076686 / a ** 1.5;

/** Unit vectors of the orbit plane in the J2000 ecliptic frame: P toward perihelion, Q 90 degrees ahead. */
export function orbitBasis(iDeg: number, omDeg: number, wDeg: number): { P: V3; Q: V3 } {
  const i = iDeg * rad, O = omDeg * rad, w = wDeg * rad, ci = Math.cos(i), si = Math.sin(i), cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w);
  return { P: [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si], Q: [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si] };
}
/** Two-body heliocentric position in AU. The GPU evaluates the same formula for every asteroid on screen. */
export function keplerPosition(o: OrbitElements, daysFromRef: number): V3 {
  const M = (o.M + meanMotionDeg(o.a) * daysFromRef) * rad; let E = M + o.e * Math.sin(M);
  for (let n = 0; n < 6; n++) E -= (E - o.e * Math.sin(E) - M) / (1 - o.e * Math.cos(E));
  const x = o.a * (Math.cos(E) - o.e), y = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E), { P, Q } = orbitBasis(o.i, o.om, o.w);
  return [P[0] * x + Q[0] * y, P[1] * x + Q[1] * y, P[2] * x + Q[2] * y];
}
