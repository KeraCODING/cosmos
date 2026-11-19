import { helioEcliptic, length, type BodyId, type V3 } from '../astro/ephemeris';
import { bodyById } from './catalog';
import { AU_KM } from '../astro/ephemeris';

export type HorizonsCheck =
  | { ok: true; differenceKm: number; fetchedAt: string; fromCache: boolean; epoch: Date }
  | { ok: false; reason: 'offline' | 'network' | 'parse' };

export function parseHorizonsVector(result: string): V3 | null {
  const body = result.split('$$SOE')[1];
  const m = body && /X\s*=\s*(\S+)\s*Y\s*=\s*(\S+)\s*Z\s*=\s*(\S+)/.exec(body);
  if (!m) return null;
  const v: V3 = [Number(m[1]), Number(m[2]), Number(m[3])];
  return v.every(Number.isFinite) ? v : null;
}

/** Compares the on-screen model with a live JPL Horizons vector for the same instant (rounded to the minute for caching). */
export async function checkAgainstHorizons(id: BodyId, simDate: Date): Promise<HorizonsCheck> {
  const naif = bodyById(id)?.naifId;
  if (!naif || id === 'sun') return { ok: false, reason: 'parse' };
  const epoch = new Date(Math.round(simDate.getTime() / 60000) * 60000);
  const stamp = epoch.toISOString().slice(0, 16).replace('T', ' ');
  const stop = new Date(epoch.getTime() + 60000).toISOString().slice(0, 16).replace('T', ' ');
  const q = new URLSearchParams({
    format: 'json', COMMAND: `'${naif}'`, OBJ_DATA: 'NO', MAKE_EPHEM: 'YES', EPHEM_TYPE: 'VECTORS', CENTER: `'500@10'`,
    START_TIME: `'${stamp}'`, STOP_TIME: `'${stop}'`, STEP_SIZE: `'1m'`, OUT_UNITS: `'AU-D'`, REF_PLANE: `'ECLIPTIC'`, REF_SYSTEM: `'ICRF'`,
    VEC_TABLE: `'1'`, TIME_TYPE: `'UT'`,
  });
  const r = await window.cosmos.fetchJson(`https://ssd.jpl.nasa.gov/api/horizons.api?${q}`);
  if ('error' in r) return { ok: false, reason: r.error };
  const v = parseHorizonsVector(String((r.data as { result?: string }).result ?? ''));
  if (!v) return { ok: false, reason: 'parse' };
  const m = helioEcliptic(id, epoch);
  return { ok: true, differenceKm: length([m[0] - v[0], m[1] - v[1], m[2] - v[2]]) * AU_KM, fetchedAt: r.fetchedAt, fromCache: r.fromCache, epoch };
}
