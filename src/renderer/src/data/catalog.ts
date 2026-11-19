import type { BodyId } from '../astro/ephemeris';
import moonData from './generated/moons.json';
import planetFacts from './generated/planet-facts.json';
import sunFacts from './generated/sun-facts.json';

/** How a statement or image is known. Shown to the user next to the information. */
export type Evidence = 'confirmed' | 'estimate' | 'model' | 'artistic';
export interface Source { name: string; url: string; retrieved: string }
export interface Fact { key: string; value: number; unit: string; evidence: Evidence }
export interface BodyRecord {
  id: BodyId; naifId: number; kind: 'star' | 'planet' | 'moon'; parent?: BodyId; radiusKm: number; orbitDays?: number;
  aliases: string[]; facts: Fact[]; source: Source; related: BodyId[]; reference: string;
  /** Evidence level of what is drawn on screen, separate from the numbers. */
  imagery: { evidence: Evidence; key: string };
}

const pf = planetFacts.bodies as unknown as Record<string, Record<string, number | null>>;
const pfSource: Source = { name: planetFacts.source, url: planetFacts.url, retrieved: planetFacts.retrieved };
const FIELDS: [string, string, (v: number) => number][] = [
  ['massE24Kg', 'e24kg', (v) => v], ['diameterKm', 'km', (v) => v], ['densityKgM3', 'kgm3', (v) => v], ['gravityMS2', 'ms2', (v) => v],
  ['escapeVelocityKmS', 'kms', (v) => v], ['rotationPeriodH', 'h', (v) => v], ['lengthOfDayH', 'h', (v) => v],
  ['distanceFromSunE6Km', 'e6km', (v) => v], ['orbitalPeriodDays', 'd', (v) => v], ['orbitalVelocityKmS', 'kms', (v) => v],
  ['orbitalInclinationDeg', 'deg', (v) => v], ['orbitalEccentricity', 'none', (v) => v], ['obliquityDeg', 'deg', (v) => v],
  ['meanTemperatureC', 'c', (v) => v], ['moons', 'none', (v) => v],
];
const factsOf = (id: string): Fact[] =>
  FIELDS.flatMap(([key, unit, f]) => {
    const v = pf[id]?.[key];
    if (v === null || v === undefined) return []; // missing data stays missing
    return [{ key, value: f(v), unit, evidence: 'confirmed' as Evidence }];
  });

const planet = (id: BodyId, naifId: number, aliases: string[], related: BodyId[], slug: string, imagery: BodyRecord['imagery'], kind: BodyRecord['kind'] = 'planet', parent?: BodyId): BodyRecord => ({
  id, naifId, kind, parent, radiusKm: (pf[id].diameterKm as number) / 2, orbitDays: pf[id].orbitalPeriodDays as number,
  aliases, facts: factsOf(id), source: pfSource, related, reference: `https://science.nasa.gov/${slug}/`, imagery,
});
const art = { evidence: 'artistic' as Evidence, key: 'procedural' };

export const CATALOG: BodyRecord[] = [
  {
    id: 'sun', naifId: 10, kind: 'star', radiusKm: sunFacts.radiusKm, aliases: ['Sun', 'Sol', 'Günəş', 'Gunes'],
    facts: [
      { key: 'massE24Kg', value: sunFacts.massE24Kg, unit: 'e24kg', evidence: 'confirmed' },
      { key: 'diameterKm', value: sunFacts.radiusKm * 2, unit: 'km', evidence: 'confirmed' },
      { key: 'densityKgM3', value: sunFacts.densityKgM3, unit: 'kgm3', evidence: 'confirmed' },
      { key: 'gravityMS2', value: sunFacts.gravityMS2, unit: 'ms2', evidence: 'confirmed' },
      { key: 'escapeVelocityKmS', value: sunFacts.escapeVelocityKmS, unit: 'kms', evidence: 'confirmed' },
    ],
    source: { name: sunFacts.source, url: sunFacts.url, retrieved: sunFacts.retrieved }, related: ['earth', 'mercury', 'jupiter'],
    reference: 'https://science.nasa.gov/sun/', imagery: { evidence: 'artistic', key: 'limbDarkening' },
  },
  planet('mercury', 199, ['Mercury', 'Merkuri'], ['venus', 'sun', 'moon'], 'mercury', art),
  planet('venus', 299, ['Venus', 'Venera'], ['earth', 'mercury', 'mars'], 'venus', art),
  planet('earth', 399, ['Earth', 'Terra', 'Yer', 'Yer kürəsi'], ['moon', 'venus', 'mars'], 'earth', { evidence: 'confirmed', key: 'naturalEarth' }),
  planet('moon', 301, ['Moon', 'Luna', 'Ay'], ['earth', 'sun', 'mercury'], 'moon', { evidence: 'confirmed', key: 'cesiumMoon' }, 'moon', 'earth'),
  planet('mars', 499, ['Mars'], ['earth', 'jupiter', 'venus'], 'mars', art),
  planet('jupiter', 599, ['Jupiter', 'Yupiter'], ['saturn', 'mars', 'sun'], 'jupiter', art),
  planet('saturn', 699, ['Saturn'], ['jupiter', 'uranus', 'neptune'], 'saturn', art),
  planet('uranus', 799, ['Uranus', 'Uran'], ['neptune', 'saturn', 'jupiter'], 'uranus', art),
  planet('neptune', 899, ['Neptune', 'Neptun'], ['uranus', 'saturn', 'jupiter'], 'neptune', art),
];
const MOON_ALIASES: Record<string, string[]> = { phobos: ['Phobos', 'Fobos'], deimos: ['Deimos', 'Deymos'], io: ['Io', 'İo'], europa: ['Europa', 'Avropa'], ganymede: ['Ganymede', 'Qanimed'], callisto: ['Callisto', 'Kallisto'], mimas: ['Mimas'], enceladus: ['Enceladus', 'Enselad'], tethys: ['Tethys', 'Tefiya'], dione: ['Dione', 'Diona'], rhea: ['Rhea', 'Reya'], titan: ['Titan'], iapetus: ['Iapetus', 'Yapet'], miranda: ['Miranda'], ariel: ['Ariel'], umbriel: ['Umbriel'], titania: ['Titania', 'Titaniya'], oberon: ['Oberon'], triton: ['Triton'] };
for (const m of moonData.moons) {
  const siblings = moonData.moons.filter((o) => o.parent === m.parent && o.id !== m.id).slice(0, 2).map((o) => o.id as BodyId);
  CATALOG.push({
    id: m.id as BodyId, naifId: m.naif, kind: 'moon', parent: m.parent as BodyId, radiusKm: m.radiusKm, orbitDays: m.periodDays, aliases: MOON_ALIASES[m.id], related: [m.parent as BodyId, ...siblings], reference: `https://science.nasa.gov/${m.parent}/moons/`, imagery: art,
    source: { name: moonData.source, url: moonData.url, retrieved: moonData.retrieved },
    facts: [{ key: 'diameterKm', value: Math.round(m.radiusKm * 2 * 10) / 10, unit: 'km', evidence: 'confirmed' }, { key: 'semiMajorKm', value: Math.round(m.a), unit: 'km', evidence: 'confirmed' }, { key: 'orbitalPeriodDays', value: Math.round(m.periodDays * 1000) / 1000, unit: 'd', evidence: 'confirmed' }, { key: 'orbitalEccentricity', value: Math.round(m.e * 10000) / 10000, unit: 'none', evidence: 'confirmed' }],
  });
}
export const bodyById = (id: string) => CATALOG.find((b) => b.id === id);

const FOLD: Record<string, string> = { ə: 'e', ı: 'i', ö: 'o', ü: 'u', ş: 's', ç: 'c', ğ: 'g', â: 'a' };
/** Lets "gunes" find "Günəş" and "yer kuresi" find "Yer kürəsi". */
export const foldText = (s: string) =>
  s.toLocaleLowerCase('az').replace(/i̇/g, 'i').replace(/[əıöüşçğâ]/g, (c) => FOLD[c]).normalize('NFD').replace(/\p{M}/gu, '').trim();

export function searchBodies(query: string, localizedName: (id: BodyId) => string[]): BodyRecord[] {
  const q = foldText(query);
  if (!q) return [];
  const score = (b: BodyRecord) => {
    const names = [...b.aliases, ...localizedName(b.id), String(b.naifId)].map(foldText);
    if (names.some((n) => n === q)) return 3;
    if (names.some((n) => n.startsWith(q))) return 2;
    return names.some((n) => n.includes(q)) ? 1 : 0;
  };
  return CATALOG.map((b) => [b, score(b)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([b]) => b);
}
