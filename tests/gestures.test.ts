import { describe, expect, it } from 'vitest';
import { Calibrator, classify, DEFAULT_CALIBRATION, defaultGestures, features, GestureEngine, HandSmoother, OneEuro, type EngineConfig, type Hand, type Output } from '../src/renderer/src/hands/gestures';
import { makeHand, type DemoPose, type PoseOptions } from '../src/renderer/src/hands/poses';
import { mergeSettings } from '../src/renderer/src/settings/store';

const hand = (p: DemoPose, o?: PoseOptions): Hand => ({ lm: makeHand(p, o), score: 1 });
const cfg = (x: Partial<EngineConfig> = {}): EngineConfig => ({ mode: 'hand', gestures: defaultGestures(), calibration: DEFAULT_CALIBRATION, confirmMs: 100, move: 1, zoom: 1, menuOpen: false, ...x });
/** Feeds frames at 30 Hz and returns all outputs. */
function run(e: GestureEngine, from: number, ms: number, frame: (k: number) => Hand[]) { const out: Output[] = []; for (let t = 0; t <= ms; t += 33) out.push(e.update(frame(ms ? t / ms : 1), from + t)); return { out, end: from + ms + 33 }; }
const sum = (o: Output[], f: (x: Output) => number) => o.reduce((s, x) => s + f(x), 0);

describe('pose recognition', () => {
  const cases: [DemoPose, string][] = [['open', 'open'], ['fist', 'fist'], ['point', 'point'], ['victory', 'victory'], ['pinch', 'pinch']];
  for (const [pose, want] of cases) for (const angle of [-0.7, 0, 0.7]) for (const mirror of [false, true]) for (const scale of [0.08, 0.2])
    it(`${pose} angle ${angle} mirror ${mirror} size ${scale}`, () => expect(classify(features(makeHand(pose, { angle, mirror, scale })), 0.32)).toBe(want));
  it('does not read a closed fist as a pinch', () => expect(classify(features(makeHand('fist')), 0.9)).toBe('fist'));
});

describe('smoothing', () => {
  it('reduces jitter on a still hand', () => {
    const f = new OneEuro(1, 6); let raw = 0, out = 0, prev = 0.5;
    for (let i = 0; i < 300; i++) { const n = i % 2 ? 0.004 : -0.004, v = f.filter(0.5 + n, i * 33); if (i > 30) { raw += 0.008; out += Math.abs(v - prev); } prev = v; }
    expect(out).toBeLessThan(raw * 0.45);
  });
  it('follows a fast move without long lag', () => { const f = new OneEuro(1, 6); let v = 0; for (let i = 0; i < 20; i++) v = f.filter(i * 0.03, i * 33); expect(19 * 0.03 - v).toBeLessThan(0.06); });
  it('keeps all landmarks', () => expect(new HandSmoother(0.5).apply([hand('open')], 0)[0].lm).toHaveLength(21));
});

describe('camera gestures', () => {
  it('open palm movement rotates the camera in the drag direction', () => {
    const e = new GestureEngine(cfg()); let r = run(e, 0, 200, () => [hand('open', { x: 0.6 })]); r = run(e, r.end, 500, (k) => [hand('open', { x: 0.6 - k * 0.2 })]);
    expect(sum(r.out, (o) => o.rotate[0])).toBeGreaterThan(0.25); expect(sum(r.out, (o) => o.pan[0])).toBe(0);
  });
  it('the open palm action can be changed to pan', () => { const g = defaultGestures(); g.openPalm.action = 'pan'; const e = new GestureEngine(cfg({ gestures: g })); let r = run(e, 0, 200, () => [hand('open')]); r = run(e, r.end, 300, (k) => [hand('open', { y: 0.6 + k * 0.1 })]); expect(sum(r.out, (o) => o.pan[1])).toBeGreaterThan(0.1); });
  it('hand movement with two fingers pans', () => { const e = new GestureEngine(cfg()); let r = run(e, 0, 200, () => [hand('victory')]); r = run(e, r.end, 300, (k) => [hand('victory', { x: 0.5 - k * 0.1 })]); expect(sum(r.out, (o) => o.pan[0])).toBeGreaterThan(0.1); });
  it('fist stops camera motion', () => { const e = new GestureEngine(cfg()); let r = run(e, 0, 200, () => [hand('open')]); r = run(e, r.end, 300, (k) => [hand('fist', { x: 0.5 + k * 0.2 })]); expect(r.out.at(-1)!.freeze).toBe(true); expect(sum(r.out.slice(r.out.findIndex((o) => o.freeze)), (o) => Math.abs(o.rotate[0]))).toBe(0); });
  it('a disabled gesture does nothing', () => { const g = defaultGestures(); g.openPalm.enabled = false; const e = new GestureEngine(cfg({ gestures: g })); let r = run(e, 0, 200, () => [hand('open')]); r = run(e, r.end, 300, (k) => [hand('open', { x: 0.5 - k * 0.2 })]); expect(sum(r.out, (o) => Math.abs(o.rotate[0]))).toBe(0); });
  it('jitter inside the dead zone does not move the camera', () => { const e = new GestureEngine(cfg()); const r = run(e, 0, 1000, (k) => [hand('open', { x: 0.5 + Math.sin(k * 90) * 0.0004 })]); expect(sum(r.out, (o) => Math.abs(o.rotate[0]))).toBe(0); });
});

describe('pinch', () => {
  const pinch = (e: GestureEngine, start: number, ms: number) => { let r = run(e, start, 250, () => [hand('point')]); r = run(e, r.end, ms, () => [hand('pinch')]); const hold = r.out; r = run(e, r.end, 200, () => [hand('pinchOpen')]); return { all: [...hold, ...r.out], end: r.end }; };
  it('a short pinch and release selects once', () => expect(pinch(new GestureEngine(cfg()), 0, 200).all.filter((o) => o.select)).toHaveLength(1));
  it('a one-frame flicker does not click', () => { const e = new GestureEngine(cfg()); let r = run(e, 0, 250, () => [hand('point')]); const a = e.update([hand('pinch')], r.end); r = run(e, r.end + 33, 250, () => [hand('point')]); expect([a, ...r.out].some((o) => o.select)).toBe(false); });
  it('holding to zoom never clicks, and opening zooms in', () => { const e = new GestureEngine(cfg()); let r = run(e, 0, 250, () => [hand('point')]); r = run(e, r.end, 600, () => [hand('pinch')]); r = run(e, r.end, 400, (k) => [hand('pinch', { gap: 0.08 + k * 0.5 })]); expect(sum(r.out, (o) => o.zoom)).toBeLessThan(-0.3); r = run(e, r.end, 300, () => [hand('open')]); expect(r.out.some((o) => o.select)).toBe(false); });
  it('moving during a pinch does not click', () => { const e = new GestureEngine(cfg()); let r = run(e, 0, 250, () => [hand('point')]); r = run(e, r.end, 250, (k) => [hand('pinch', { x: 0.5 + k * 0.15 })]); r = run(e, r.end, 200, () => [hand('pinchOpen', { x: 0.65 })]); expect(r.out.some((o) => o.select)).toBe(false); });
  it('repeat clicks are limited', () => { const e = new GestureEngine(cfg()); const a = pinch(e, 0, 150), b = pinch(e, a.end - 250, 150); expect([...a.all, ...b.all].filter((o) => o.select).length).toBeLessThanOrEqual(1 + 1); });
  it('selects where the finger pointed before it closed', () => {
    const e = new GestureEngine(cfg()); let r = run(e, 0, 500, () => [hand('point')]); const aim = r.out.at(-1)!.cursor!;
    r = run(e, r.end, 170, (k) => [{ score: 1, lm: makeHand('point').map((p, i) => (i === 8 ? { ...p, x: p.x + k * 0.06, y: p.y + k * 0.08 } : p)) }]); r = run(e, r.end, 220, () => [hand('pinch')]); r = run(e, r.end, 200, () => [hand('pinchOpen')]);
    const s = r.out.find((o) => o.select)!.select!; expect(Math.hypot(s.x - aim.x, s.y - aim.y)).toBeLessThan(0.02);
  });
  it('hybrid mode leaves selection to the mouse', () => expect(pinch(new GestureEngine(cfg({ mode: 'hybrid' })), 0, 200).all.some((o) => o.select)).toBe(false));
  it('two hands pinching zoom with their distance and do not click', () => {
    const e = new GestureEngine(cfg()), two = (k: number) => [hand('pinch', { x: 0.4 - k * 0.1 }), hand('pinch', { x: 0.65 + k * 0.1, mirror: true })]; let r = run(e, 0, 250, () => two(0)); r = run(e, r.end, 400, two);
    expect(sum(r.out, (o) => o.zoom)).toBeLessThan(-0.3); expect(r.out.some((o) => o.select)).toBe(false);
  });
});

describe('other gestures', () => {
  it('pointing highlights at the fingertip', () => { const e = new GestureEngine(cfg()), r = run(e, 0, 250, () => [hand('point')]); expect(r.out.at(-1)!.hover).not.toBeNull(); });
  it('a held open palm opens the interface once', () => expect(run(new GestureEngine(cfg()), 0, 2600, () => [hand('open')]).out.filter((o) => o.menu)).toHaveLength(1));
  it('a moving palm does not open the interface', () => expect(run(new GestureEngine(cfg()), 0, 2600, (k) => [hand('open', { x: 0.3 + 0.4 * Math.abs(Math.sin(k * 12)) })]).out.some((o) => o.menu)).toBe(false));
  it('palm rotates nothing while the interface is open', () => { const e = new GestureEngine(cfg({ menuOpen: true })); let r = run(e, 0, 200, () => [hand('open')]); r = run(e, r.end, 300, (k) => [hand('open', { x: 0.5 - k * 0.2 })]); expect(sum(r.out, (o) => Math.abs(o.rotate[0]))).toBe(0); expect(r.out.at(-1)!.cursor).not.toBeNull(); });
});

describe('tracking loss', () => {
  it('reappearing elsewhere does not jump the camera', () => { const e = new GestureEngine(cfg()); let r = run(e, 0, 300, () => [hand('open', { x: 0.2 })]); r = run(e, r.end, 200, () => []); expect(r.out[0].lost).toBe(true); r = run(e, r.end, 300, () => [hand('open', { x: 0.8 })]); expect(sum(r.out, (o) => Math.abs(o.rotate[0]))).toBe(0); });
  it('a long loss resets state and never clicks', () => { const e = new GestureEngine(cfg()); let r = run(e, 0, 250, () => [hand('point')]); r = run(e, r.end, 200, () => [hand('pinch')]); r = run(e, r.end, 900, () => []); expect(r.out.some((o) => o.select)).toBe(false); expect(r.out.some((o) => o.reset)).toBe(true); expect(r.out.at(-1)!.pose).toBe('none'); });
});

describe('calibration', () => {
  it('needs every step and adapts range and pinch', () => {
    const c = new Calibrator(); let t = 0; const feed = (ms: number, f: (k: number) => Hand) => { for (let m = 0; m <= ms; m += 33) c.update([f(m / ms)], t += 33); };
    feed(500, () => hand('fist')); expect(c.step).toBe('palm'); feed(1200, () => hand('open')); expect(c.step).toBe('sweep'); feed(800, (k) => hand('open', { x: 0.3 + k * 0.4 })); expect(c.step).toBe('pinch'); feed(800, () => hand('pinch', { gap: 0.12 })); expect(c.step).toBe('still'); feed(1500, () => hand('open')); expect(c.done).toBe(true);
    const r = c.result(); expect(r.cx).toBeCloseTo(0.5, 1); expect(r.rx).toBeGreaterThan(0.3); expect(r.pinchIn).toBeGreaterThan(0.09); expect(r.pinchOut).toBeGreaterThan(r.pinchIn);
  });
});

describe('privacy defaults', () => {
  it('never restores a camera mode on launch', () => expect(mergeSettings({ controlMode: 'hand' }).controlMode).toBe('mouse'));
  it('keeps valid gesture preferences and ignores damaged ones', () => { const s = mergeSettings({ gestureConfig: { fist: { enabled: false, action: 'pauseTime' }, point: 'bad' } }); expect(s.gestureConfig.fist).toEqual({ enabled: false, action: 'pauseTime' }); expect(s.gestureConfig.point.enabled).toBe(true); });
});

describe('recognition robustness', () => {
  it('one misread frame does not delay a gesture', () => { const e = new GestureEngine(cfg()); let n = 0; const r = run(e, 0, 330, () => [hand(++n % 4 === 0 ? 'fist' : 'open')]); expect(r.out.at(-1)!.pose).toBe('open'); });
  it('relaxed, slightly bent fingers still count as an open palm', () => { const f = features(makeHand('open')); f.curl = [0.3, 0.38, 0.42, 0.5]; expect(classify(f, 0.32)).toBe('open'); });
  it('uses the 3D hand model for shape when it is available', () => { const lm = makeHand('fist'), world = makeHand('open', { scale: 0.5 }); expect(classify(features(lm, world), 0.32)).toBe('open'); });
  it('keeps following the same hand when a second appears', () => { const e = new GestureEngine(cfg()); let r = run(e, 0, 300, () => [hand('open', { x: 0.3 })]); r = run(e, r.end, 300, (k) => [hand('fist', { x: 0.75, scale: 0.25 }), hand('open', { x: 0.3 - k * 0.1 })]); expect(r.out.at(-1)!.pose).toBe('open'); });
  it('holding a point selects once, after the ring fills', () => { const e = new GestureEngine(cfg()), r = run(e, 0, 3000, () => [hand('point')]), s = r.out.filter((o) => o.select); expect(s).toHaveLength(1); expect(r.out.some((o) => o.dwell > 0.4 && o.dwell < 1)).toBe(true); });
  it('a moving finger does not select by holding', () => expect(run(new GestureEngine(cfg()), 0, 3000, (k) => [hand('point', { x: 0.3 + 0.4 * Math.abs(Math.sin(k * 9)) })]).out.some((o) => o.select)).toBe(false));
  it('point and hold can be switched off', () => { const g = defaultGestures(); g.dwellSelect.enabled = false; expect(run(new GestureEngine(cfg({ gestures: g })), 0, 3000, () => [hand('point')]).out.some((o) => o.select)).toBe(false); });
  it('holding the palm on a menu button selects it', () => expect(run(new GestureEngine(cfg({ menuOpen: true })), 0, 2200, () => [hand('open')]).out.filter((o) => o.select)).toHaveLength(1));
});
