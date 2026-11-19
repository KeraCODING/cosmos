import { geoMoonEcliptic, helioEcliptic, length, AU_KM, BODY_IDS, type BodyId } from '../astro/ephemeris';
import { listEvents, type AstroEvent, type EventKind } from '../astro/events';
import { bodyById, CATALOG, searchBodies, type Evidence } from '../data/catalog';
import { checkAgainstHorizons, type HorizonsCheck } from '../data/horizons';
import { EarthExplorer, LAYER_CREDITS, searchPlaces, TERRAIN_CREDIT, type EarthLayer, type GeoResult } from '../earth/EarthExplorer';
import { SpaceView } from '../engine/SpaceView';
import { bodyName, dateOnly, dateTime, language, LANGUAGES, num, plain, setLanguage, t, tList, type Language } from '../i18n';
import { MAX_SPIN_RATE, RATES, SimClock } from '../sim/clock';
import { satellite, satelliteOffsetKm, satellitesOf } from '../astro/satellites';
import { store, PROFILES, type Bookmark, type Quality, type Settings } from '../settings/store';
import { sound } from './sound';
import { h, icon, type Attrs, type Child } from './dom';
import { buildHandPanel, miniDemo } from './HandPanel';
import { GalaxyStage, DEEP_OBJECTS, DEEP_SOURCE } from '../deep/GalaxyStage';
import { RoverStage, WORLD } from '../rover/RoverStage';
import { GESTURE_IDS, type GestureId } from '../hands/gestures';
import { HandController, type NavigationTarget } from '../hands/HandController';
import type { ControlMode } from '../settings/store';

const HAND_REACH = 56, UI_REACH = 40;
type Panel = 'search' | 'settings' | 'events' | 'library' | 'help' | 'hands' | 'consent' | null;
const EVENT_KINDS: EventKind[] = ['solarEclipse', 'lunarEclipse', 'season', 'opposition', 'fullMoon', 'newMoon'];

export class App {
  clock = new SimClock(); view: SpaceView; earth = new EarthExplorer();
  private chrome = document.getElementById('chrome')!; private earthEl = document.getElementById('earth')!; private canvas = document.getElementById('space') as HTMLCanvasElement;
  mode: 'space' | 'earth' | 'deep' | 'rover' = 'space'; galaxy?: GalaxyStage; rover?: RoverStage; deepSelected: string | null = null; private stageBusy = false; private roverEls: { speed?: HTMLElement; dist?: HTMLElement; found?: HTMLElement; next?: HTMLElement; pos?: HTMLElement; map?: HTMLCanvasElement; scan?: HTMLButtonElement } = {}; private roverMap?: HTMLImageElement; private stripChips = new Map<GestureId, HTMLElement>(); panel: Panel = null; selected: BodyId | null = null; infoOpen = false; infoTab: 'data' | 'learn' = 'data';
  private history: (BodyId | 'home')[] = ['home']; private historyAt = 0; private toastTimer?: number; private online = navigator.onLine; private fullscreen = false;
  private clockEls: { date?: HTMLInputElement; rate?: HTMLElement; play?: HTMLElement; live?: HTMLElement } = {}; private perfEl?: HTMLElement; private coordsEl?: HTMLElement; private livePos?: HTMLElement;
  private check?: { id: BodyId; state: 'busy' | HorizonsCheck }; private eventsCache?: { from: number; list: AstroEvent[] }; private eventFilter = new Set<EventKind>(['solarEclipse', 'lunarEclipse', 'season', 'opposition']);
  private earthState = { layer: 'natural' as EarthLayer, terrain: false, lighting: false, borders: true, labels: true, results: null as GeoResult[] | string | null, query: '', status: 'idle' as 'idle' | 'loading' | 'error' };
  private lastUi = 0; private searchQuery = ''; private hudText = h('span'); private handHud = h('div', { id: 'hand-hud', hidden: true }, this.hudText);
  hands: HandController; private consented = false; private pendingMode: ControlMode = 'hand'; private handUpdate?: () => void; private handCursor = h('div', { id: 'hand-cursor', hidden: true }); private hoverEl: Element | null = null;
  private spaceNav: NavigationTarget = {
    rotate: (x, y) => this.view.rotateBy(-x * Math.PI, -y * 2), pan: (x, y) => this.view.panPixels(x * innerWidth, y * innerHeight), zoom: (l) => this.view.zoom(Math.exp(l * 1.6)),
    hover: (x, y) => { this.view.hoverAt(x, y, HAND_REACH); }, clearHover: () => this.view.setHover(null), stop: () => this.view.stopMotion(),
  };
  private earthNav: NavigationTarget = {
    rotate: (x, y) => { if (this.earth.ready) this.earth.rotate(x, y); }, pan: (x, y) => { if (this.earth.ready) this.earth.rotate(x, y); }, zoom: (l) => { if (this.earth.ready) this.earth.zoom(l * 1.6); },
    hover: (x, y) => { if (this.earth.ready) this.earth.hover(x, y); }, clearHover: () => {}, stop: () => {},
  };
  private idleNav: NavigationTarget = { rotate() {}, pan() {}, zoom() {}, hover() {}, clearHover() {}, stop() {} };

  constructor() {
    const s = store.value;
    document.body.append(this.handCursor, this.handHud); this.clock.auto = true;
    this.hands = new HandController({
      select: (x, y) => this.handSelect(x, y), menu: () => this.toggleHandMenu(), home: () => this.goHome(), pauseTime: () => { this.clock.toggle(); this.render(); }, status: () => this.render(),
      failed: (r) => { store.set({ controlMode: 'mouse' }); this.toast(t(`hand.fail.${r}`)); this.render(); }, calibrated: () => { this.toast(t('hand.cal.done')); this.render(); },
    });
    this.handHud.prepend(this.hands.mini);
    this.view = new SpaceView(this.canvas, document.getElementById('labels')!, s, {
      onSelect: (id) => this.select(id), onFocus: (id) => this.focusBody(id), onContextLost: () => this.toast(t('error.webgl')), onTextureError: () => this.toast(t('error.texture')), onLeaveSystem: () => void this.openGalaxy(),
    }, (id) => bodyName(id));
    this.view.setScale(s.scale); this.view.home(true);
    this.applyDocument(); this.bindGlobal(); this.render();
    store.subscribe((v, changed) => this.onSettings(v, changed));
    requestAnimationFrame(this.loop);
    window.cosmos.setOffline(s.offlineMode);
  }
  private get netOk() { return this.online && !store.value.offlineMode; }

  // ---- loop ----
  private prev = performance.now();
  private loop = (now: number) => {
    requestAnimationFrame(this.loop);
    const dt = now - this.prev; this.prev = now; this.clock.applyAuto(this.view.isOverview); this.view.effectsPaused = this.clock.paused; this.view.timeRate = this.clock.paused ? 0 : this.clock.rate; this.clock.tick(Math.min(dt, 250));
    if (this.hands.active) { this.hands.frame(dt, this.panel || this.hands.menuOpen ? this.idleNav : this.mode === 'earth' ? this.earthNav : this.spaceNav); this.updateHandCursor(); }
    if (this.mode === 'rover' && this.rover) this.driveByHand(); if (this.mode !== 'earth') this.view.tick(now, this.clock.date);
    if (now - this.lastUi > 200) { this.lastUi = now; this.updateLive(); }
  };
  private updateLive() {
    const e = this.clockEls, c = this.clock;
    this.handUpdate?.(); this.updateRoverHud();
    if (e.date && document.activeElement !== e.date) e.date.value = c.date.toISOString().slice(0, 16);
    if (e.rate) e.rate.textContent = c.paused ? t('time.paused') : this.rateLabel();
    if (this.perfEl) {
      const st = this.view.stats(), mem = (performance as any).memory?.usedJSHeapSize as number | undefined, gpu = this.view.gpuName();
      this.perfEl.replaceChildren(...[[t('perf.fps'), this.mode === 'space' ? Math.round(st.fps) : t('perf.paused3d')], [t('perf.quality'), t(`quality.${store.value.quality}`)], [t('perf.calls'), st.calls], [t('perf.triangles'), plain(st.triangles)], [t('perf.textures'), `${st.textures} (${st.loaded})`], [t('perf.memory'), mem ? `${Math.round(mem / 1048576)} MB` : t('common.unavailable')], [t('perf.gpu'), gpu ?? t('common.unavailable')]].map(([a, b]) => h('div', {}, h('span', {}, String(a)), h('b', {}, String(b)))));
    }
    if (this.livePos && this.selected) {
      const id = this.selected, rows: string[] = [];
      if (id !== 'sun') { const au = length(helioEcliptic(id, c.date)); rows.push(t('live.sun', { au: num(au, 5), km: num(au * AU_KM / 1e6, 5) })); }
      const sat = satellite(id); if (sat) rows.push(t('live.parent', { name: bodyName(sat.parent), km: plain(Math.round(Math.hypot(...satelliteOffsetKm(id, c.date)))) }));
      if (id === 'moon') rows.push(t('live.earth', { km: plain(Math.round(length(geoMoonEcliptic(c.date)) * AU_KM)) }));
      else if (id !== 'earth' && id !== 'sun') { const a = helioEcliptic(id, c.date), b = helioEcliptic('earth', c.date); rows.push(t('live.earthAu', { au: num(length([a[0] - b[0], a[1] - b[1], a[2] - b[2]]), 5) })); }
      this.livePos.textContent = rows.join(' · ') || t('live.origin');
    }
  }
  private rateLabel() { const r = this.clock.rate, abs = Math.abs(r), i = (RATES as readonly number[]).indexOf(abs); return `${this.clock.auto ? `${t('time.auto')} · ` : ''}${r < 0 ? '−' : ''}${t(`time.rate${i}`)}${abs > MAX_SPIN_RATE ? ` · ${t('time.spinCap')}` : ''}`; }

  // ---- state changes ----
  private applyDocument() {
    const s = store.value, r = document.documentElement.classList;
    document.documentElement.style.setProperty('--ui', String(s.uiScale * (s.largeText ? 1.14 : 1)));
    r.toggle('contrast', s.highContrast); r.toggle('calm', s.reduceMotion);
  }
  private onSettings(s: Settings, changed: (keyof Settings)[]) {
    const has = (...k: (keyof Settings)[]) => k.some((x) => changed.includes(x));
    if (has('skyEffects', 'asteroids', 'quality', 'renderScale', 'textureQuality', 'bloom', 'antialias', 'atmosphere', 'showOrbits', 'showLabels', 'eclipseShadows', 'fpsLimit', 'rotateSensitivity', 'zoomSensitivity', 'invertY', 'reduceMotion')) this.view.applySettings(s);
    if (has('scale')) { this.view.setScale(s.scale); this.canvas.classList.remove('fade'); void this.canvas.offsetWidth; this.canvas.classList.add('fade'); }
    if (has('offlineMode')) window.cosmos.setOffline(s.offlineMode);
    if (has('controlMode', 'gestureConfig', 'calibration', 'handMove', 'handZoom', 'handConfirm', 'handSmooth', 'handDetect', 'handTrack')) this.hands.syncSettings(changed);
    if (has('soundEnabled', 'volume', 'ambient')) sound.sync();
    if (has('uiScale', 'largeText', 'highContrast', 'reduceMotion')) this.applyDocument();
    if (has('windowSize') && s.windowSize !== 'auto') { const [w, h2] = s.windowSize.split('x').map(Number); void window.cosmos.setResolution(w, h2); }
  }
  set(patch: Partial<Settings>, rerender = true) { store.set(patch); if (rerender) this.render(); }
  async changeLanguage(l: Language) { store.set({ language: l }); await setLanguage(l); this.view.refreshLabels(); this.galaxy?.refreshNames(); this.render(); }
  select(id: BodyId | null) {
    this.selected = id; this.view.select(id, true); this.infoOpen = !!id; this.check = undefined;
    if (id) { store.set({ recents: [id, ...store.value.recents.filter((x) => x !== id)].slice(0, 12) }); sound.click(); }
    this.render();
  }
  focusBody(id: BodyId, push = true) {
    if (this.mode === 'earth') this.setMode('space');
    this.view.syncTime(this.clock.date); this.view.flyTo(id); this.selected = id; this.infoOpen = true; this.check = undefined;
    if (push) this.pushHistory(id);
    store.set({ recents: [id, ...store.value.recents.filter((x) => x !== id)].slice(0, 12) }); this.render();
  }
  goHome(push = true) { if (this.mode === 'earth') this.setMode('space'); this.view.home(); this.selected = null; this.infoOpen = false; if (push) this.pushHistory('home'); this.render(); }
  private pushHistory(e: BodyId | 'home') { if (this.history[this.historyAt] === e) return; this.history = [...this.history.slice(0, this.historyAt + 1), e].slice(-50); this.historyAt = this.history.length - 1; }
  private travel(step: number) { const i = this.historyAt + step; if (i < 0 || i >= this.history.length) return; this.historyAt = i; const e = this.history[i]; if (e === 'home') this.goHome(false); else this.focusBody(e, false); }
  openPanel(p: Panel) { this.panel = this.panel === p ? null : p; this.view.clearKeys(); this.render(); if (this.panel === 'search') (this.chrome.querySelector('.search-input') as HTMLInputElement)?.focus(); }
  setMode(m: 'space' | 'earth' | 'deep' | 'rover') {
    if (m === this.mode) return; this.mode = m; this.panel = null; if (m === 'space' || m === 'earth') this.view.setStage(null); this.earthEl.hidden = m !== 'earth'; this.canvas.hidden = m === 'earth'; document.getElementById('labels')!.classList.toggle('off', m === 'earth');
    this.view.running = m !== 'earth'; this.view.clearKeys();
    if (m === 'earth') void this.openEarth(); else this.earth.pause();
    this.render();
  }
  private async openEarth() {
    this.earthState.status = 'loading'; this.render();
    try {
      let credits = document.getElementById('earth-credits');
      if (!credits) { credits = h('div', { id: 'earth-credits' }); this.earthEl.append(credits); }
      await this.earth.open(document.getElementById('globe')!, credits, this.clock.date, store.value.reduceMotion);
      this.earth.onCoords = (c) => { if (this.coordsEl) this.coordsEl.textContent = c ? this.formatCoords(c) : t('earth.noPoint'); };
      this.earthState.status = 'idle'; if (!this.netOk && this.earthState.layer !== 'natural') await this.changeLayer('natural');
    } catch (e) { window.cosmos.log('error', `earth: ${e}`); this.earthState.status = 'error'; }
    this.render();
  }
  private formatCoords(c: { lat: number; lon: number; height: number | null }) {
    const f = (v: number, p: string, n: string) => `${Math.abs(v).toFixed(4)}° ${v >= 0 ? t(p) : t(n)}`;
    return `${f(c.lat, 'earth.n', 'earth.s')}, ${f(c.lon, 'earth.e', 'earth.w')}${c.height !== null ? ` · ${t('earth.height', { m: plain(Math.round(c.height)) })}` : ''}`;
  }
  private async changeLayer(l: EarthLayer) { this.earthState.layer = l; try { await this.earth.setLayer(l); } catch (e) { window.cosmos.log('warn', `layer: ${e}`); this.toast(t('error.layer')); } this.render(); }
  // ---- galaxy and rover ----
  async openGalaxy() {
    if (this.stageBusy) return; if (!this.galaxy) { this.stageBusy = true; this.toast(t('deep.loading')); await new Promise((r) => setTimeout(r, 40)); this.galaxy = new GalaxyStage(document.getElementById('labels')!, { select: (id) => this.selectDeep(id), focus: (id) => { this.selectDeep(id); this.galaxy!.flyTo(id, this.view.stageHost); }, sun: () => { this.setMode('space'); this.goHome(); }, name: (id) => (id === 'sun' ? t('deep.sunHere') : t(`astronomy:galaxies.${id}.name`)) }, { low: 0.3, medium: 0.6, high: 1, ultra: 1.5 }[store.value.quality]); this.stageBusy = false; }
    this.setMode('deep'); this.deepSelected = null; this.view.setStage(this.galaxy); this.canvas.classList.remove('fade'); void this.canvas.offsetWidth; this.canvas.classList.add('fade'); this.render();
  }
  selectDeep(id: string | null) { this.deepSelected = id; this.galaxy?.select(id); this.render(); }
  async openRover() {
    if (this.stageBusy) return; this.stageBusy = true;
    try { if (!this.rover) { this.toast(t('rover.loading')); const r = new RoverStage(); await r.load({ low: 0.35, medium: 0.65, high: 1, ultra: 1 }[store.value.quality], this.clock.date); r.onScan = (i) => { this.toast(tList('rover.facts')[i % tList('rover.facts').length]); this.render(); }; this.rover = r; this.roverMap = new Image(); this.roverMap.src = './mars/region.jpg'; } this.selected = null; this.infoOpen = false; this.setMode('rover'); this.view.setStage(this.rover); this.canvas.classList.remove('fade'); void this.canvas.offsetWidth; this.canvas.classList.add('fade'); this.toast(t('rover.welcome')); }
    catch (e) { window.cosmos.log('error', `rover: ${e}`); this.toast(t('rover.failed')); }
    this.stageBusy = false; this.render();
  }
  private leaveRover() { this.setMode('space'); this.focusBody('mars'); }
  private scanRover() { const r = this.rover; if (!r) return; if (r.scan() === null) this.toast(t('rover.tooFar')); }
  private driveByHand() { const o = this.hands.last, r = this.rover!; if (!this.hands.active || store.value.controlMode === 'mouse' || !o?.hands || o.pose !== 'open' || !o.cursor) { r.driveThrottle = 0; r.driveSteer = 0; return; } const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : Math.max(-1, Math.min(1, (v - Math.sign(v) * 0.12) / 0.3))); r.driveThrottle = -dz(o.cursor.y - 0.5); r.driveSteer = -dz(o.cursor.x - 0.5); }
  private deepBar() { return h('footer', { class: 'bottom glass deep-bar' }, h('button', { type: 'button', class: 'chip on', onclick: () => this.setMode('space') }, t('deep.back')), ...DEEP_OBJECTS.map((o) => h('button', { type: 'button', class: `chip${this.deepSelected === o.id ? ' on' : ''}`, onclick: () => { this.selectDeep(o.id); this.galaxy?.flyTo(o.id, this.view.stageHost); } }, t(`astronomy:galaxies.${o.id}.name`))), h('span', { class: 'deep-note' }, t('deep.note'))); }
  private deepPanel(id: string) {
    const o = DEEP_OBJECTS.find((x) => x.id === id)!, G = `astronomy:galaxies.${id}`, ly = o.distanceKpc * 3261.56;
    return h('aside', { class: 'info glass', 'aria-label': t(`${G}.name`) }, h('div', { class: 'info-head' }, h('div', {}, h('h2', {}, t(`${G}.name`)), h('p', {}, t(`deep.kind.${o.kind}`))), this.btn('close', t('action.close'), () => this.selectDeep(null))), h('div', { class: 'actions' }, h('button', { type: 'button', class: 'solid', onclick: () => this.galaxy?.flyTo(id, this.view.stageHost) }, icon('focus'), t('action.focus'))), h('div', { class: 'scroll' }, h('p', { class: 'lead' }, t(`${G}.text`)), h('div', { class: 'table' }, o.id !== 'milkyway' && h('div', { class: 'row' }, h('span', {}, t('deep.distance')), h('b', {}, ly >= 1e6 ? t('deep.mly', { v: num(ly / 1e6, 3) }) : t('deep.kly', { v: num(ly / 1e3, 3) }))), o.measurements > 0 && id !== 'sgra' && h('div', { class: 'row' }, h('span', {}, t('deep.measurements')), h('b', {}, String(o.measurements)))), h('div', { class: 'evline' }, this.evidence('confirmed'), h('small', {}, t('deep.dataNote'))), h('div', { class: 'evline' }, this.evidence('artistic'), h('small', {}, t('deep.visualNote'))), h('p', { class: 'source' }, t('info.source'), ' ', h('button', { type: 'button', class: 'link inline', onclick: () => void window.cosmos.openLink(DEEP_SOURCE.url) }, DEEP_SOURCE.name), h('br'), t('info.updated', { date: dateOnly(new Date(DEEP_SOURCE.retrieved)) }))));
  }
  private roverHud() {
    const E = this.roverEls, stat = (k: string, slot: keyof typeof E) => { const b = h('b', {}, '–'); (E as Record<string, HTMLElement>)[slot] = b; return h('div', { class: 'row' }, h('span', {}, t(`rover.${k}`)), b); }, map = h('canvas', { width: 170, height: 170, class: 'rover-map', 'aria-label': t('rover.map') }) as HTMLCanvasElement, scan = h('button', { type: 'button', class: 'solid', onclick: () => this.scanRover() }, t('rover.scan')); E.map = map; E.scan = scan;
    return h('aside', { class: 'rover-hud glass' }, h('div', { class: 'info-head' }, h('h2', {}, t('rover.title')), this.btn('close', t('rover.exit'), () => this.leaveRover())), map, stat('speed', 'speed'), stat('driven', 'dist'), stat('found', 'found'), stat('next', 'next'), stat('position', 'pos'), scan, h('p', { class: 'muted small' }, t(store.value.controlMode === 'mouse' ? 'rover.keys' : 'rover.hand')), h('p', { class: 'attrib' }, t('rover.note')));
  }
  private updateRoverHud() {
    const r = this.rover, E = this.roverEls; if (this.mode !== 'rover' || !r || !E.speed) return; const s = r.status(), arrow = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][((Math.round(-s.bearing / 0.7854) % 8) + 8) % 8];
    E.speed.textContent = t('rover.ms', { v: num(Math.abs(s.speed), 2) }); E.dist!.textContent = t('rover.m', { v: plain(Math.round(s.distance)) }); E.found!.textContent = `${s.scanned} / ${s.total}`; E.next!.textContent = s.scanned < s.total ? `${arrow} ${t('rover.m', { v: plain(Math.round(s.nearest)) })}` : t('rover.allFound'); E.pos!.textContent = `${s.lat.toFixed(3)}°, ${s.lon.toFixed(3)}°`; E.scan!.disabled = !s.canScan;
    const c = E.map!, g = c.getContext('2d')!, S = c.width, P = (v: number) => (v / WORLD + 0.5) * S; if (this.roverMap?.complete) g.drawImage(this.roverMap, 0, 0, S, S); for (const q of s.targets) { g.fillStyle = q.done ? '#7c8' : '#ffb066'; g.fillRect(P(q.x) - 2, P(q.z) - 2, 4, 4); } g.save(); g.translate(P(s.x), P(s.z)); g.rotate(Math.PI - s.heading); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.beginPath(); g.moveTo(0, -7); g.lineTo(4.5, 5); g.lineTo(-4.5, 5); g.closePath(); g.fill(); g.stroke(); g.restore();
  }
  private gestureStrip() {
    const cfg = store.value.gestureConfig, hand = store.value.controlMode === 'hand', roverOn = this.mode === 'rover', list: [GestureId, string][] = roverOn ? [['openPalm', 'rover.gDrive'], ['fist', 'rover.gStop'], ['pinchSelect', 'rover.gScan']] : GESTURE_IDS.filter((g) => cfg[g].enabled && (hand || !['pinchSelect', 'dwellSelect', 'point', 'palmHold'].includes(g))).map((g) => [g, `hand.short.${g}`]);
    return h('div', { class: 'gesture-strip', 'aria-label': t('hand.gestures') }, list.map(([g, key]) => { const c = h('div', { class: 'gesture-tip', title: t(`hand.g.${g}.how`) }, miniDemo(g), h('span', {}, t(key))); this.stripChips.set(g, c); return c; }));
  }
  // ---- hand control ----
  setControlMode(m: ControlMode) {
    if (m === 'mouse') { this.disableCamera(); return; }
    if (this.hands.active) { store.set({ controlMode: m }); this.render(); return; }
    this.pendingMode = m; if (this.consented) void this.startCamera(); else { this.panel = 'consent'; this.render(); }
  }
  private async startCamera() { this.panel = this.panel === 'consent' ? 'hands' : this.panel; store.set({ controlMode: this.pendingMode }); this.render(); const ok = await this.hands.start(); if (ok && !store.value.calibration) this.toast(t('hand.cal.prompt')); this.render(); }
  disableCamera() { this.hands.stop(); store.set({ controlMode: 'mouse' }); this.handCursor.hidden = true; this.render(); }
  private toggleHandMenu(v = !this.hands.menuOpen) { this.hands.setMenuOpen(v); this.render(); }
  /** Finds the control under the hand cursor, or the nearest one within reach, because a hand is less exact than a mouse. */
  private handTarget(x: number, y: number): HTMLElement | null {
    const q = 'button, [role=tab], input[type=checkbox]', hit = document.elementFromPoint(x, y)?.closest(q) as HTMLElement | null; if (hit) return hit;
    const root = this.hands.menuOpen ? this.chrome.querySelector('.hand-menu') : this.panel ? this.chrome.querySelector('.sheet') : this.chrome; let best: HTMLElement | null = null, near = UI_REACH;
    root?.querySelectorAll<HTMLElement>(q).forEach((el) => { const r = el.getBoundingClientRect(); if (!r.width || (el as HTMLButtonElement).disabled) return; const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom)); if (d < near) { near = d; best = el; } }); return best;
  }
  private handSelect(x: number, y: number) {
    this.handCursor.classList.remove('click'); void this.handCursor.offsetWidth; this.handCursor.classList.add('click');
    const exact = document.elementFromPoint(x, y)?.closest('button, [role=tab], input[type=checkbox]') as HTMLElement | null; if (exact) { exact.click(); return; }
    if (this.mode === 'rover' && !this.panel && !this.hands.menuOpen) { this.scanRover(); return; }
    if (this.mode === 'deep' && !this.panel && !this.hands.menuOpen) { const id = this.view.pickAt(x, y, HAND_REACH); if (id) { this.selectDeep(id); return; } }
    if (this.mode === 'space' && !this.panel && !this.hands.menuOpen) { const id = this.view.pickAt(x, y, HAND_REACH) as BodyId | null; if (id) { this.select(id); return; } }
    this.handTarget(x, y)?.click();
  }
  private updateHandCursor() {
    const o = this.hands.last, c = o?.cursor, on = store.value.controlMode !== 'mouse', show = !!c && store.value.controlMode === 'hand'; this.handCursor.hidden = !show; let target: Element | null = null;
    this.handHud.hidden = !on; if (on) this.hudText.textContent = this.hands.state === 'tracking' ? t(`hand.pose.${o?.pose ?? 'none'}`) : t(`hand.state.${this.hands.state}`);
    this.stripChips.forEach((el, g) => el.classList.toggle('on', o?.active === g));
    if (show && c) { const x = c.x * innerWidth, y = c.y * innerHeight; this.handCursor.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; this.handCursor.style.setProperty('--dwell', `${Math.round((o?.dwell ?? 0) * 360)}deg`); this.handCursor.classList.toggle('pinch', o?.pose === 'pinch'); target = this.handTarget(x, y); }
    if (target !== this.hoverEl) { this.hoverEl?.classList.remove('hand-hover'); target?.classList.add('hand-hover'); this.hoverEl = target; }
  }
  private cycleBody(step: number) { const i = BODY_IDS.indexOf(this.selected ?? this.view.focus), n = BODY_IDS.length; this.focusBody(BODY_IDS[(i + step + n) % n]); }
  private handMenu() {
    const item = (label: string, fn: () => void, keep = false) => h('button', { type: 'button', onclick: () => { fn(); if (!keep) this.toggleHandMenu(false); else this.render(); } }, label);
    return h('div', { class: 'hand-menu glass', role: 'menu', 'aria-label': t('hand.menu.title') }, h('p', {}, t('hand.menu.hint')), item(t('hand.menu.prev'), () => this.cycleBody(-1), true), item(t('hand.menu.next'), () => this.cycleBody(1), true), item(t('action.home'), () => this.goHome()), item(this.clock.paused ? t('time.resume') : t('time.pause'), () => this.clock.toggle(), true), item(this.mode === 'space' ? t('nav.earth') : t('nav.solar'), () => this.setMode(this.mode === 'space' ? 'earth' : 'space')), item(t('nav.events'), () => this.openPanel('events')), item(t('hand.menu.panel'), () => this.openPanel('hands')), item(t('action.close'), () => {}));
  }
  private consentPanel() { return h('div', { class: 'col' }, h('p', { class: 'lead' }, t('hand.consent.text')), h('ul', {}, ['a', 'b', 'c'].map((k) => h('li', {}, t(`hand.consent.${k}`)))), h('div', { class: 'inline-form' }, h('button', { type: 'button', class: 'solid', onclick: () => { this.consented = true; void this.startCamera(); } }, t('hand.consent.allow')), h('button', { type: 'button', class: 'solid alt', onclick: () => { this.panel = null; this.render(); } }, t('hand.consent.cancel')))); }
  private handsPanel() { const p = buildHandPanel({ hands: this.hands, setMode: (m) => this.setControlMode(m), enable: () => this.setControlMode(store.value.controlMode === 'hybrid' ? 'hybrid' : 'hand'), disable: () => this.disableCamera(), set: (x, r) => this.set(x, r) }); this.handUpdate = p.update; return p.node; }
  toast(msg: string) { let el = document.getElementById('toast'); if (!el) { el = h('div', { id: 'toast', role: 'status' }); document.body.append(el); } el.textContent = msg; el.classList.add('show'); clearTimeout(this.toastTimer); this.toastTimer = window.setTimeout(() => el!.classList.remove('show'), 4200); }
  private escape() {
    if (this.hands.menuOpen) this.hands.setMenuOpen(false); else if (this.panel) this.panel = null; else if (this.mode === 'rover') { this.leaveRover(); return; } else if (this.mode === 'deep') { if (this.deepSelected) this.selectDeep(null); else this.setMode('space'); return; } else if (this.infoOpen) { this.infoOpen = false; this.selected = null; this.view.select(null, true); } else if (this.mode === 'earth') { this.setMode('space'); return; } else return;
    this.render();
  }
  private bindGlobal() {
    addEventListener('resize', () => { this.view.resize(); this.earth.resize(); });
    addEventListener('online', () => { this.online = true; this.render(); }); addEventListener('offline', () => { this.online = false; this.render(); });
    addEventListener('blur', () => this.view.clearKeys());
    addEventListener('click', (e) => { if ((e.target as HTMLElement).closest?.('button')) sound.click(); }, true);
    addEventListener('keydown', (e) => {
      const el = e.target as HTMLElement, typing = el.matches?.('input:not([type=range]):not([type=checkbox]),textarea,select');
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') { e.preventDefault(); if (this.hands.active) { this.disableCamera(); this.toast(t('hand.stopped')); } return; }
      if (e.key === 'F11') { e.preventDefault(); void window.cosmos.toggleFullscreen().then((f) => { this.fullscreen = f; }); return; }
      if (e.key === 'Escape') { e.preventDefault(); if (typing) el.blur(); this.escape(); return; }
      if (typing) return;
      if ((e.ctrlKey && e.code === 'KeyK') || e.key === '/') { e.preventDefault(); if (this.panel !== 'search') this.openPanel('search'); return; }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.code === 'Space') { if (el.tagName === 'BUTTON') el.blur(); e.preventDefault(); this.clock.toggle(); this.render(); return; }
      if (this.mode === 'earth' || this.panel) return;
      if (this.mode === 'rover' && e.code === 'KeyE') { this.scanRover(); return; }
      if (this.mode === 'rover' && e.code.startsWith('Arrow')) { e.preventDefault(); this.view.setKey(e.code, true); return; }
      if (e.code === 'KeyF') { if (this.mode === 'deep') { if (this.deepSelected) this.galaxy?.flyTo(this.deepSelected, this.view.stageHost); } else if (this.mode === 'rover') return; else if (this.selected) this.focusBody(this.selected); else this.toast(t('hint.selectFirst')); return; }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract'].includes(e.code)) { e.preventDefault(); this.view.setKey(e.code, true); }
    });
    addEventListener('keyup', (e) => this.view.setKey(e.code, false));
  }

  // ---- rendering ----
  private btn(name: string, label: string, onclick: () => void, extra: Attrs = {}) { return h('button', { class: 'icon-btn', type: 'button', title: label, 'aria-label': label, onclick, ...extra }, icon(name)); }
  render() {
    const active = document.activeElement as HTMLElement | null, focusKey = active?.dataset?.fk, caret = (active as HTMLInputElement)?.selectionStart ?? null;
    const scroll = this.chrome.querySelector('.scroll')?.scrollTop ?? 0;
    this.handUpdate = undefined; this.clockEls = {}; this.perfEl = undefined; this.coordsEl = undefined; this.livePos = undefined;
    const s = store.value, kids: Child[] = [this.topBar()];
    this.roverEls = {}; this.stripChips.clear();
    if (this.mode === 'space') { kids.push(this.bottomBar(), this.scaleBadge()); if (this.infoOpen && this.selected) kids.push(this.infoPanel(this.selected)); } else if (this.mode === 'earth') kids.push(this.earthBar()); else if (this.mode === 'deep') kids.push(this.deepBar(), this.deepSelected ? this.deepPanel(this.deepSelected) : null); else kids.push(this.roverHud());
    if (s.controlMode !== 'mouse' && this.hands.active) kids.push(this.gestureStrip());
    if (s.showPerf) { this.perfEl = h('div', { class: `perf glass${this.mode === 'earth' || this.mode === 'rover' ? ' right' : ''}`, 'aria-label': t('perf.title') }); kids.push(this.perfEl); }
    if (this.panel) kids.push(this.overlay(this.panel));
    if (this.hands.menuOpen) kids.push(this.handMenu());
    if (!s.welcomed) kids.push(this.welcome());
    this.chrome.replaceChildren(...(kids.filter(Boolean) as Node[]));
    this.hands.park();
    const sc = this.chrome.querySelector('.scroll'); if (sc) sc.scrollTop = scroll;
    if (focusKey) { const n = this.chrome.querySelector<HTMLElement>(`[data-fk="${focusKey}"]`); if (n) { n.focus(); if (caret !== null && (n as HTMLInputElement).setSelectionRange && (n as HTMLInputElement).type === 'text') (n as HTMLInputElement).setSelectionRange(caret, caret); } }
    this.updateLive();
  }
  private topBar() {
    const nav = (key: string, on: boolean, fn: () => void) => h('button', { type: 'button', class: `nav-btn${on ? ' on' : ''}`, 'aria-pressed': String(on), onclick: fn }, t(key));
    const net = store.value.offlineMode ? 'offline' : this.online ? 'online' : 'nonet';
    return h('header', { class: `top${this.mode === 'earth' ? ' solid-bar' : ''}` },
      h('div', { class: 'brand' }, 'COSMOS'),
      h('nav', { 'aria-label': t('nav.label') }, nav('nav.solar', this.mode === 'space' && !this.panel, () => { this.panel = null; this.setMode('space'); this.render(); }), nav('nav.earth', this.mode === 'earth' && !this.panel, () => { this.panel = null; this.setMode('earth'); this.render(); }), nav('nav.galaxy', this.mode === 'deep' && !this.panel, () => { this.panel = null; void this.openGalaxy(); }), nav('nav.events', this.panel === 'events', () => this.openPanel('events')), nav('nav.library', this.panel === 'library', () => this.openPanel('library'))),
      h('div', { class: 'spacer' }),
      this.hands.active && h('div', { class: 'cam-pill', role: 'status' }, h('i'), t('hand.active'), h('button', { type: 'button', onclick: () => this.disableCamera(), title: 'Ctrl+Shift+C' }, t('hand.off'))),
      h('div', { class: 'seg control-mode', role: 'group', 'aria-label': t('hand.mode') }, ...(['mouse', 'hand', 'hybrid'] as ControlMode[]).map((m) => h('button', { type: 'button', class: store.value.controlMode === m ? 'on' : '', 'aria-pressed': String(store.value.controlMode === m), title: t(`hand.m.${m}Note`), onclick: () => this.setControlMode(m) }, t(`hand.m.${m}`)))),
      this.btn('hand', t('panel.hands'), () => this.openPanel('hands')),
      h('button', { type: 'button', class: `net ${net}`, title: t('net.tip'), onclick: () => this.set({ offlineMode: !store.value.offlineMode }) }, h('i'), t(`net.${net}`)),
      this.btn('back', t('action.back'), () => this.travel(-1), { disabled: this.historyAt <= 0 }), this.btn('forward', t('action.forward'), () => this.travel(1), { disabled: this.historyAt >= this.history.length - 1 }),
      this.btn('home', t('action.home'), () => this.goHome()), this.btn('search', t('action.search'), () => this.openPanel('search')), this.btn('settings', t('action.settings'), () => this.openPanel('settings')),
      this.btn('full', t('action.fullscreen'), () => void window.cosmos.toggleFullscreen()),
      h('button', { type: 'button', class: 'icon-btn help', title: t('action.help'), 'aria-label': t('action.help'), onclick: () => this.openPanel('help') }, '?'));
  }
  private bottomBar() {
    const c = this.clock, s = store.value, after = (f: () => void) => () => { f(); this.render(); };
    const date = h('input', { type: 'datetime-local', class: 'date', 'aria-label': t('time.date'), title: t('time.date'), min: '1600-01-01T00:00', max: '2499-12-31T23:59', 'data-fk': 'date', onchange: (e: Event) => { const v = (e.target as HTMLInputElement).value; if (v) { c.set(Date.parse(v + ':00Z')); this.render(); } } });
    const rate = h('span', { class: 'rate', 'aria-live': 'off' });
    this.clockEls = { date, rate };
    const toggle = (key: keyof Settings, label: string) => h('button', { type: 'button', class: `chip${s[key] ? ' on' : ''}`, 'aria-pressed': String(!!s[key]), onclick: () => this.set({ [key]: !s[key] } as Partial<Settings>) }, label);
    return h('footer', { class: 'bottom glass' },
      this.btn('reverse', t('time.reverse'), after(() => c.reverse()), { class: `icon-btn${c.direction < 0 ? ' on' : ''}` }), this.btn('slower', t('time.slower'), after(() => c.slower()), { disabled: c.rateIndex === 0 }),
      this.btn(c.paused ? 'play' : 'pause', c.paused ? t('time.resume') : t('time.pause'), after(() => c.toggle()), { class: 'icon-btn primary' }), this.btn('faster', t('time.faster'), after(() => c.faster()), { disabled: c.rateIndex === RATES.length - 1 }), rate,
      h('button', { type: 'button', class: `chip${c.auto ? ' on' : ''}`, 'aria-pressed': String(c.auto), title: t('time.autoTip'), onclick: after(() => { c.auto = !c.auto; if (c.auto) c.paused = false; }) }, t('time.auto')),
      h('button', { type: 'button', class: `chip${c.isRealtime ? ' on' : ''}`, title: t('time.nowTip'), onclick: after(() => c.realtime()) }, t('time.now')), date, h('span', { class: 'utc' }, 'UTC'), h('div', { class: 'spacer' }),
      h('div', { class: 'seg', role: 'group', 'aria-label': t('scale.label') }, ...(['educational', 'true'] as const).map((m) => h('button', { type: 'button', class: s.scale === m ? 'on' : '', 'aria-pressed': String(s.scale === m), onclick: () => this.set({ scale: m }) }, t(`scale.${m}`)))),
      toggle('showOrbits', t('view.orbits')), toggle('showLabels', t('view.labels')));
  }
  private scaleBadge() { return h('div', { class: 'scale-note' }, t(`scale.note.${store.value.scale}`), store.value.skyEffects && !store.value.reduceMotion ? ` ${t('effects.note')}` : ''); }
  private evidence(e: Evidence) { return h('span', { class: `ev ev-${e}`, title: t(`evidence.${e}Tip`) }, t(`evidence.${e}`)); }
  private fact(id: BodyId, f: { key: string; value: number; unit: string }) {
    const label = id === 'moon' && f.key === 'distanceFromSunE6Km' ? t('fact.distanceFromEarth') : t(`fact.${f.key}`), retro = (f.key === 'rotationPeriodH' || f.key === 'lengthOfDayH') && f.value < 0;
    const val = f.unit === 'none' ? plain(f.value) : t(`unit.${f.unit}`, { v: plain(f.value) });
    return h('div', { class: 'row' }, h('span', {}, label), h('b', {}, val, retro && h('em', {}, ` ${t('fact.retrograde')}`)));
  }
  private infoPanel(id: BodyId) {
    const r = bodyById(id)!, s = store.value, A = `astronomy:bodies.${id}`, fav = s.favorites.includes(id), learn = s.educationMode && this.infoTab === 'learn';
    const live = h('p', { class: 'live' }); this.livePos = live;
    const tab = (k: 'data' | 'learn') => h('button', { type: 'button', role: 'tab', 'aria-selected': String(this.infoTab === k), class: this.infoTab === k ? 'on' : '', onclick: () => { this.infoTab = k; this.render(); } }, t(`info.${k}`));
    const body = learn ? [
      h('div', { class: 'seg wide', role: 'group', 'aria-label': t('info.level') }, ...(['beginner', 'advanced'] as const).map((l) => h('button', { type: 'button', class: s.explainLevel === l ? 'on' : '', onclick: () => this.set({ explainLevel: l }) }, t(`info.${l}`)))),
      h('p', { class: 'lead' }, t(`${A}.${s.explainLevel === 'beginner' ? 'simple' : 'detailed'}`)), h('h3', {}, t('info.facts')), h('ul', {}, tList(`${A}.facts`).map((f) => h('li', {}, f))),
      h('h3', {}, t('info.history')), h('p', {}, t(`${A}.history`)), h('h3', {}, t('info.significance')), h('p', {}, t(`${A}.significance`)),
      h('h3', {}, t('info.related')), h('div', { class: 'chips' }, r.related.map((x) => h('button', { type: 'button', class: 'chip', onclick: () => this.focusBody(x) }, bodyName(x)))),
      h('button', { type: 'button', class: 'link', onclick: () => void window.cosmos.openLink(r.reference) }, t('info.reference')),
    ] : [
      live, h('div', { class: 'evline' }, this.evidence('model'), h('small', {}, t('info.positionModel'))),
      satellitesOf(id).length > 0 && h('h3', {}, t('info.moons')), satellitesOf(id).length > 0 && h('div', { class: 'chips' }, satellitesOf(id).map((m) => h('button', { type: 'button', class: 'chip', onclick: () => this.focusBody(m.id as BodyId) }, bodyName(m.id)))),
      h('div', { class: 'table' }, r.facts.map((f) => this.fact(id, f))), h('div', { class: 'evline' }, this.evidence('confirmed'), h('small', {}, t('info.factsEvidence'))),
      h('div', { class: 'evline' }, this.evidence(r.imagery.evidence), h('small', {}, t(`astronomy:imagery.${r.imagery.key}`))),
      h('p', { class: 'source' }, t('info.source'), ' ', h('button', { type: 'button', class: 'link inline', onclick: () => void window.cosmos.openLink(r.source.url) }, r.source.name), h('br'), t('info.updated', { date: dateOnly(new Date(r.source.retrieved)) })),
      id !== 'sun' && this.horizonsBox(id),
    ];
    return h('aside', { class: 'info glass', 'aria-label': bodyName(id) },
      h('div', { class: 'info-head' }, h('div', {}, h('h2', {}, bodyName(id)), h('p', {}, t(`${A}.type`))), this.btn('close', t('action.close'), () => this.escape())),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'solid', onclick: () => this.focusBody(id) }, icon('focus'), t('action.focus')), id === 'earth' && h('button', { type: 'button', class: 'solid alt', onclick: () => this.setMode('earth') }, t('action.openEarth')), id === 'mars' && h('button', { type: 'button', class: 'solid alt', onclick: () => void this.openRover() }, t('action.driveRover')),
        this.btn('star', fav ? t('action.unfavorite') : t('action.favorite'), () => this.set({ favorites: fav ? s.favorites.filter((x) => x !== id) : [...s.favorites, id] }), { class: `icon-btn${fav ? ' on' : ''}` }), this.btn('bookmark', t('action.bookmark'), () => this.addBookmark())),
      s.educationMode && h('div', { class: 'tabs', role: 'tablist' }, tab('data'), tab('learn')), h('div', { class: 'scroll' }, body));
  }
  private horizonsBox(id: BodyId) {
    const c = this.check?.id === id ? this.check.state : null; let msg: Child = null;
    if (c === 'busy') msg = h('p', { class: 'muted' }, t('horizons.busy'));
    else if (c && c.ok) msg = h('p', {}, t('horizons.result', { km: plain(Math.round(c.differenceKm)), date: dateTime(c.epoch) }), h('br'), h('small', { class: c.fromCache ? 'cached' : 'muted' }, c.fromCache ? t('horizons.cached', { date: dateTime(new Date(c.fetchedAt)) }) : t('horizons.fresh', { date: dateTime(new Date(c.fetchedAt)) })));
    else if (c) msg = h('p', { class: 'warn' }, t(`horizons.${c.reason}`));
    return h('div', { class: 'check' }, h('button', { type: 'button', class: 'solid alt', disabled: c === 'busy', onclick: async () => { this.check = { id, state: 'busy' }; this.render(); const state = await checkAgainstHorizons(id, this.clock.date); if (this.check?.id === id) { this.check = { id, state }; this.render(); } } }, t('horizons.button')), msg);
  }
  private addBookmark() {
    const s = store.value, p = this.view.pose, b: Bookmark = { id: String(Date.now()), name: `${bodyName(p.focus)} · ${dateOnly(this.clock.date)}`, focus: p.focus, time: this.clock.time, az: p.az, pol: p.pol, dist: p.dist, scale: s.scale };
    this.set({ bookmarks: [b, ...s.bookmarks].slice(0, 100) }); this.toast(t('library.bookmarkSaved'));
  }
  private overlay(p: Exclude<Panel, null>) {
    const content = { search: () => this.searchPanel(), settings: () => this.settingsPanel(), events: () => this.eventsPanel(), library: () => this.libraryPanel(), help: () => this.helpPanel(), hands: () => this.handsPanel(), consent: () => this.consentPanel() }[p]();
    return h('div', { class: 'veil', onpointerdown: (e: Event) => { if (e.target === e.currentTarget) { this.panel = null; this.render(); } } }, h('section', { class: `sheet glass sheet-${p}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': t(`panel.${p}`) }, p !== 'search' && h('div', { class: 'sheet-head' }, h('h2', {}, t(`panel.${p}`)), this.btn('close', t('action.close'), () => { this.panel = null; this.render(); })), content));
  }
  private searchPanel() {
    const list = h('div', { class: 'results' }), names = (id: BodyId) => [bodyName(id, 'az'), bodyName(id, 'en'), bodyName(id, 'ru')];
    const fill = (q: string) => {
      this.searchQuery = q; const hits = q.trim() ? searchBodies(q, names) : CATALOG;
      list.replaceChildren(...(hits.length ? hits.map((b) => h('button', { type: 'button', class: 'result', onclick: () => { this.panel = null; this.focusBody(b.id); } }, h('b', {}, bodyName(b.id)), h('span', {}, t(`astronomy:bodies.${b.id}.type`)))) : [h('p', { class: 'muted' }, t('search.none'))]));
    };
    const input = h('input', { class: 'search-input', type: 'text', placeholder: t('search.placeholder'), 'aria-label': t('search.placeholder'), value: this.searchQuery, 'data-fk': 'search', autocomplete: 'off', spellcheck: 'false', oninput: (e: Event) => fill((e.target as HTMLInputElement).value), onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') (list.querySelector('.result') as HTMLElement)?.click(); } });
    fill(this.searchQuery);
    return [h('div', { class: 'search-row' }, icon('search'), input), h('p', { class: 'muted hint' }, t('search.hint')), h('div', { class: 'scroll' }, list)] as unknown as Node;
  }
  private eventsPanel() {
    const from = this.clock.time, wrap = h('div', { class: 'scroll' }), day = 86400000;
    const paint = () => {
      const c = this.eventsCache!, list = c.list.filter((e) => this.eventFilter.has(e.kind));
      wrap.replaceChildren(...(list.length ? list.map((e) => h('div', { class: 'event' }, h('div', {}, h('b', {}, t(`event.${e.kind}${e.detail ? '_' + e.detail : ''}`, { body: bodyName(e.body) })), h('span', {}, dateTime(e.date))), h('button', { type: 'button', class: 'chip', onclick: () => this.gotoEvent(e) }, t('event.view')))) : [h('p', { class: 'muted' }, t('event.none'))]));
    };
    if (this.eventsCache && Math.abs(this.eventsCache.from - from) < 7 * day) setTimeout(paint);
    else { wrap.append(h('p', { class: 'muted' }, t('event.computing'))); setTimeout(() => { try { this.eventsCache = { from, list: listEvents(new Date(from), 366) }; paint(); } catch (e) { window.cosmos.log('error', `events: ${e}`); wrap.replaceChildren(h('p', { class: 'warn' }, t('error.events'))); } }, 30); }
    return h('div', { class: 'col' }, h('p', { class: 'muted' }, t('event.intro', { date: dateOnly(new Date(from)) })), h('div', { class: 'chips' }, EVENT_KINDS.map((k) => h('button', { type: 'button', class: `chip${this.eventFilter.has(k) ? ' on' : ''}`, 'aria-pressed': String(this.eventFilter.has(k)), onclick: () => { if (this.eventFilter.has(k)) this.eventFilter.delete(k); else this.eventFilter.add(k); this.render(); } }, t(`eventKind.${k}`)))), wrap);
  }
  private gotoEvent(e: AstroEvent) {
    this.clock.set(e.date.getTime()); this.clock.paused = true; this.panel = null;
    if (e.kind === 'solarEclipse' || e.kind === 'lunarEclipse') store.set({ scale: 'true' });
    this.focusBody(e.body);
  }
  private libraryPanel() {
    const s = store.value, item = (id: string, extra?: Child) => { const b = bodyById(id); return b ? h('div', { class: 'lib-item' }, h('button', { type: 'button', class: 'link', onclick: () => { this.panel = null; this.focusBody(b.id); } }, bodyName(b.id)), extra) : null; };
    const rm = (label: string, fn: () => void) => h('button', { type: 'button', class: 'mini', title: label, 'aria-label': label, onclick: fn }, '×');
    const empty = (k: string) => h('p', { class: 'muted' }, t(k)), nameInput = h('input', { type: 'text', placeholder: t('library.newName'), 'aria-label': t('library.newName'), 'data-fk': 'col', maxlength: '60' });
    const create = () => { const name = nameInput.value.trim(); if (!name) { this.toast(t('library.nameNeeded')); return; } this.set({ collections: [...s.collections, { id: String(Date.now()), name, items: this.selected ? [this.selected] : [] }] }); };
    return h('div', { class: 'scroll lib' },
      h('h3', {}, t('library.favorites')), s.favorites.length ? s.favorites.map((id) => item(id, rm(t('action.remove'), () => this.set({ favorites: s.favorites.filter((x) => x !== id) })))) : empty('library.noFavorites'),
      h('h3', {}, t('library.bookmarks')), s.bookmarks.length ? s.bookmarks.map((b) => h('div', { class: 'lib-item' }, h('button', { type: 'button', class: 'link', onclick: () => { this.panel = null; this.clock.set(b.time); this.clock.paused = true; store.set({ scale: b.scale }); this.view.syncTime(this.clock.date); this.view.setPose({ focus: b.focus as BodyId, az: b.az, pol: b.pol, dist: b.dist }); this.selected = b.focus as BodyId; this.infoOpen = true; this.render(); } }, b.name), rm(t('action.remove'), () => this.set({ bookmarks: s.bookmarks.filter((x) => x.id !== b.id) })))) : empty('library.noBookmarks'),
      h('h3', {}, t('library.collections')), s.collections.map((c) => h('div', { class: 'col-box' }, h('div', { class: 'lib-item' }, h('b', {}, c.name), rm(t('action.remove'), () => this.set({ collections: s.collections.filter((x) => x.id !== c.id) }))),
        c.items.map((id) => item(id, rm(t('action.remove'), () => this.set({ collections: s.collections.map((x) => x.id === c.id ? { ...x, items: x.items.filter((i) => i !== id) } : x) })))),
        h('select', { 'aria-label': t('library.addTo'), onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) this.set({ collections: s.collections.map((x) => x.id === c.id && !x.items.includes(v) ? { ...x, items: [...x.items, v] } : x) }); } }, h('option', { value: '' }, t('library.addTo')), BODY_IDS.filter((b) => !c.items.includes(b)).map((b) => h('option', { value: b }, bodyName(b)))))),
      h('div', { class: 'inline-form' }, nameInput, h('button', { type: 'button', class: 'solid alt', onclick: create }, t('library.create'))),
      h('h3', {}, t('library.recent')), s.recents.length ? s.recents.map((id) => item(id)) : empty('library.noRecent'));
  }
  private helpPanel() {
    const rows: [string, string][] = [['help.left', 'help.rotate'], ['help.wheel', 'help.zoom'], ['help.right', 'help.pan'], ['help.click', 'help.select'], ['help.double', 'help.focus'], ['WASD', 'help.move'], ['F', 'help.focusKey'], ['Esc', 'help.esc'], ['help.space', 'help.pause'], ['+ / −', 'help.zoom'], ['F11', 'help.full'], ['Ctrl+K', 'help.search']];
    return h('div', { class: 'scroll' }, h('div', { class: 'table' }, rows.map(([k, a]) => h('div', { class: 'row' }, h('span', {}, k.includes('.') ? t(k) : k), h('b', {}, t(a))))), h('h3', {}, t('help.credits')), h('p', { class: 'muted' }, t('help.creditsText')));
  }
  private settingsPanel() {
    const s = store.value, row = (label: string, ctl: Node, note?: string) => h('label', { class: 'set' }, h('span', {}, label, note && h('small', {}, note)), ctl), head = (k: string) => h('h3', {}, t(k));
    const sel = (key: keyof Settings, opts: [string, string][], conv: (v: string) => unknown = (v) => v) => h('select', { 'data-fk': `s-${key}`, onchange: (e: Event) => this.set({ [key]: conv((e.target as HTMLSelectElement).value) } as Partial<Settings>) }, opts.map(([v, l]) => h('option', { value: v, selected: String(s[key]) === v }, l)));
    const chk = (key: keyof Settings) => h('input', { type: 'checkbox', 'data-fk': `s-${key}`, checked: !!s[key], onchange: (e: Event) => this.set({ [key]: (e.target as HTMLInputElement).checked } as Partial<Settings>) });
    const rng = (key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string) => { const out = h('output', {}, fmt(s[key] as number)); return h('div', { class: 'range' }, h('input', { type: 'range', min, max, step, value: s[key], 'aria-label': key, oninput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); out.textContent = fmt(v); this.set({ [key]: v } as Partial<Settings>, false); } }), out); };
    const pct = (v: number) => `${Math.round(v * 100)}%`, qual = (['low', 'medium', 'high', 'ultra'] as Quality[]).map((q): [string, string] => [q, t(`quality.${q}`)]), cache = h('span', {}, t('settings.measuring')), about = h('small', {}, '');
    void window.cosmos.cacheSize().then((b) => { cache.textContent = `${num(b / 1048576, 3)} MB`; }); void window.cosmos.info().then((i) => { about.textContent = t('settings.version', { v: i.version, e: i.electron }); });
    return h('div', { class: 'scroll settings' },
      head('settings.general'), row(t('settings.language'), h('select', { 'data-fk': 's-lang', onchange: (e: Event) => void this.changeLanguage((e.target as HTMLSelectElement).value as Language) }, LANGUAGES.map(([l, name]) => h('option', { value: l, selected: s.language === l }, name)))), row(t('settings.education'), chk('educationMode')), row(t('settings.offline'), chk('offlineMode'), t('settings.offlineNote')),
      head('settings.graphics'), row(t('settings.quality'), sel('quality', qual)), row(t('settings.resolution'), sel('windowSize', [['auto', t('settings.auto')], ['1280x720', '1280 × 720'], ['1600x900', '1600 × 900'], ['1920x1080', '1920 × 1080']])), row(t('settings.renderScale'), rng('renderScale', 0.5, 1, 0.05, pct)), row(t('settings.autoRes'), chk('autoResolution'), t('settings.autoResNote')), row(t('settings.fps'), sel('fpsLimit', [['30', '30'], ['60', '60'], ['120', '120'], ['0', t('settings.unlimited')]], Number)), row(t('settings.texture'), sel('textureQuality', [['low', t('quality.low')], ['medium', t('quality.medium')], ['high', t('quality.high')]])),
      head('settings.post'), row(t('settings.bloom'), chk('bloom'), PROFILES[s.quality].bloom ? undefined : t('settings.bloomOff')), row(t('settings.aa'), chk('antialias')), row(t('settings.atmosphere'), chk('atmosphere')), row(t('settings.eclipse'), chk('eclipseShadows'), t('settings.eclipseNote')), row(t('settings.skyEffects'), chk('skyEffects'), t('settings.skyEffectsNote')), row(t('settings.asteroids'), chk('asteroids'), t('settings.asteroidsNote')),
      head('settings.sound'), row(t('settings.soundOn'), chk('soundEnabled')), row(t('settings.volume'), rng('volume', 0, 1, 0.05, pct)), row(t('settings.ambient'), chk('ambient')),
      head('settings.navigation'), row(t('settings.rotateSpeed'), rng('rotateSensitivity', 0.3, 2, 0.1, pct)), row(t('settings.zoomSpeed'), rng('zoomSensitivity', 0.3, 2, 0.1, pct)), row(t('settings.invertY'), chk('invertY')),
      head('settings.interface'), row(t('settings.uiScale'), rng('uiScale', 0.85, 1.4, 0.05, pct)), row(t('settings.perf'), chk('showPerf')),
      head('settings.accessibility'), row(t('settings.motion'), chk('reduceMotion')), row(t('settings.contrast'), chk('highContrast')), row(t('settings.largeText'), chk('largeText')),
      head('settings.storage'), row(t('settings.cache'), cache, t('settings.cacheNote')), h('div', { class: 'chips' }, h('button', { type: 'button', class: 'chip', onclick: async () => { await window.cosmos.clearCache(); this.toast(t('settings.cleared')); this.render(); } }, t('settings.clear')), h('button', { type: 'button', class: 'chip', onclick: () => void window.cosmos.openLogs() }, t('settings.logs'))), about);
  }
  private welcome() {
    const s = store.value;
    return h('div', { class: 'veil welcome' }, h('section', { class: 'sheet glass', role: 'dialog', 'aria-modal': 'true' }, h('h1', {}, 'COSMOS'), h('p', {}, t('welcome.text')), h('div', { class: 'seg wide', role: 'group', 'aria-label': t('settings.language') }, ...LANGUAGES.map(([l, name]) => h('button', { type: 'button', class: s.language === l ? 'on' : '', onclick: () => void this.changeLanguage(l) }, name))), h('p', { class: 'muted' }, t('welcome.note')), h('button', { type: 'button', class: 'solid big', onclick: () => this.set({ welcomed: true }) }, t('welcome.start'))));
  }
  private earthBar() {
    const e = this.earthState, ready = this.earth.ready && e.status === 'idle', coords = h('div', { class: 'coords' }, t('earth.hover')); this.coordsEl = coords;
    if (e.status === 'loading') return h('div', { class: 'earth-status glass' }, t('earth.loading'));
    if (e.status === 'error') return h('div', { class: 'earth-status glass warn' }, t('error.earth'));
    const flag = (label: string, val: boolean, fn: (v: boolean) => void, disabled = false, note?: string) => h('label', { class: 'check-row', title: note }, h('input', { type: 'checkbox', checked: val, disabled, onchange: (ev: Event) => fn((ev.target as HTMLInputElement).checked) }), label);
    const doSearch = async () => {
      const q = e.query.trim(); if (!q) return; e.results = 'busy'; this.render(); const r = await searchPlaces(q, language()); e.results = r; this.render();
    };
    let res: Child = null;
    if (e.results === 'busy') res = h('p', { class: 'muted' }, t('earth.searching')); else if (e.results === 'offline' || e.results === 'network') res = h('p', { class: 'warn' }, t(`earth.search_${e.results}`));
    else if (Array.isArray(e.results)) res = e.results.length ? h('div', { class: 'results' }, e.results.map((r) => h('button', { type: 'button', class: 'result', onclick: () => { this.earth.flyTo(r, store.value.reduceMotion); e.results = null; this.render(); } }, h('span', {}, r.name)))) : h('p', { class: 'muted' }, t('search.none'));
    const opt = (l: EarthLayer) => h('option', { value: l, selected: e.layer === l, }, t(`earth.layer_${l}`));
    return h('div', { class: 'earth-ui' }, h('aside', { class: 'earth-panel glass' }, h('h2', {}, t('nav.earth')),
      h('div', { class: 'inline-form' }, h('input', { type: 'text', placeholder: t('earth.search'), 'aria-label': t('earth.search'), value: e.query, 'data-fk': 'geo', oninput: (ev: Event) => { e.query = (ev.target as HTMLInputElement).value; }, onkeydown: (ev: KeyboardEvent) => { if (ev.key === 'Enter') void doSearch(); } }), h('button', { type: 'button', class: 'solid alt', onclick: () => void doSearch() }, t('action.search'))), res,
      h('label', { class: 'set' }, h('span', {}, t('earth.layer')), h('select', { disabled: !ready, onchange: (ev: Event) => void this.changeLayer((ev.target as HTMLSelectElement).value as EarthLayer) }, (['natural', 'bluemarble', 'osm'] as EarthLayer[]).map(opt))),
      !this.netOk && e.layer !== 'natural' && h('p', { class: 'cached' }, t('earth.cachedOnly')),
      flag(t('earth.terrain'), e.terrain, (v) => { e.terrain = v; this.earth.setTerrain(v); this.render(); }), flag(t('earth.lighting'), e.lighting, (v) => { e.lighting = v; this.earth.setLighting(v); this.render(); }), flag(t('earth.borders'), e.borders, (v) => { e.borders = v; this.earth.setBorders(v); }), flag(t('earth.cities'), e.labels, (v) => { e.labels = v; this.earth.setLabels(v); }),
      h('button', { type: 'button', class: 'chip', onclick: () => this.earth.flyHome(store.value.reduceMotion) }, t('earth.reset')), coords,
      h('p', { class: 'muted small' }, t('earth.limits')), h('p', { class: 'attrib' }, LAYER_CREDITS[e.layer], e.terrain && h('br'), e.terrain && TERRAIN_CREDIT, h('br'), t('earth.boundaries'))));
  }
}
