// Pure gesture logic: no camera, DOM or rendering here, so all of it can be unit tested.
export interface Pt { x: number; y: number; z: number }
export interface Hand { lm: Pt[]; score: number; world?: Pt[] }
export type Pose = 'none' | 'open' | 'fist' | 'point' | 'victory' | 'pinch';
export const GESTURE_IDS = ['openPalm', 'handMove', 'pinchZoom', 'pinchSelect', 'dwellSelect', 'fist', 'twoHandPinch', 'point', 'palmHold'] as const;
export type GestureId = (typeof GESTURE_IDS)[number];
export const GESTURE_ACTIONS: Record<GestureId, string[]> = {
  openPalm: ['rotate', 'pan'], handMove: ['pan', 'rotate'], pinchZoom: ['zoom'], pinchSelect: ['select'], dwellSelect: ['select'],
  fist: ['freeze', 'pauseTime'], twoHandPinch: ['zoom'], point: ['highlight'], palmHold: ['menu', 'home'],
};
export type GestureConfig = Record<GestureId, { enabled: boolean; action: string }>;
export const defaultGestures = (): GestureConfig => Object.fromEntries(GESTURE_IDS.map((g) => [g, { enabled: true, action: GESTURE_ACTIONS[g][0] }])) as GestureConfig;
export interface Calibration { cx: number; cy: number; rx: number; ry: number; pinchIn: number; pinchOut: number; zoomExit: number; deadzone: number }
export const DEFAULT_CALIBRATION: Calibration = { cx: 0.5, cy: 0.5, rx: 0.55, ry: 0.55, pinchIn: 0.32, pinchOut: 0.48, zoomExit: 1.15, deadzone: 0.0012 };

const d3 = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const FINGERS = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const angle = (a: Pt, b: Pt) => Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z) || 1))));
export interface Features { palm: number; pinch: number; curl: number[]; indexReach: number; center: { x: number; y: number } }

/** Shape is measured from the tracker's 3D hand model when available, which does not change with distance or view angle. */
export function features(lm: Pt[], world?: Pt[]): Features {
  const p = world ?? lm, palm = Math.max(d3(p[0], p[9]), d3(p[5], p[17]) * 1.25, 1e-6), ids = [0, 5, 9, 13, 17];
  const curl = FINGERS.map(([m, j, d, t]) => { const a = sub(p[j], p[m]), b = sub(p[d], p[j]), c = sub(p[t], p[d]); return Math.min(1, (angle(sub(p[m], p[0]), a) * 0.5 + angle(a, b) + angle(b, c)) / 3); });
  return { palm, pinch: d3(p[4], p[8]) / palm, curl, indexReach: d3(p[8], p[0]) / d3(p[5], p[0]), center: { x: ids.reduce((s, i) => s + lm[i].x, 0) / 5, y: ids.reduce((s, i) => s + lm[i].y, 0) / 5 } };
}
const TEMPLATES: [Pose, number[]][] = [['open', [0, 0, 0, 0]], ['fist', [1, 1, 1, 1]], ['point', [0, 1, 1, 1]], ['victory', [0, 0, 1, 1]]];
export function classify(f: Features, pinchLimit: number): Pose {
  // A closed fist also brings thumb and index together, so the index must not be folded into the palm.
  if (f.pinch < pinchLimit && f.curl[0] < 0.82 && f.indexReach > 0.9) return 'pinch';
  // Relaxed fingers are normal, so each finger may differ from the ideal shape; the closest overall shape wins.
  let best: Pose = 'none', total = Infinity;
  for (const [pose, shape] of TEMPLATES) { const e = shape.map((v, i) => Math.abs(v - f.curl[i])), sum = e.reduce((x, y) => x + y, 0); if (Math.max(...e) < 0.62 && sum < total) { total = sum; best = pose; } }
  return best;
}

/** One Euro filter: steady when the hand is still, responsive when it moves. */
export class OneEuro {
  private x?: number; private dx = 0; private t = 0;
  constructor(private minCutoff: number, private beta: number) {}
  private static a(c: number, dt: number) { const r = 2 * Math.PI * c * dt; return r / (r + 1); }
  filter(v: number, t: number) {
    if (this.x === undefined) { this.x = v; this.t = t; return v; }
    const dt = Math.max(1e-3, (t - this.t) / 1000); this.t = t;
    const d = (v - this.x) / dt; this.dx += OneEuro.a(1, dt) * (d - this.dx);
    this.x += OneEuro.a(this.minCutoff + this.beta * Math.abs(this.dx), dt) * (v - this.x); return this.x;
  }
}
export class HandSmoother {
  private f: OneEuro[][] = []; private last: { x: number; y: number }[] = [];
  constructor(private smoothing: number) {}
  apply(hands: Hand[], t: number): Hand[] {
    const minC = 5 - 4.4 * this.smoothing, L = this.last; let ordered = hands;
    if (hands.length === 2 && L.length === 2) { const d = (h: Hand, i: number) => Math.hypot(h.lm[0].x - L[i].x, h.lm[0].y - L[i].y); if (d(hands[0], 1) + d(hands[1], 0) < d(hands[0], 0) + d(hands[1], 1)) ordered = [hands[1], hands[0]]; } // the tracker may swap the two hands
    const out = ordered.map((h, n) => {
      const fs = (this.f[n] ??= Array.from({ length: 126 }, () => new OneEuro(minC, 6))), run = (pts: Pt[], o: number) => pts.map((p, i) => ({ x: fs[o + i * 3].filter(p.x, t), y: fs[o + i * 3 + 1].filter(p.y, t), z: fs[o + i * 3 + 2].filter(p.z, t) }));
      return { score: h.score, lm: run(h.lm, 0), world: h.world ? run(h.world, 63) : undefined };
    });
    this.last = out.map((h) => ({ x: h.lm[0].x, y: h.lm[0].y })); return out;
  }
  reset() { this.f = []; this.last = []; }
}

export interface EngineConfig { mode: 'hand' | 'hybrid'; gestures: GestureConfig; calibration: Calibration; confirmMs: number; move: number; zoom: number; menuOpen: boolean; aspect?: number }
export interface Output {
  pose: Pose; hands: number; lost: boolean; reset: boolean; cursor: { x: number; y: number } | null; rotate: [number, number]; pan: [number, number]; zoom: number; dwell: number;
  select: { x: number; y: number } | null; hover: { x: number; y: number } | null; freeze: boolean; menu: boolean; home: boolean; pauseTime: boolean; active: GestureId | null;
}
const LOSS_GRACE = 450, CLICK_MAX_HOLD = 600, CLICK_COOLDOWN = 600, PALM_HOLD = 1300, CLICK_TRAVEL = 0.07, DWELL_DELAY = 250, DWELL_MS = 1000, DWELL_RADIUS = 0.032;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class GestureEngine {
  private stable: Pose = 'none'; private votes: { t: number; pose: Pose }[] = []; private lastSeen: number | null = null; private prev: { x: number; y: number } | null = null; private lastPalm: { x: number; y: number } | null = null;
  private cursor: { x: number; y: number } | null = null; private pinch: { t0: number; travel: number; ratio: number; zooming: boolean; cursor: { x: number; y: number } | null } | null = null;
  private two: { since: number; dist: number | null } | null = null; private lastClick = -1e9; private hold: { t: number; x: number; y: number; fired: boolean } | null = null; private trail: { t: number; c: { x: number; y: number } }[] = []; private dwellAt: { t: number; x: number; y: number; fired: boolean } | null = null;
  constructor(public cfg: EngineConfig) {}
  private on(g: GestureId) { return this.cfg.gestures[g].enabled; }
  private act(g: GestureId) { return this.cfg.gestures[g].action; }
  private blank(): Output { return { pose: this.stable, hands: 0, lost: false, reset: false, cursor: this.cursor, rotate: [0, 0], pan: [0, 0], zoom: 0, dwell: 0, select: null, hover: null, freeze: false, menu: false, home: false, pauseTime: false, active: null }; }
  private clear() { this.stable = 'none'; this.votes = []; this.pinch = null; this.two = null; this.hold = null; this.prev = null; this.lastPalm = null; this.trail = []; this.dwellAt = null; }
  private mapCursor(u: number, v: number) { const c = this.cfg.calibration; return { x: clamp01((u - c.cx) / c.rx + 0.5), y: clamp01((v - c.cy) / c.ry + 0.5) }; }
  private remember(t: number) { if (!this.cursor) return; this.trail.push({ t, c: this.cursor }); while (this.trail.length && t - this.trail[0].t > 700) this.trail.shift(); }
  /** Closing the fingers moves the fingertip, so a pinch aims where the cursor was just before they started closing. */
  private aimBeforePinch(t: number) { const limit = t - this.cfg.confirmMs - 220; let best = this.trail[0]?.c ?? this.cursor; for (const e of this.trail) if (e.t <= limit) best = e.c; return best ? { ...best } : null; }
  private delta(p: { x: number; y: number }): [number, number] {
    const prev = this.prev, c = this.cfg.calibration; this.prev = p; if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 0.16) return [0, 0]; // a leap is a tracking error, not movement
    const soft = (d: number) => (Math.abs(d) <= c.deadzone ? 0 : d - Math.sign(d) * c.deadzone);
    return [(soft(p.x - prev.x) / c.rx) * this.cfg.move, (soft(p.y - prev.y) / c.ry) * this.cfg.move];
  }
  private move(out: Output, action: string, d: [number, number]) { if (action === 'pan') { out.pan[0] += d[0]; out.pan[1] += d[1]; } else { out.rotate[0] += d[0]; out.rotate[1] += d[1]; } }
  /** Recent frames vote, so one misread frame neither triggers a gesture nor restarts its confirmation. */
  private vote(pose: Pose, t: number): Pose | null {
    const windowMs = Math.max(130, this.cfg.confirmMs * 1.5); this.votes.push({ t, pose }); while (t - this.votes[0].t > windowMs) this.votes.shift();
    if (t - this.votes[0].t < this.cfg.confirmMs * 0.7) return null;
    const tally = new Map<Pose, number>(); for (const v of this.votes) tally.set(v.pose, (tally.get(v.pose) ?? 0) + 1);
    let best: Pose = pose, most = 0; tally.forEach((n, p) => { if (n > most) { most = n; best = p; } });
    return most / this.votes.length >= 0.65 ? best : null;
  }
  /** Holding the cursor still on something selects it, without any pinch. */
  private dwell(out: Output, t: number) {
    const c = this.cursor; if (!c || !this.on('dwellSelect') || this.cfg.mode !== 'hand') return;
    const d = this.dwellAt; if (!d || Math.hypot(c.x - d.x, c.y - d.y) > DWELL_RADIUS) { this.dwellAt = { t, x: c.x, y: c.y, fired: false }; return; }
    if (d.fired) return; out.dwell = clamp01((t - d.t - DWELL_DELAY) / DWELL_MS);
    if (out.dwell >= 1 && t - this.lastClick >= CLICK_COOLDOWN) { d.fired = true; out.dwell = 0; out.select = { ...c }; out.active = 'dwellSelect'; this.lastClick = t; }
  }

  update(hands: Hand[], t: number): Output {
    const out = this.blank(), c = this.cfg.calibration; out.hands = hands.length;
    if (!hands.length) {
      this.prev = null; // the next sighting starts from a new anchor, so the camera cannot jump
      if (this.lastSeen !== null && t - this.lastSeen <= LOSS_GRACE) { out.lost = true; return out; }
      if (this.lastSeen !== null) { this.clear(); this.lastSeen = null; this.cursor = null; out.reset = true; out.cursor = null; } out.pose = 'none'; return out;
    }
    this.lastSeen = t;
    const fs = hands.map((h) => features(h.lm, h.world)), mirror = (p: { x: number; y: number }) => ({ x: 1 - p.x, y: p.y });
    let idx = 0;
    if (fs.length > 1) { const ref = this.lastPalm; idx = ref ? (Math.hypot(1 - fs[1].center.x - ref.x, fs[1].center.y - ref.y) < Math.hypot(1 - fs[0].center.x - ref.x, fs[0].center.y - ref.y) ? 1 : 0) : Math.hypot(hands[1].lm[0].x - hands[1].lm[9].x, hands[1].lm[0].y - hands[1].lm[9].y) > Math.hypot(hands[0].lm[0].x - hands[0].lm[9].x, hands[0].lm[0].y - hands[0].lm[9].y) ? 1 : 0; }
    const f = fs[idx], lm = hands[idx].lm, palm = mirror(f.center); this.lastPalm = palm;

    // Two-hand pinch takes priority and cancels any single-hand pinch.
    if (fs.length > 1 && this.on('twoHandPinch') && fs[0].pinch < (this.two ? c.pinchOut : c.pinchIn) && fs[1].pinch < (this.two ? c.pinchOut : c.pinchIn)) {
      this.two ??= { since: t, dist: null };
      if (t - this.two.since >= this.cfg.confirmMs) {
        const m = (h: Hand) => ({ x: (h.lm[4].x + h.lm[8].x) / 2, y: (h.lm[4].y + h.lm[8].y) / 2 }), a = m(hands[0]), b = m(hands[1]), dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.two.dist !== null) out.zoom -= (dist - this.two.dist) * 3.2 * this.cfg.zoom;
        this.two.dist = dist; this.pinch = null; this.stable = 'pinch'; this.votes = []; this.prev = null; out.pose = 'pinch'; out.active = 'twoHandPinch'; return out;
      }
    } else if (this.two) { this.two = null; this.stable = 'none'; this.votes = []; this.prev = null; }

    const pinchAllowed = this.on('pinchZoom') || this.on('pinchSelect'), limit = !pinchAllowed ? 0 : this.stable === 'pinch' ? c.pinchOut : c.pinchIn;
    let cand = classify(f, limit);
    if (this.pinch?.zooming && f.pinch < c.zoomExit && cand !== 'fist') cand = 'pinch';
    const won = this.vote(cand, t); if (won && won !== this.stable) this.transition(won, t, out, palm);

    switch (this.stable) {
      case 'open': {
        this.cursor = this.mapCursor(palm.x, palm.y); this.remember(t); const d = this.delta(palm);
        if (this.on('openPalm') && !this.cfg.menuOpen) { this.move(out, this.act('openPalm'), d); out.active = 'openPalm'; }
        if (this.cfg.menuOpen) this.dwell(out, t);
        else if (this.on('palmHold') && this.cfg.mode === 'hand') {
          const h = (this.hold ??= { t, x: palm.x, y: palm.y, fired: false });
          if (Math.hypot(palm.x - h.x, palm.y - h.y) > 0.045) this.hold = { t, x: palm.x, y: palm.y, fired: h.fired };
          else if (!h.fired && t - h.t >= PALM_HOLD) { h.fired = true; if (this.act('palmHold') === 'home') out.home = true; else out.menu = true; out.active = 'palmHold'; }
        }
        break;
      }
      case 'victory': { const d = this.delta(palm); if (this.on('handMove')) { this.move(out, this.act('handMove'), d); out.active = 'handMove'; } break; }
      case 'point': { this.cursor = this.mapCursor(1 - lm[8].x, lm[8].y); this.remember(t); this.prev = null; if (this.cfg.mode === 'hand') { if (this.on('point')) { out.hover = this.cursor; out.active = 'point'; } this.dwell(out, t); } break; }
      case 'pinch': {
        const p = this.pinch; if (!p) break; const prev = this.prev; this.prev = palm; if (prev) p.travel += Math.hypot(palm.x - prev.x, palm.y - prev.y);
        if (!p.zooming && this.on('pinchZoom') && t - p.t0 > CLICK_MAX_HOLD) { p.zooming = true; p.ratio = f.pinch; }
        if (p.zooming) { out.zoom -= (f.pinch - p.ratio) * 1.5 * this.cfg.zoom; p.ratio = f.pinch; out.active = 'pinchZoom'; }
        break;
      }
      case 'fist': { this.prev = null; if (this.on('fist') && this.act('fist') === 'freeze') { out.freeze = true; out.active = 'fist'; } break; }
      default: this.prev = null;
    }
    out.pose = this.stable; out.cursor = this.pinch?.cursor ?? this.cursor; return out;
  }
  private transition(next: Pose, t: number, out: Output, palm: { x: number; y: number }) {
    const p = this.pinch;
    if (this.stable === 'pinch' && p) {
      // Only a short, still pinch selects. Holding to zoom or moving the hand never clicks.
      const quick = !p.zooming && t - p.t0 <= CLICK_MAX_HOLD + this.cfg.confirmMs && p.travel < CLICK_TRAVEL;
      if (quick && this.on('pinchSelect') && this.cfg.mode === 'hand' && t - this.lastClick >= CLICK_COOLDOWN && p.cursor) { out.select = p.cursor; out.active = 'pinchSelect'; this.lastClick = t; }
      this.pinch = null;
    }
    this.stable = next; this.prev = next === 'open' || next === 'victory' ? palm : null; this.hold = null; this.dwellAt = null;
    if (next === 'pinch') this.pinch = { t0: t, travel: 0, ratio: 0, zooming: false, cursor: this.aimBeforePinch(t) ?? this.mapCursor(palm.x, palm.y) };
    if (next === 'fist' && this.on('fist') && this.act('fist') === 'pauseTime') { out.pauseTime = true; out.active = 'fist'; }
  }
}

export const CALIBRATION_STEPS = ['palm', 'sweep', 'pinch', 'still'] as const;
export type CalibrationStep = (typeof CALIBRATION_STEPS)[number];
/** Measures the user's own range and pinch. Each step finishes only on real measurements. */
export class Calibrator {
  index = 0; progress = 0; private start: number | null = null; private open: number[] = []; private min = { x: 1, y: 1 }; private max = { x: 0, y: 0 }; private closed: number[] = []; private still: { x: number; y: number }[] = [];
  get step(): CalibrationStep | null { return CALIBRATION_STEPS[this.index] ?? null; }
  get done() { return this.index >= CALIBRATION_STEPS.length; }
  private next() { this.index++; this.progress = 0; this.start = null; }
  update(hands: Hand[], t: number) {
    if (this.done || !hands.length) { this.start = null; return; }
    const f = features(hands[0].lm, hands[0].world), u = { x: 1 - f.center.x, y: f.center.y }, pose = classify(f, 0);
    if (this.step === 'palm') { if (pose !== 'open') { this.start = null; this.progress = 0; return; } this.start ??= t; this.open.push(f.pinch); this.progress = clamp01((t - this.start) / 1000); if (this.progress >= 1) this.next(); }
    else if (this.step === 'sweep') { this.min = { x: Math.min(this.min.x, u.x), y: Math.min(this.min.y, u.y) }; this.max = { x: Math.max(this.max.x, u.x), y: Math.max(this.max.y, u.y) }; this.progress = clamp01((this.max.x - this.min.x) / 0.3); if (this.progress >= 1) this.next(); }
    else if (this.step === 'pinch') { if (f.pinch > 0.42 || f.indexReach <= 0.98) { this.start = null; this.progress = 0; return; } this.start ??= t; this.closed.push(f.pinch); this.progress = clamp01((t - this.start) / 600); if (this.progress >= 1) this.next(); }
    else { const s = this.still; s.push(u); if (s.length > 2 && Math.hypot(u.x - s[0].x, u.y - s[0].y) > 0.03) { s.length = 0; this.start = null; this.progress = 0; return; } this.start ??= t; this.progress = clamp01((t - this.start) / 1200); if (this.progress >= 1) this.index++; }
  }
  result(): Calibration {
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / (a.length || 1), open = mean(this.open), pinch = mean(this.closed), gap = Math.max(0.2, open - pinch), s = this.still;
    let jitter = 0; for (let i = 1; i < s.length; i++) jitter += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y); jitter /= Math.max(1, s.length - 1);
    return { cx: (this.min.x + this.max.x) / 2, cy: mean(s.map((p) => p.y)) || 0.5, rx: Math.max(0.2, Math.min(0.9, (this.max.x - this.min.x) * 1.1)), ry: Math.max(0.2, Math.min(0.9, (this.max.x - this.min.x) * 0.9)), pinchIn: pinch + gap * 0.22, pinchOut: pinch + gap * 0.38, zoomExit: Math.max(pinch + gap * 0.8, 0.7), deadzone: Math.max(0.0005, Math.min(0.004, jitter * 1.4)) };
  }
}
