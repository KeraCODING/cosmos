// Draws the application icon: a dark disc, a lit planet limb and a thin orange orbit.
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import pngToIco from 'png-to-ico';

const S = 512;
const png = new PNG({ width: S, height: S });
const clamp = (v) => Math.max(0, Math.min(1, v));
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1, r = Math.hypot(u, v);
  let c = [0.02, 0.025, 0.04], a = clamp((0.98 - r) * S / 2);
  const pr = Math.hypot(u, v) / 0.5;
  if (pr < 1) {
    const z = Math.sqrt(1 - pr * pr), nx = u / 0.5, ny = v / 0.5;
    const l = clamp(nx * -0.62 + ny * -0.5 + z * 0.6);
    c = [0.07 + 0.95 * l ** 1.3, 0.07 + 0.62 * l ** 1.5, 0.09 + 0.36 * l ** 2];
  }
  const ca = Math.cos(-0.45), sa = Math.sin(-0.45), ox = u * ca - v * sa, oy = (u * sa + v * ca) / 0.3;
  const d = Math.abs(Math.hypot(ox, oy) - 0.8) * 0.3;
  const front = oy > 0 || pr >= 1;
  if (front) { const k = clamp(1 - d / 0.012); c = c.map((b, i) => b + ([1, 0.56, 0.2][i] - b) * k); }
  const i = (y * S + x) * 4;
  png.data[i] = clamp(c[0]) * 255; png.data[i + 1] = clamp(c[1]) * 255; png.data[i + 2] = clamp(c[2]) * 255; png.data[i + 3] = a * 255;
}
mkdirSync('build', { recursive: true });
const buf = PNG.sync.write(png);
writeFileSync('build/icon.png', buf);
writeFileSync('build/icon.ico', await pngToIco('build/icon.png'));
console.log('icon written');
