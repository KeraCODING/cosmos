/** Simulation seconds per real second. */
export const RATES = [1, 60, 3600, 86400, 604800, 2629800] as const;
// The ephemeris is valid far beyond this; the limits keep results inside the well-tested range.
export const MIN_TIME = Date.UTC(1600, 0, 1);
export const MAX_TIME = Date.UTC(2500, 0, 1);

/** Above this speed a spinning planet would only flicker, so its spin is drawn at this rate and labelled. */
export const MAX_SPIN_RATE = 86400;
export const nextSpinTime = (prev: number, sim: number, rate: number, dtMs: number) => (Math.abs(rate) <= MAX_SPIN_RATE ? sim : prev + Math.sign(rate) * dtMs * MAX_SPIN_RATE);

export class SimClock {
  time: number;
  rateIndex = 2;
  direction: 1 | -1 = 1;
  paused = false;
  /** Chooses a speed that makes motion visible: fast for the whole system, slower close to a body. */
  auto = false;
  constructor(now = Date.now()) { this.time = now; }
  get rate() { return RATES[this.rateIndex] * this.direction; }
  get isRealtime() { return !this.paused && this.rate === 1; }
  get date() { return new Date(this.time); }
  tick(realMs: number) {
    if (this.paused) return;
    this.set(this.time + realMs * this.rate);
    if (this.time === MIN_TIME || this.time === MAX_TIME) this.paused = true;
  }
  set(t: number) { this.time = Math.min(MAX_TIME, Math.max(MIN_TIME, t)); }
  applyAuto(overview: boolean) { if (this.auto) { this.rateIndex = overview ? 4 : 2; this.direction = 1; } }
  faster() { this.auto = false; this.rateIndex = Math.min(RATES.length - 1, this.rateIndex + 1); }
  slower() { this.auto = false; this.rateIndex = Math.max(0, this.rateIndex - 1); }
  reverse() { this.auto = false; this.direction = this.direction === 1 ? -1 : 1; }
  toggle() { this.paused = !this.paused; }
  realtime(now = Date.now()) { this.auto = false; this.set(now); this.rateIndex = 0; this.direction = 1; this.paused = false; }
}
