import { describe, expect, it } from 'vitest';
import fixture from './fixtures/moon-vectors.json';
import { SATELLITES, satelliteOffsetKm } from '../src/renderer/src/astro/satellites';
import { makeTimeFromJd } from './helpers';

const separationDeg = (a: number[], b: number[]) => (Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b)))) * 180) / Math.PI;
describe('planetary moons agree with JPL Horizons', () => {
  for (const m of SATELLITES) it(`${m.id} position angle around its planet`, () => {
    const errors = (fixture.vectors as Record<string, { jdTdb: number; km: number[] }[]>)[m.id].map((r) => separationDeg(satelliteOffsetKm(m.id, makeTimeFromJd(r.jdTdb)), r.km));
    expect(Math.max(...errors)).toBeLessThan(m.id === 'phobos' || m.id === 'deimos' ? 4 : 1);
  });
});
