import * as A from 'astronomy-engine';
import type { BodyId } from './ephemeris';

export type EventKind = 'solarEclipse' | 'lunarEclipse' | 'season' | 'fullMoon' | 'newMoon' | 'opposition';
export interface AstroEvent {
  id: string; kind: EventKind; date: Date;
  /** i18n suffix: total, partial, annular, penumbral, marchEquinox... */
  detail?: string; body: BodyId;
}

const OUTER: [BodyId, A.Body][] = [['mars', A.Body.Mars], ['jupiter', A.Body.Jupiter], ['saturn', A.Body.Saturn], ['uranus', A.Body.Uranus], ['neptune', A.Body.Neptune]];

/** Computes real events in [start, start+days). Nothing is stored or invented: every entry comes from a search. */
export function listEvents(start: Date, days: number): AstroEvent[] {
  const end = new Date(start.getTime() + days * 86400000), out: AstroEvent[] = [];
  const add = (kind: EventKind, date: Date, body: BodyId, detail?: string) => {
    if (date >= start && date < end) out.push({ id: `${kind}-${body}-${date.toISOString()}`, kind, date, body, detail });
  };
  for (let e = A.SearchGlobalSolarEclipse(start); e.peak.date < end; e = A.NextGlobalSolarEclipse(e.peak)) add('solarEclipse', e.peak.date, 'earth', e.kind);
  for (let e = A.SearchLunarEclipse(start); e.peak.date < end; e = A.NextLunarEclipse(e.peak)) add('lunarEclipse', e.peak.date, 'moon', e.kind);
  for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) {
    const s = A.Seasons(y);
    add('season', s.mar_equinox.date, 'earth', 'marchEquinox'); add('season', s.jun_solstice.date, 'earth', 'juneSolstice');
    add('season', s.sep_equinox.date, 'earth', 'septemberEquinox'); add('season', s.dec_solstice.date, 'earth', 'decemberSolstice');
  }
  for (const [lon, kind] of [[180, 'fullMoon'], [0, 'newMoon']] as const) {
    let t: A.AstroTime | null = A.MakeTime(start);
    while (t && t.date < end) {
      t = A.SearchMoonPhase(lon, t, 40);
      if (!t) break;
      add(kind, t.date, 'moon');
      t = t.AddDays(20);
    }
  }
  for (const [id, body] of OUTER) {
    let t = A.MakeTime(start);
    while (t.date < end) { const o = A.SearchRelativeLongitude(body, 0, t); add('opposition', o.date, id); t = o.AddDays(30); }
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}
