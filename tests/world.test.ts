import { describe, expect, it } from 'vitest';
import { galacticPosition, SUN_KPC } from '../src/renderer/src/deep/GalaxyStage';
import { sampleGrid, stepDrive } from '../src/renderer/src/rover/RoverStage';

describe('galactic coordinates', () => {
  it('places the Galactic centre at the origin', () => { const p = galacticPosition(266.40499, -28.93617, SUN_KPC); expect(Math.hypot(p[0], p[1])).toBeLessThan(0.05); });
  it('places the north galactic pole above the disc', () => { const p = galacticPosition(192.85948, 27.12825, 10); expect(p[2]).toBeCloseTo(10.02, 1); });
  it('places the Large Magellanic Cloud south of the plane', () => expect(galacticPosition(80.89, -69.76, 50)[2]).toBeLessThan(-20));
});
describe('rover driving', () => {
  it('accelerates, respects the top speed and coasts to a stop', () => { let s = { speed: 0, heading: 0 }; for (let i = 0; i < 600; i++) s = stepDrive(s, 1, 0, 0, 1 / 60); expect(s.speed).toBeCloseTo(7, 5); for (let i = 0; i < 300; i++) s = stepDrive(s, 0, 0, 0, 1 / 60); expect(Math.abs(s.speed)).toBeLessThan(0.05); });
  it('turns only while moving', () => { expect(stepDrive({ speed: 0, heading: 0 }, 0, 1, 0, 0.1).heading).toBe(0); expect(stepDrive({ speed: 3, heading: 0 }, 1, 1, 0, 0.1).heading).toBeGreaterThan(0); });
  it('slows on an uphill slope', () => expect(stepDrive({ speed: 3, heading: 0 }, 0.2, 0, 0.5, 0.1).speed).toBeLessThan(stepDrive({ speed: 3, heading: 0 }, 0.2, 0, 0, 0.1).speed));
  it('interpolates terrain smoothly', () => expect(sampleGrid([0, 10, 20, 30], 2, 0.5, 0.5)).toBeCloseTo(15));
});
