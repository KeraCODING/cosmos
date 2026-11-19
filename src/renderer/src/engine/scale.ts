import { AU_KM, length, type V3 } from '../astro/ephemeris';

export type ScaleMode = 'true' | 'educational';
/** True scale: one scene unit is one million kilometres. */
export const KM_PER_UNIT = 1e6;
export const EDU_DISTANCE = 46;
const AU_UNITS = AU_KM / KM_PER_UNIT;

/** Maps ecliptic (x, y, north) to scene axes (x, north, -y). */
export const toScene = (v: V3): V3 => [v[0], v[2], -v[1]];

export function sceneRadius(mode: ScaleMode, id: string, radiusKm: number) {
  if (mode === 'true') return radiusKm / KM_PER_UNIT;
  return id === 'sun' ? 9 : Math.max(0.14, 0.75 * Math.sqrt(radiusKm / 1000));
}
export function sceneHelio(mode: ScaleMode, au: V3): V3 {
  if (mode === 'true') return toScene([au[0] * AU_UNITS, au[1] * AU_UNITS, au[2] * AU_UNITS]);
  const r = length(au);
  if (r === 0) return [0, 0, 0];
  const k = (EDU_DISTANCE * Math.sqrt(r)) / r;
  return toScene([au[0] * k, au[1] * k, au[2] * k]);
}
/** Offset of the Moon from Earth. In educational scale the distance is deliberately compressed. */
export function sceneMoonOffset(mode: ScaleMode, geoAu: V3, earthRadius: number): V3 {
  const k = mode === 'true' ? AU_UNITS : (earthRadius * 2.6) / (length(geoAu) || 1);
  return toScene([geoAu[0] * k, geoAu[1] * k, geoAu[2] * k]);
}
/** A moon's offset from its planet. In educational scale the direction is real and the distance is compressed. */
export function sceneSatelliteOffset(mode: ScaleMode, au: V3, parentRadius: number, parentKm: number): V3 {
  const r = length(au) || 1, k = mode === 'true' ? AU_UNITS : (parentRadius * (1.35 + 0.55 * Math.sqrt((r * AU_KM) / parentKm))) / r;
  return toScene([au[0] * k, au[1] * k, au[2] * k]);
}
export const homeDistance = (mode: ScaleMode) => (mode === 'true' ? 9000 : 480);
export const maxDistance = (mode: ScaleMode) => (mode === 'true' ? 60000 : 1200);
