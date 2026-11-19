import * as A from 'astronomy-engine';
/** Horizons epochs are TDB Julian dates; the engine's time argument counts TT days from J2000. TDB-TT is under 2 ms. */
export const makeTimeFromJd = (jdTdb: number) => A.AstroTime.FromTerrestrialTime(jdTdb - 2451545.0);
