import { describe, expect, it } from 'vitest';
import { RATES, SimClock, MAX_TIME } from '../src/renderer/src/sim/clock';
import { foldText, searchBodies, CATALOG } from '../src/renderer/src/data/catalog';
import { parseHorizonsVector } from '../src/renderer/src/data/horizons';
import { mergeSettings, DEFAULTS } from '../src/renderer/src/settings/store';
import { sceneHelio, sceneMoonOffset, sceneRadius, sceneSatelliteOffset, toScene } from '../src/renderer/src/engine/scale';
import { transitionDistance, easeInOut } from '../src/renderer/src/engine/transition';
import ru from '../locales/ru/astronomy.json';
import az from '../locales/az/astronomy.json';
import en from '../locales/en/astronomy.json';

describe('simulation clock', () => {
  it('advances at the selected rate, pauses and reverses', () => {
    const c = new SimClock(0); c.rateIndex = 3; c.tick(1000); expect(c.time).toBe(RATES[3] * 1000);
    c.toggle(); c.tick(1000); expect(c.time).toBe(RATES[3] * 1000);
    c.toggle(); c.reverse(); c.tick(1000); expect(c.time).toBe(0);
  });
  it('real-time mode returns to the current date at 1x', () => { const c = new SimClock(0); c.realtime(5000); expect(c.isRealtime).toBe(true); expect(c.time).toBe(5000); });
  it('stops at the supported date limit', () => { const c = new SimClock(MAX_TIME - 1); c.rateIndex = 5; c.tick(1000); expect(c.time).toBe(MAX_TIME); expect(c.paused).toBe(true); });
});

describe('search', () => {
  const names = (lang: typeof az) => (id: string) => [(lang.bodies as Record<string, { name: string }>)[id].name];
  it('folds Azerbaijani letters', () => expect(foldText('Günəş')).toBe('gunes'));
  it('finds objects by Azerbaijani and English name', () => {
    expect(searchBodies('günəş', names(az))[0].id).toBe('sun');
    expect(searchBodies('gunes', names(az))[0].id).toBe('sun');
    expect(searchBodies('Yupiter', names(en))[0].id).toBe('jupiter');
    expect(searchBodies('Jupiter', names(az))[0].id).toBe('jupiter');
    expect(searchBodies('Moon', names(az))[0].id).toBe('moon');
  });
  it('returns nothing for an empty query', () => expect(searchBodies('  ', names(az))).toEqual([]));
});

describe('scientific content', () => {
  it('every catalogue object has complete text in both languages', () => {
    for (const lang of [az, en, ru]) for (const b of CATALOG) {
      const t = (lang.bodies as Record<string, Record<string, unknown>>)[b.id];
      for (const k of ['name', 'type', 'simple', 'detailed', 'history', 'significance']) expect(String(t[k]).length, `${b.id}.${k}`).toBeGreaterThan(1);
      expect((t.facts as string[]).length).toBeGreaterThanOrEqual(3);
    }
  });
  it('every shown number carries a source and date', () => {
    for (const b of CATALOG) { expect(b.source.url).toMatch(/^https:/); expect(b.source.retrieved).toMatch(/^\d{4}-\d\d-\d\d$/); expect(b.facts.length).toBeGreaterThan(0); }
  });
  it('unknown values stay absent', () => expect(CATALOG.find((b) => b.id === 'jupiter')!.facts.every((f) => Number.isFinite(f.value))).toBe(true));
});

describe('horizons parser', () => {
  it('reads a vector', () => expect(parseHorizonsVector('x\n$$SOE\n2460310.5 = A.D.\n X =-3.0E-01 Y = 1.5E+00 Z =-2.0E-02\n$$EOE')).toEqual([-0.3, 1.5, -0.02]));
  it('rejects an error reply', () => expect(parseHorizonsVector('No ephemeris available')).toBeNull());
});

describe('settings', () => {
  it('ignores damaged and unknown values', () => {
    const s = mergeSettings({ language: 'xx', quality: 'nope', volume: 'loud', extra: 1, fpsLimit: 30, favorites: 'bad' });
    expect(s.language).toBe('az'); expect(s.quality).toBe(DEFAULTS.quality); expect(s.volume).toBe(DEFAULTS.volume); expect(s.fpsLimit).toBe(30); expect(s.favorites).toEqual([]);
  });
  it('defaults to Azerbaijani', () => expect(mergeSettings(null).language).toBe('az'));
});

describe('scale and camera', () => {
  it('true scale keeps the real Earth-Sun distance and Earth radius', () => {
    expect(Math.hypot(...sceneHelio('true', [1, 0, 0]))).toBeCloseTo(149.5978707, 5);
    expect(sceneRadius('true', 'earth', 6378)).toBeCloseTo(0.006378, 6);
  });
  it('moons keep real distance in true scale and clear the rings in educational scale', () => {
    expect(Math.hypot(...sceneSatelliteOffset('true', [0.00282, 0, 0], 0.07, 71492))).toBeCloseTo(0.4219, 3);
    expect(Math.hypot(...sceneSatelliteOffset('educational', [186019 / 149597870.7, 0, 0], 5.8, 60268))).toBeGreaterThan(5.8 * 2.27);
  });
  it('maps ecliptic north to scene up', () => expect(toScene([1, 2, 3])).toEqual([1, 3, -2]));
  it('educational Moon stays outside Earth', () => expect(Math.hypot(...sceneMoonOffset('educational', [0.00257, 0, 0], 0.55))).toBeGreaterThan(0.55 * 2));
  it('transitions start and end exactly and never jump', () => {
    expect(easeInOut(0)).toBe(0); expect(easeInOut(1)).toBe(1);
    expect(transitionDistance(10, 2, 500, 0)).toBeCloseTo(10); expect(transitionDistance(10, 2, 500, 1)).toBeCloseTo(2);
    let prev = transitionDistance(10, 2, 500, 0);
    for (let i = 1; i <= 200; i++) { const d = transitionDistance(10, 2, 500, i / 200); expect(Math.abs(Math.log(d / prev))).toBeLessThan(0.08); prev = d; }
  });
});

describe('automatic time speed', () => {
  it('is fast for the whole system and slower near a body', () => { const c = new SimClock(0); c.auto = true; c.applyAuto(true); expect(c.rate).toBe(604800); c.applyAuto(false); expect(c.rate).toBe(3600); });
  it('stops when the user chooses a speed', () => { const c = new SimClock(0); c.auto = true; c.faster(); const r = c.rateIndex; c.applyAuto(true); expect(c.auto).toBe(false); expect(c.rateIndex).toBe(r); });
});

describe('Russian search', () => {
  it('finds objects by Russian name and folds case', () => { expect(searchBodies('Юпитер', (id) => [(ru.bodies as Record<string, { name: string }>)[id].name])[0].id).toBe('jupiter'); expect(searchBodies('ганимед', (id) => [(ru.bodies as Record<string, { name: string }>)[id].name])[0].id).toBe('ganymede'); });
  it('keeps Russian as a valid saved language', () => expect(mergeSettings({ language: 'ru' }).language).toBe('ru'));
});
