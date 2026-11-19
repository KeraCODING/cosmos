export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Camera distance along a transition. Interpolates in log space and, for long journeys, rises in the
 * middle so that the move reads as leaving one place and arriving at another instead of a jump.
 */
export function transitionDistance(from: number, to: number, separation: number, t: number) {
  const e = easeInOut(t);
  const base = Math.log(from) + (Math.log(to) - Math.log(from)) * e;
  const lift = Math.max(0, Math.log(Math.max(separation, 1e-9) / Math.max(from, to)));
  return Math.exp(base + Math.sin(Math.PI * t) * 0.55 * lift);
}
