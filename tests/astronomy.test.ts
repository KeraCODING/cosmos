import { describe, expect, it } from 'vitest';
import { makeTimeFromJd } from './helpers';
import fixtures from './fixtures/horizons-vectors.json';
import facts from '../src/renderer/src/data/generated/planet-facts.json';
import { bodyBasis, emBarycenterEcliptic, geoMoonEcliptic, helioEcliptic, length, obliquityDeg, orbitSamples, subsolarPoint, AU_KM, type BodyId, type V3 } from '../src/renderer/src/astro/ephemeris';
import ceres from './fixtures/ceres.json';
import { keplerPosition, orbitBasis } from '../src/renderer/src/astro/smallBodies';
import { nextSpinTime } from '../src/renderer/src/sim/clock';
import { listEvents } from '../src/renderer/src/astro/events';

const km = (a: V3, b: number[]) => length([a[0] - b[0], a[1] - b[1], a[2] - b[2]]) * AU_KM;
// Limits are about 1 arcminute as seen from the Sun, the documented accuracy class of the engine.
const LIMIT_KM: Record<string, number> = { mercury: 60000, venus: 60000, emb: 60000, mars: 90000, jupiter: 400000, saturn: 800000, uranus: 1600000, neptune: 2500000 };

describe('positions agree with JPL Horizons', () => {
  for (const [name, rows] of Object.entries(fixtures.heliocentric)) {
    it(name, () => {
      for (const r of rows) {
        const t = makeTimeFromJd(r.jdTdb);
        const m = name === 'emb' ? emBarycenterEcliptic(t) : helioEcliptic(name as BodyId, t);
        expect(km(m, r.au)).toBeLessThan(LIMIT_KM[name]);
      }
    });
  }
  it('Moon is good enough to place eclipses (under 100 km)', () => {
    for (const r of fixtures.moonGeocentric) expect(km(geoMoonEcliptic(makeTimeFromJd(r.jdTdb)), r.au)).toBeLessThan(100);
  });
});

describe('rotation', () => {
  const d = new Date('2026-01-01T00:00:00Z'), body = facts.bodies as unknown as Record<string, { obliquityDeg: number; rotationPeriodH: number }>;
  for (const id of ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] as BodyId[]) {
    it(`${id} axial tilt matches NASA`, () => expect(Math.abs(obliquityDeg(id, d) - body[id].obliquityDeg)).toBeLessThan(1));
    it(`${id} spin rate and direction match NASA`, () => {
      const hours = 0.01 * Math.abs(body[id].rotationPeriodH);
      const a = bodyBasis(id, d).spinDeg, b = bodyBasis(id, new Date(d.getTime() + hours * 3600000)).spinDeg;
      // spin is continuous in degrees; a negative NASA period means retrograde
      expect((b - a) / 3.6).toBeCloseTo(Math.sign(body[id].rotationPeriodH), 1);
    });
  }
  it('Sun is overhead near the Greenwich meridian at noon UT on the June solstice', () => {
    const s = subsolarPoint('earth', new Date('2024-06-20T12:00:00Z'));
    expect(Math.abs(s.lonDeg)).toBeLessThan(2);
    expect(s.latDeg).toBeCloseTo(23.43, 0);
  });
  it('Sun crosses the equator at the March equinox', () => expect(Math.abs(subsolarPoint('earth', new Date('2024-03-20T03:06:00Z')).latDeg)).toBeLessThan(0.02));
});

describe('orbits', () => {
  it('closes after one orbital period', () => {
    const s = orbitSamples('mars', new Date('2026-01-01T00:00:00Z'), 686.98, 64);
    expect(length([s[0][0] - s[64][0], s[0][1] - s[64][1], s[0][2] - s[64][2]])).toBeLessThan(0.02);
  });
});

describe('astronomical events', () => {
  const nearest = (kind: string, iso: string) => {
    const t = new Date(iso), ev = listEvents(new Date(t.getTime() - 5 * 86400000), 10).filter((e) => e.kind === kind);
    return ev.map((e) => ({ e, dt: Math.abs(e.date.getTime() - t.getTime()) })).sort((a, b) => a.dt - b.dt)[0];
  };
  it('finds the total solar eclipse of 8 April 2024', () => { const r = nearest('solarEclipse', '2024-04-08T18:17:00Z'); expect(r.e.detail).toBe('total'); expect(r.dt).toBeLessThan(600000); });
  it('finds the total solar eclipse of 12 August 2026', () => { const r = nearest('solarEclipse', '2026-08-12T17:46:00Z'); expect(r.e.detail).toBe('total'); expect(r.dt).toBeLessThan(600000); });
  it('finds the total lunar eclipse of 14 March 2025', () => { const r = nearest('lunarEclipse', '2025-03-14T06:59:00Z'); expect(r.e.detail).toBe('total'); expect(r.dt).toBeLessThan(600000); });
  it('returns events in order and inside the window', () => {
    const s = new Date('2027-01-01T00:00:00Z'), ev = listEvents(s, 365);
    expect(ev.filter((e) => e.kind === 'season')).toHaveLength(4);
    expect(ev.filter((e) => e.kind === 'fullMoon').length).toBeGreaterThanOrEqual(12);
    ev.forEach((e, i) => { expect(e.date >= s).toBe(true); if (i) expect(e.date >= ev[i - 1].date).toBe(true); });
  });
});

describe('asteroid orbits', () => {
  it('Ceres agrees with JPL Horizons', () => {
    const [a, e, i, om, w, ma, epoch] = ceres.orbit;
    for (const r of ceres.vectors) { const p = keplerPosition({ a, e, i, om, w, M: ma }, r.jdTdb - epoch); expect(km(p, r.au)).toBeLessThan(500000); } // two-body motion omits planetary perturbations; this is about 0.1 degree as seen from the Sun
  });
  it('orbit basis vectors are perpendicular unit vectors', () => { const { P, Q } = orbitBasis(10, 80, 70); expect(length(P)).toBeCloseTo(1, 9); expect(length(Q)).toBeCloseTo(1, 9); expect(P[0] * Q[0] + P[1] * Q[1] + P[2] * Q[2]).toBeCloseTo(0, 9); });
});
describe('visible planet rotation', () => {
  it('stays exact up to one day per second', () => expect(nextSpinTime(5, 1000, 86400, 16)).toBe(1000));
  it('is limited, in the correct direction, above that', () => { expect(nextSpinTime(0, 1e9, 604800, 10)).toBe(864000); expect(nextSpinTime(0, 1e9, -604800, 10)).toBe(-864000); });
});
