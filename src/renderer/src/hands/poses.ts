import type { Pt } from './gestures';
export type DemoPose = 'open' | 'fist' | 'point' | 'victory' | 'pinch' | 'pinchOpen';
export interface PoseOptions { x?: number; y?: number; scale?: number; angle?: number; mirror?: boolean; gap?: number }
const CURLS: Record<DemoPose, number[]> = { open: [0, 0, 0, 0], fist: [1, 1, 1, 1], point: [0, 1, 1, 1], victory: [0, 0, 1, 1], pinch: [0.42, 0.1, 0.1, 0.1], pinchOpen: [0.2, 0.1, 0.1, 0.1] };
const BASES: [number, number, number][] = [[0.33, 0.95, 0.16], [0.1, 1, 0.04], [-0.12, 0.93, -0.07], [-0.32, 0.82, -0.2]];

/** A geometric hand in MediaPipe's 21-point order. Used for gesture tests and the on-screen demonstrations. */
export function makeHand(pose: DemoPose, o: PoseOptions = {}): Pt[] {
  const { x = 0.5, y = 0.6, scale = 0.16, angle = 0, mirror = false, gap = 0.08 } = o, p: Pt[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  BASES.forEach(([bx, by, spread], n) => {
    const c = CURLS[pose][n], base = 5 + n * 4; let q = { x: bx, y: by, z: 0 }, th = 0; p[base] = q;
    [0.45, 0.28, 0.22].forEach((len, j) => { th += c * [1.55, 1.75, 1.2][j]; const d = { x: spread * Math.cos(th), y: Math.cos(th), z: -Math.sin(th) }, l = Math.hypot(d.x, d.y, d.z); q = { x: q.x + (d.x / l) * len, y: q.y + (d.y / l) * len, z: q.z + (d.z / l) * len }; p[base + 1 + j] = q; });
  });
  const curled = pose === 'fist' || pose === 'point' || pose === 'victory';
  ([[0.27, 0.2], curled ? [0.42, 0.42] : [0.55, 0.42], curled ? [0.34, 0.66] : [0.8, 0.62], curled ? [0.16, 0.8] : [1, 0.8]] as number[][]).forEach(([a, b], i) => { p[1 + i] = { x: a, y: b, z: curled ? -0.15 * i : 0 }; });
  if (pose === 'pinch' || pose === 'pinchOpen') {
    const t = p[8], g = pose === 'pinch' ? gap : 0.75; p[4] = { x: t.x + g * 0.8, y: t.y - g * 0.6, z: t.z }; p[3] = { x: (p[2].x + p[4].x) / 2 + 0.08, y: (p[2].y + p[4].y) / 2, z: p[4].z / 2 };
  }
  const cos = Math.cos(angle), sin = Math.sin(angle), m = mirror ? -1 : 1;
  return p.map((q) => { const qx = q.x * m, qy = -q.y; return { x: x + (qx * cos - qy * sin) * scale, y: y + (qx * sin + qy * cos) * scale, z: q.z * scale }; });
}
export const HAND_BONES = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [0, 17, 18, 19, 20], [5, 9, 13, 17]];
