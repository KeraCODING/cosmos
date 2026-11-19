import type * as THREE from 'three';
import type { Settings } from '../settings/store';

/** Camera and input state shared by every 3D place in the app, so mouse, keyboard and gestures work the same everywhere. */
export interface StageHost { az: number; pol: number; dist: number; targetDist: number; pan: [number, number, number]; settings: Settings; width: number; height: number; pixelRatio: number; paused: boolean; pressed(code: string): boolean }
export interface Stage {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; bloom: { strength: number; radius: number; threshold: number }; allowPan: boolean;
  enter(host: StageHost): void; exit(): void; update(dt: number, host: StageHost): void; bounds(): [number, number];
  pick(x: number, y: number, reach: number): string | null; hover(id: string | null): void; click(id: string | null): void; doubleClick(id: string | null): void;
}
