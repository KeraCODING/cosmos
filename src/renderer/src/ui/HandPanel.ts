import { CALIBRATION_STEPS, GESTURE_ACTIONS, GESTURE_IDS, type GestureId, type Pt } from '../hands/gestures';
import type { HandController } from '../hands/HandController';
import { HAND_BONES, makeHand } from '../hands/poses';
import { num, t } from '../i18n';
import { store, type ControlMode, type Settings } from '../settings/store';
import { h } from './dom';

export interface HandPanelContext { hands: HandController; setMode(m: ControlMode): void; enable(): void; disable(): void; set(p: Partial<Settings>, rerender?: boolean): void }
const SVG = 'http://www.w3.org/2000/svg';
function drawHands(group: SVGGElement, hands: Pt[][]) {
  for (const lm of hands) for (const b of HAND_BONES) { const l = document.createElementNS(SVG, 'polyline'); l.setAttribute('points', b.map((i) => `${(lm[i].x * 100).toFixed(1)},${(lm[i].y * 100).toFixed(1)}`).join(' ')); group.append(l); }
}
const A = { scale: 0.2, y: 0.72 };
const DEMOS: Record<GestureId, [Pt[][], Pt[][]]> = {
  openPalm: [[makeHand('open', { ...A, x: 0.36 })], [makeHand('open', { ...A, x: 0.62 })]],
  handMove: [[makeHand('victory', { ...A, x: 0.36, y: 0.78 })], [makeHand('victory', { ...A, x: 0.62, y: 0.66 })]],
  pinchZoom: [[makeHand('pinch', { ...A, x: 0.45, gap: 0.08 })], [makeHand('pinch', { ...A, x: 0.45, gap: 0.55 })]],
  pinchSelect: [[makeHand('pinchOpen', { ...A, x: 0.45 })], [makeHand('pinch', { ...A, x: 0.45 })]],
  dwellSelect: [[makeHand('point', { ...A, x: 0.42 })], [makeHand('point', { ...A, x: 0.42, scale: 0.21 })]],
  fist: [[makeHand('open', { ...A, x: 0.48 })], [makeHand('fist', { ...A, x: 0.48 })]],
  twoHandPinch: [[makeHand('pinch', { scale: 0.13, y: 0.65, x: 0.3 }), makeHand('pinch', { scale: 0.13, y: 0.65, x: 0.7, mirror: true })], [makeHand('pinch', { scale: 0.13, y: 0.65, x: 0.14 }), makeHand('pinch', { scale: 0.13, y: 0.65, x: 0.86, mirror: true })]],
  point: [[makeHand('point', { ...A, x: 0.42 })], [makeHand('point', { ...A, x: 0.42, angle: 0.3 })]],
  palmHold: [[makeHand('open', { ...A, x: 0.48 })], [makeHand('open', { ...A, x: 0.48, scale: 0.21 })]],
};
export function miniDemo(id: GestureId) { const s = demo(id); s.setAttribute('class', 'hand-demo mini'); s.setAttribute('viewBox', id === 'twoHandPinch' ? '4 28 92 52' : '22 26 58 58'); return s; }
function demo(id: GestureId) {
  const s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 100 100'); s.setAttribute('class', 'hand-demo'); s.setAttribute('role', 'img'); s.setAttribute('aria-label', t(`hand.g.${id}.name`));
  DEMOS[id].forEach((pose, i) => { const g = document.createElementNS(SVG, 'g'); g.setAttribute('class', `f${i + 1}`); drawHands(g, pose); s.append(g); }); return s;
}

export function buildHandPanel(c: HandPanelContext) {
  const s = store.value, H = c.hands, on = H.active, stat = (k: string) => { const b = h('b', {}, '–'); return [h('div', { class: 'row' }, h('span', {}, t(`hand.stat.${k}`)), b), b] as const; };
  const [r1, state] = stat('state'), [r2, count] = stat('hands'), [r3, pose] = stat('pose'), [r4, rate] = stat('rate'), [r5, infer] = stat('infer'), [r6, proc] = stat('processor');
  const chips = new Map(GESTURE_IDS.map((g) => [g, h('span', { class: 'g-chip' }, t(`hand.g.${g}.name`))]));
  const rng = (key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string) => { const out = h('output', {}, fmt(s[key] as number)); return h('div', { class: 'range' }, h('input', { type: 'range', min, max, step, value: s[key], 'aria-label': t(`hand.set.${key}`), oninput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); out.textContent = fmt(v); c.set({ [key]: v } as Partial<Settings>, false); } }), out); };
  const row = (k: keyof Settings, ctl: Node) => h('label', { class: 'set' }, h('span', {}, t(`hand.set.${k}`), h('small', {}, t(`hand.set.${k}Note`))), ctl), pct = (v: number) => `${Math.round(v * 100)}%`, ms = (v: number) => t('hand.ms', { v: Math.round(v) });
  const barFill = h('i'), stepText = h('p', { class: 'lead' }), calBox = h('div', { class: 'cal' }, stepText, h('div', { class: 'bar' }, barFill), h('button', { type: 'button', class: 'chip', onclick: () => H.cancelCalibration() }, t('hand.cal.cancel')));
  const devices = H.devices.length ? h('select', { 'aria-label': t('hand.camera'), onchange: (e: Event) => void H.switchCamera((e.target as HTMLSelectElement).value) }, H.devices.map((d, i) => h('option', { value: d.deviceId, selected: d.deviceId === s.cameraId }, d.label || t('hand.cameraN', { n: i + 1 })))) : null;
  const gesture = (id: GestureId) => { const g = s.gestureConfig[id], set = (p: Partial<typeof g>) => c.set({ gestureConfig: { ...s.gestureConfig, [id]: { ...g, ...p } } }), acts = GESTURE_ACTIONS[id];
    return h('div', { class: `g-card${g.enabled ? '' : ' off'}` }, demo(id), h('div', {}, h('b', {}, t(`hand.g.${id}.name`)), h('p', {}, t(`hand.g.${id}.how`)), acts.length > 1 && h('select', { 'aria-label': t('hand.action'), onchange: (e: Event) => set({ action: (e.target as HTMLSelectElement).value }) }, acts.map((a) => h('option', { value: a, selected: g.action === a }, t(`hand.a.${a}`))))), h('input', { type: 'checkbox', checked: g.enabled, 'aria-label': t(`hand.g.${id}.name`), onchange: (e: Event) => set({ enabled: (e.target as HTMLInputElement).checked }) })); };
  const node = h('div', { class: 'scroll hand-panel' },
    h('p', { class: 'privacy' }, t('hand.privacy')),
    h('h3', {}, t('hand.mode')), h('div', { class: 'seg wide', role: 'group', 'aria-label': t('hand.mode') }, (['mouse', 'hand', 'hybrid'] as ControlMode[]).map((m) => h('button', { type: 'button', class: s.controlMode === m ? 'on' : '', 'aria-pressed': String(s.controlMode === m), onclick: () => c.setMode(m) }, t(`hand.m.${m}`)))), h('p', { class: 'muted small' }, t(`hand.m.${s.controlMode}Note`)),
    h('h3', {}, t('hand.camera')), h('div', { class: 'inline-form' }, h('button', { type: 'button', class: on ? 'solid danger' : 'solid', onclick: () => (on ? c.disable() : c.enable()) }, on ? t('hand.off') : t('hand.on')), devices),
    on ? h('div', { class: 'preview' }, H.video, H.overlay) : h('p', { class: 'muted' }, t('hand.noPreview')),
    on && h('p', { class: 'muted small' }, t('hand.previewNote')), h('div', { class: 'table' }, r1, r2, r3, r4, r5, r6), h('div', { class: 'chips' }, [...chips.values()]),
    h('h3', {}, t('hand.cal.title')), H.calibrator ? calBox : h('div', {}, h('p', { class: 'muted small' }, s.calibration ? t('hand.cal.saved') : t('hand.cal.none')), h('div', { class: 'chips' }, h('button', { type: 'button', class: 'chip', disabled: !on, onclick: () => H.startCalibration() }, t('hand.cal.start')), s.calibration && h('button', { type: 'button', class: 'chip', onclick: () => c.set({ calibration: null }) }, t('hand.cal.reset')))),
    h('h3', {}, t('hand.sensitivity')), row('handMove', rng('handMove', 0.3, 2.5, 0.1, pct)), row('handZoom', rng('handZoom', 0.3, 2.5, 0.1, pct)), row('handSmooth', rng('handSmooth', 0, 1, 0.05, pct)), row('handConfirm', rng('handConfirm', 50, 300, 10, ms)), row('handDetect', rng('handDetect', 0.3, 0.9, 0.05, pct)), row('handTrack', rng('handTrack', 0.3, 0.9, 0.05, pct)),
    h('h3', {}, t('hand.gestures')), h('p', { class: 'muted small' }, t('hand.gesturesNote')), GESTURE_IDS.map(gesture));
  const update = () => {
    const o = H.last; state.textContent = t(`hand.state.${H.state}`); count.textContent = o ? String(o.hands) : '0'; pose.textContent = t(`hand.pose.${o?.pose ?? 'none'}`); rate.textContent = on ? t('hand.perSec', { v: H.rate }) : '–'; infer.textContent = on && H.inferMs ? ms(H.inferMs) : '–'; proc.textContent = H.delegate && on ? t(`hand.proc.${H.delegate}`) : '–';
    chips.forEach((el, g) => el.classList.toggle('on', o?.active === g));
    const cal = H.calibrator; if (cal?.step) { stepText.textContent = t('hand.cal.step', { n: CALIBRATION_STEPS.indexOf(cal.step) + 1, text: t(`hand.cal.${cal.step}`) }); barFill.style.width = `${num(cal.progress * 100, 3).replace(',', '.')}%`; }
  };
  return { node, update };
}
