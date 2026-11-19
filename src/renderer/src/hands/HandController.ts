import { store, type Settings } from '../settings/store';
import { Calibrator, classify, DEFAULT_CALIBRATION, features, GestureEngine, HandSmoother, type EngineConfig, type Hand, type Output } from './gestures';
import { HAND_BONES, makeHand } from './poses';

/** What gestures control. Space view and Earth Explorer implement it with the same methods mouse input uses. */
export interface NavigationTarget { rotate(dx: number, dy: number): void; pan(dx: number, dy: number): void; zoom(logFactor: number): void; hover(x: number, y: number): void; clearHover(): void; stop(): void }
export interface HandEvents { select(x: number, y: number): void; menu(): void; home(): void; pauseTime(): void; status(): void; failed(reason: CameraFailure): void; calibrated(): void }
export type CameraFailure = 'denied' | 'missing' | 'busy' | 'model' | 'unknown';
export type HandState = 'off' | 'starting' | 'searching' | 'tracking' | 'lost';

export class HandController {
  video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true }); overlay = document.createElement('canvas'); mini = Object.assign(document.createElement('canvas'), { width: 132, height: 99, className: 'hand-mini' });
  state: HandState = 'off'; delegate = ''; inferMs = 0; rate = 0; devices: MediaDeviceInfo[] = []; last: Output | null = null; calibrator: Calibrator | null = null; menuOpen = false;
  private stream: MediaStream | null = null; private worker: Worker | null = null; private busy = false; private id = 0; private nextAt = 0; private smoother = new HandSmoother(0.5); private engine: GestureEngine; private hands: Hand[] = [];
  private stills = new Map<number, (h: Hand[]) => void>(); private queue = { rotate: [0, 0], pan: [0, 0], zoom: 0 }; private timer = 0; private lastVideoTime = -1; private host = Object.assign(document.createElement('div'), { className: 'hand-video-host' }); private results: number[] = []; private session = 0; private hovering = false;
  constructor(private events: HandEvents) { this.engine = new GestureEngine(this.config()); this.video.className = 'hand-video'; this.overlay.className = 'hand-overlay'; document.body.append(this.host); this.park(); }
  /** A video removed from the page is paused by the browser, so it always stays attached, even with the panel closed. */
  park() { if (!this.video.isConnected) this.host.append(this.video); }
  get active() { return this.state !== 'off'; }
  private config(): EngineConfig {
    const s = store.value, mode = s.controlMode === 'hybrid' ? 'hybrid' : 'hand';
    return { mode, gestures: s.gestureConfig, calibration: s.calibration ?? DEFAULT_CALIBRATION, confirmMs: s.handConfirm, move: s.handMove, zoom: s.handZoom, menuOpen: this.menuOpen };
  }
  syncSettings(changed: (keyof Settings)[]) {
    this.engine.cfg = this.config();
    if (changed.includes('handSmooth')) this.smoother = new HandSmoother(store.value.handSmooth);
    if ((changed.includes('handDetect') || changed.includes('handTrack')) && this.worker) this.worker.postMessage({ type: 'config', detect: store.value.handDetect, track: store.value.handTrack });
  }
  setMenuOpen(v: boolean) { this.menuOpen = v; this.engine.cfg = this.config(); }
  private startWorker() {
    const w = new Worker(new URL('./hand.worker.ts', import.meta.url), { type: 'module' }); this.worker = w;
    return new Promise<void>((ok, fail) => {
      w.onerror = (e) => fail(new Error(e.message));
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') { this.delegate = m.delegate; ok(); }
        else if (m.type === 'result') this.onResult(m);
        else if (m.type === 'still') { this.stills.get(m.id)?.(m.hands); this.stills.delete(m.id); }
        else if (m.type === 'error') { window.cosmos.log('error', `hand worker: ${m.message}`); this.busy = false; if (this.state === 'starting') fail(new Error(m.message)); if (m.id && this.stills.has(m.id)) { this.stills.get(m.id)!([]); this.stills.delete(m.id); } }
      };
      w.postMessage({ type: 'init', base: new URL('./', location.href).href, detect: store.value.handDetect, track: store.value.handTrack });
    });
  }
  async start() {
    if (this.active) return true;
    const session = ++this.session; this.state = 'starting'; this.events.status();
    let failure: CameraFailure = 'unknown';
    try {
      await window.cosmos.allowCamera(true);
      const id = store.value.cameraId;
      try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...(id ? { deviceId: { exact: id } } : {}), width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } } }); }
      catch (e) { const n = (e as DOMException).name; failure = n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'missing' : n === 'NotReadableError' ? 'busy' : 'unknown'; throw e; }
      if (session !== this.session) { this.stream.getTracks().forEach((t) => t.stop()); return false; }
      this.stream.getVideoTracks()[0].addEventListener('ended', () => { this.stop(); this.events.failed('busy'); });
      this.video.srcObject = this.stream; await this.video.play();
      this.devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      failure = 'model'; await this.startWorker();
      if (session !== this.session) return false;
      this.smoother = new HandSmoother(store.value.handSmooth); this.engine = new GestureEngine(this.config()); this.state = 'searching'; this.schedule(); this.events.status(); return true;
    } catch (e) { window.cosmos.log('warn', `camera start: ${e}`); this.stop(); this.events.failed(failure); return false; }
  }
  /** Immediately releases the camera. Nothing from it is kept. */
  stop() {
    this.session++; this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null; this.video.pause(); this.video.srcObject = null;
    clearInterval(this.timer); this.timer = 0; this.lastVideoTime = -1; this.worker?.terminate(); this.worker = null; this.busy = false; this.hands = []; this.last = null; this.calibrator = null; this.menuOpen = false; this.results = []; this.queue = { rotate: [0, 0], pan: [0, 0], zoom: 0 };
    this.overlay.getContext('2d')?.clearRect(0, 0, this.overlay.width, this.overlay.height); this.state = 'off'; void window.cosmos.allowCamera(false); this.events.status();
  }
  async switchCamera(id: string) { store.set({ cameraId: id }); if (this.active) { this.stop(); await this.start(); } }
  private schedule() { clearInterval(this.timer); this.timer = window.setInterval(() => void this.capture(), 16); }
  private async capture() {
    const now = performance.now();
    if (this.video.paused && this.stream) void this.video.play().catch(() => {});
    if (this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) return; // no new camera frame
    // Skip work that nobody would see: one frame at a time, none while hidden, and a slow scan with no hand in view.
    if (this.busy || !this.worker || document.hidden || now < this.nextAt) return;
    this.busy = true; this.lastVideoTime = this.video.currentTime; this.nextAt = now + (this.hands.length || this.calibrator ? 30 : 100);
    try { const w = this.video.videoWidth, h = this.video.videoHeight, bitmap = await createImageBitmap(this.video, { resizeWidth: 640, resizeHeight: Math.round((640 * h) / w), resizeQuality: 'medium' }); if (!this.worker) { bitmap.close(); return; } this.worker.postMessage({ type: 'frame', id: ++this.id, bitmap, t: Math.round(now), aspect: w / h }, [bitmap]); }
    catch { this.busy = false; }
  }
  private onResult(m: { hands: Hand[]; aspect: number; ms: number }) { this.busy = false; this.inferMs += (m.ms - this.inferMs) * 0.15; this.ingest(m.hands, performance.now(), m.aspect); }
  /** Single entry for tracked hands, from the camera or from a test. */
  ingest(raw: Hand[], t: number, aspect = 4 / 3) {
    this.results.push(t); while (this.results.length && t - this.results[0] > 1000) this.results.shift(); this.rate = this.results.length;
    if (raw.length !== this.hands.length) this.smoother.reset(); // a returning hand must not glide in from its old position
    const scaled = raw.filter((h) => h.score >= 0.55).map((h) => ({ score: h.score, world: h.world, lm: h.lm.map((p) => ({ x: p.x, y: p.y, z: p.z })) })), hands = this.smoother.apply(scaled, t); this.hands = hands;
    // Geometry uses square units; navigation uses image fractions.
    const square = hands.map((h) => ({ score: h.score, world: h.world, lm: h.lm.map((p) => ({ x: 0.5 + (p.x - 0.5) * aspect, y: p.y, z: p.z * aspect })) }));
    const out = this.engine.update(square, t); this.last = out;
    if (out.reset) this.smoother.reset();
    if (this.calibrator) { this.calibrator.update(square, t); if (this.calibrator.done) { store.set({ calibration: this.calibrator.result() }); this.calibrator = null; this.engine.cfg = this.config(); this.events.calibrated(); } }
    const next: HandState = out.hands ? 'tracking' : out.lost ? 'lost' : 'searching', changed = next !== this.state; if (this.active) this.state = next;
    this.drawOverlay(hands);
    if (!this.calibrator) this.dispatch(out);
    if (changed) this.events.status();
  }
  private pendingHover: { x: number; y: number } | null = null;
  private dispatch(o: Output) {
    const q = this.queue; if (o.freeze) { q.rotate = [0, 0]; q.pan = [0, 0]; q.zoom = 0; this.freeze = true; } else this.freeze = false;
    q.rotate[0] += o.rotate[0]; q.rotate[1] += o.rotate[1]; q.pan[0] += o.pan[0]; q.pan[1] += o.pan[1]; q.zoom += o.zoom; this.pendingHover = o.hover;
    if (o.select) this.events.select(o.select.x * innerWidth, o.select.y * innerHeight);
    if (o.menu) this.events.menu(); if (o.home) this.events.home(); if (o.pauseTime) this.events.pauseTime();
  }
  private freeze = false;
  /** Called from the render loop. Applies gestures gradually so 30 Hz tracking looks smooth at any display rate. */
  frame(dtMs: number, nav: NavigationTarget) {
    const q = this.queue;
    if (this.freeze) nav.stop();
    if (q.rotate[0] || q.rotate[1] || q.pan[0] || q.pan[1] || q.zoom) {
      const k = 1 - Math.exp(-dtMs / 55), take = (v: number) => (Math.abs(v) < 1e-6 ? v : v * k), r = [take(q.rotate[0]), take(q.rotate[1])], p = [take(q.pan[0]), take(q.pan[1])], z = take(q.zoom);
      if (r[0] || r[1]) nav.rotate(r[0], r[1]); if (p[0] || p[1]) nav.pan(p[0], p[1]); if (z) nav.zoom(z);
      q.rotate = [q.rotate[0] - r[0], q.rotate[1] - r[1]]; q.pan = [q.pan[0] - p[0], q.pan[1] - p[1]]; q.zoom -= z;
      for (const a of [q.rotate, q.pan]) for (const i of [0, 1]) if (Math.abs(a[i]) < 1e-6) a[i] = 0; if (Math.abs(q.zoom) < 1e-6) q.zoom = 0;
    }
    if (this.pendingHover) { nav.hover(this.pendingHover.x * innerWidth, this.pendingHover.y * innerHeight); this.hovering = true; } else if (this.hovering) { nav.clearHover(); this.hovering = false; }
  }
  private drawMini(hands: Hand[]) {
    const c = this.mini, g = c.getContext('2d')!, w = c.width, h = c.height; g.clearRect(0, 0, w, h); g.lineWidth = 2; g.strokeStyle = '#e08a4c';
    for (const hand of hands) for (const b of HAND_BONES) { g.beginPath(); b.forEach((i, n) => { const p = hand.lm[i], x = (1 - p.x) * w, y = p.y * h; if (n) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); }
  }
  private drawOverlay(hands: Hand[]) {
    this.drawMini(hands);
    const c = this.overlay; if (!c.isConnected) return; const w = (c.width = this.video.videoWidth || 640), h = (c.height = this.video.videoHeight || 480), g = c.getContext('2d')!; g.lineWidth = 3; g.strokeStyle = '#e08a4c'; g.fillStyle = '#fff';
    for (const hand of hands) { for (const b of HAND_BONES) { g.beginPath(); b.forEach((i, n) => { const p = hand.lm[i]; if (n) g.lineTo(p.x * w, p.y * h); else g.moveTo(p.x * w, p.y * h); }); g.stroke(); } for (const p of hand.lm) { g.beginPath(); g.arc(p.x * w, p.y * h, 3.5, 0, 7); g.fill(); } }
  }
  startCalibration() { this.calibrator = new Calibrator(); this.events.status(); }
  cancelCalibration() { this.calibrator = null; this.events.status(); }
  /** Helpers for the automated tests. */
  testTools = { makeHand, classifyHand: (h: Hand) => classify(features(h.lm, h.world), DEFAULT_CALIBRATION.pinchIn), pauseCamera: () => { this.nextAt = Infinity; } };
  /** Runs the real tracker on one still image. Used by the automated image tests only. */
  detectStill(bitmap: ImageBitmap) { const id = ++this.id; return new Promise<Hand[]>((ok) => { this.stills.set(id, ok); this.worker!.postMessage({ type: 'still', id, bitmap }, [bitmap]); }); }
}
