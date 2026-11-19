import { defaultGestures, GESTURE_ACTIONS, GESTURE_IDS, type Calibration, type GestureConfig } from '../hands/gestures';

export type ControlMode = 'mouse' | 'hand' | 'hybrid';
export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export interface Bookmark { id: string; name: string; focus: string; time: number; az: number; pol: number; dist: number; scale: 'true' | 'educational' }
export interface Collection { id: string; name: string; items: string[] }
export interface Settings {
  language: 'az' | 'en' | 'ru'; welcomed: boolean; autoResolution: boolean;
  quality: Quality; renderScale: number; windowSize: string; fpsLimit: number; textureQuality: 'low' | 'medium' | 'high';
  skyEffects: boolean; asteroids: boolean; bloom: boolean; antialias: boolean; atmosphere: boolean; eclipseShadows: boolean;
  soundEnabled: boolean; volume: number; ambient: boolean;
  rotateSensitivity: number; zoomSensitivity: number; invertY: boolean;
  uiScale: number; reduceMotion: boolean; highContrast: boolean; largeText: boolean;
  showPerf: boolean; showOrbits: boolean; showLabels: boolean; offlineMode: boolean; educationMode: boolean; explainLevel: 'beginner' | 'advanced';
  scale: 'true' | 'educational';
  controlMode: ControlMode; cameraId: string; handMove: number; handZoom: number; handDetect: number; handTrack: number; handConfirm: number; handSmooth: number; gestureConfig: GestureConfig; calibration: Calibration | null;
  favorites: string[]; recents: string[]; bookmarks: Bookmark[]; collections: Collection[];
}
export const DEFAULTS: Settings = {
  language: 'az', welcomed: false, autoResolution: true,
  quality: 'high', renderScale: 1, windowSize: 'auto', fpsLimit: 60, textureQuality: 'high',
  skyEffects: true, asteroids: true, bloom: true, antialias: true, atmosphere: true, eclipseShadows: true,
  soundEnabled: true, volume: 0.4, ambient: false,
  rotateSensitivity: 1, zoomSensitivity: 1, invertY: false,
  uiScale: 1, reduceMotion: false, highContrast: false, largeText: false,
  showPerf: false, showOrbits: true, showLabels: true, offlineMode: false, educationMode: true, explainLevel: 'beginner',
  scale: 'educational',
  controlMode: 'mouse', cameraId: '', handMove: 1, handZoom: 1, handDetect: 0.5, handTrack: 0.5, handConfirm: 110, handSmooth: 0.5, gestureConfig: defaultGestures(), calibration: null,
  favorites: [], recents: [], bookmarks: [], collections: [],
};
export interface QualityProfile { pixelRatio: number; segments: number; msaa: number; atmosphereSteps: number; bloom: boolean; orbitPoints: number; stars: number }
export const PROFILES: Record<Quality, QualityProfile> = {
  low: { pixelRatio: 0.75, segments: 48, msaa: 0, atmosphereSteps: 5, bloom: false, orbitPoints: 120, stars: 6.5 },
  medium: { pixelRatio: 1, segments: 72, msaa: 2, atmosphereSteps: 8, bloom: true, orbitPoints: 180, stars: 7.8 },
  high: { pixelRatio: 1, segments: 128, msaa: 4, atmosphereSteps: 12, bloom: true, orbitPoints: 260, stars: 9.5 },
  ultra: { pixelRatio: 1.5, segments: 192, msaa: 8, atmosphereSteps: 18, bloom: true, orbitPoints: 360, stars: 13 },
};

/** Keeps only known keys of the right type so an old or damaged settings file cannot break the app. */
export function mergeSettings(saved: unknown): Settings {
  const out: Settings = structuredClone(DEFAULTS);
  if (!saved || typeof saved !== 'object') return out;
  const target = out as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(saved)) {
    if (!(k in target)) continue;
    const d = target[k];
    if (Array.isArray(d) ? Array.isArray(v) : typeof d === typeof v) target[k] = v;
  }
  if (!['az', 'en', 'ru'].includes(out.language)) out.language = 'az';
  if (!(out.quality in PROFILES)) out.quality = 'high';
  out.controlMode = 'mouse'; // the camera is never started automatically on launch
  const saved2 = (saved as { gestureConfig?: Record<string, { enabled?: unknown; action?: unknown }> }).gestureConfig; out.gestureConfig = defaultGestures();
  for (const g of GESTURE_IDS) { const v = saved2?.[g]; if (v && typeof v === 'object') { if (typeof v.enabled === 'boolean') out.gestureConfig[g].enabled = v.enabled; if (GESTURE_ACTIONS[g].includes(v.action as string)) out.gestureConfig[g].action = v.action as string; } }
  const c = out.calibration; if (c && !['cx', 'cy', 'rx', 'ry', 'pinchIn', 'pinchOut', 'zoomExit', 'deadzone'].every((k) => Number.isFinite((c as unknown as Record<string, number>)[k]))) out.calibration = null;
  return out;
}

type Listener = (s: Settings, changed: (keyof Settings)[]) => void;
class Store {
  value: Settings = structuredClone(DEFAULTS);
  private listeners = new Set<Listener>();
  private timer?: ReturnType<typeof setTimeout>;
  async load() { this.value = mergeSettings(await window.cosmos.loadSettings()); }
  subscribe(l: Listener) { this.listeners.add(l); return () => this.listeners.delete(l); }
  set(patch: Partial<Settings>) {
    const changed = (Object.keys(patch) as (keyof Settings)[]).filter((k) => this.value[k] !== patch[k]);
    if (!changed.length) return;
    Object.assign(this.value, patch);
    this.listeners.forEach((l) => l(this.value, changed));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void window.cosmos.saveSettings(this.value), 250);
  }
}
export const store = new Store();
