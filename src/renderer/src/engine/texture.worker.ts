// Builds the artistic planet surfaces off the main thread. Sampling 3D noise on the sphere avoids seams and polar pinching.
type RGB = [number, number, number];
const fract = (x: number) => x - Math.floor(x);
const hash = (x: number, y: number, z: number, s: number) => fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.19) * 43758.5453);
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function noise(x: number, y: number, z: number, s: number) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), u = smooth(x - X), v = smooth(y - Y), w = smooth(z - Z);
  const c = (a: number, b: number, d: number) => hash(X + a, Y + b, Z + d, s);
  return lerp(lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v), lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function fbm(x: number, y: number, z: number, s: number, oct: number) {
  let sum = 0, amp = 0.5, tot = 0;
  for (let i = 0; i < oct; i++) { sum += noise(x, y, z, s + i) * amp; tot += amp; amp *= 0.5; x *= 2.03; y *= 2.03; z *= 2.03; }
  return sum / tot;
}
const mix3 = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
function ramp(stops: RGB[], t: number): RGB {
  const p = clamp01(t) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(p));
  return mix3(stops[i], stops[i + 1], p - i);
}
const STYLES: Record<string, { seed: number; shade: (x: number, y: number, z: number, lat: number, s: number) => RGB }> = {
  mercury: { seed: 3, shade: (x, y, z, _l, s) => { const n = fbm(x * 4, y * 4, z * 4, s, 6), c = Math.abs(fbm(x * 11, y * 11, z * 11, s + 9, 3) - 0.5) * 2; return ramp([[70, 66, 62], [122, 115, 108], [168, 160, 150]], n * 0.85 + c * 0.25); } },
  venus: { seed: 5, shade: (x, y, z, lat, s) => { const w = fbm(x * 2, y * 5, z * 2, s, 4), n = fbm(x * 2.5 + w * 2, y * 7 + Math.abs(lat) * 2, z * 2.5 - w * 2, s + 4, 5); return ramp([[190, 160, 118], [222, 198, 156], [243, 230, 200]], n); } },
  mars: { seed: 7, shade: (x, y, z, lat, s) => {
    const n = fbm(x * 2.6, y * 2.6, z * 2.6, s, 6), d = fbm(x * 8, y * 8, z * 8, s + 3, 4);
    const base = ramp([[82, 45, 32], [153, 84, 52], [196, 122, 80], [214, 158, 118]], n * 0.8 + d * 0.25);
    const cap = Math.abs(lat) + (n - 0.5) * 0.09; return mix3(base, [236, 232, 226], clamp01((cap - (lat > 0 ? 1.33 : 1.37)) * 28));
  } },
  jupiter: { seed: 11, shade: (x, y, z, lat, s) => {
    const w = fbm(x * 4, y * 14, z * 4, s, 5) - 0.5, l = lat + w * 0.09, b = 0.5 + 0.3 * Math.sin(l * 9.2 + 0.5) + 0.14 * Math.sin(l * 21 + 1.3) + 0.08 * Math.sin(l * 47), f = fbm(x * 9, y * 42, z * 9, s + 2, 5);
    return mix3(ramp([[166, 124, 94], [196, 162, 130], [222, 203, 178], [234, 224, 206]], b + (f - 0.5) * 0.35), [132, 108, 92], Math.max(0, Math.abs(lat) - 1.0) * 0.9);
  } },
  saturn: { seed: 13, shade: (x, y, z, lat, s) => { const w = fbm(x * 2, y * 8, z * 2, s, 3) - 0.5, b = Math.sin(lat * 17 + w) * 0.5 + 0.5; return ramp([[176, 150, 108], [208, 186, 144], [230, 214, 176]], b * 0.8 + fbm(x * 3, y * 30, z * 3, s + 1, 3) * 0.2); } },
  uranus: { seed: 17, shade: (x, y, z, lat, s) => ramp([[150, 202, 208], [176, 222, 226], [198, 234, 234]], 0.5 + Math.sin(lat * 3) * 0.26 + (fbm(x * 2, y * 12, z * 2, s, 3) - 0.5) * 0.12) },
  neptune: { seed: 19, shade: (x, y, z, lat, s) => { const n = fbm(x * 3, y * 11, z * 3, s, 4), c = fbm(x * 5, y * 22, z * 5, s + 5, 3); return mix3(ramp([[38, 70, 150], [58, 100, 186], [84, 134, 210]], 0.5 + Math.sin(lat * 6) * 0.2 + (n - 0.5) * 0.7), [214, 226, 240], clamp01((c - 0.68) * 3.2)); } },
};

const rocky = (seed: number, stops: RGB[], f = 5): (typeof STYLES)[string] => ({ seed, shade: (x, y, z, _l, s) => { const n = fbm(x * f, y * f, z * f, s, 5), c = Math.abs(fbm(x * f * 3, y * f * 3, z * f * 3, s + 9, 3) - 0.5) * 2; return ramp(stops, n * 0.85 + c * 0.25); } });
const GREY: RGB[] = [[74, 70, 66], [120, 114, 108], [164, 158, 150]], ICE: RGB[] = [[136, 138, 142], [190, 192, 196], [232, 234, 238]], DARK: RGB[] = [[52, 50, 50], [84, 82, 82], [118, 116, 116]];
const MOON_STYLES: typeof STYLES = {
  phobos: rocky(23, [[58, 50, 44], [92, 80, 70], [122, 108, 94]], 7), deimos: rocky(29, [[78, 68, 58], [108, 96, 84], [136, 122, 108]], 4), callisto: rocky(31, DARK.map((c) => [c[0] + 18, c[1] + 12, c[2] + 6] as RGB), 8), ganymede: rocky(37, [[78, 72, 66], [132, 122, 110], [190, 184, 176]], 4), mimas: rocky(41, ICE, 7), tethys: rocky(43, ICE, 4), dione: rocky(47, ICE, 5), rhea: rocky(53, ICE, 6), enceladus: rocky(59, [[206, 216, 224], [232, 238, 244], [252, 253, 255]], 4), miranda: rocky(61, GREY, 9), ariel: rocky(67, ICE.map((c) => [c[0] - 22, c[1] - 24, c[2] - 26] as RGB), 5), umbriel: rocky(71, DARK, 6), titania: rocky(73, GREY.map((c) => [c[0] + 14, c[1] + 10, c[2] + 8] as RGB), 5), oberon: rocky(79, GREY, 7),
  io: { seed: 83, shade: (x, y, z, _l, s) => { const n = fbm(x * 4, y * 4, z * 4, s, 5), v = fbm(x * 13, y * 13, z * 13, s + 4, 3); return mix3(ramp([[172, 118, 44], [222, 182, 74], [242, 226, 142]], n), [46, 30, 24], clamp01((v - 0.67) * 11)); } },
  europa: { seed: 89, shade: (x, y, z, _l, s) => { const w = fbm(x * 3, y * 3, z * 3, s, 3), a = 1 - Math.min(1, Math.abs(fbm(x * 5 + w, y * 5, z * 5 - w, s + 2, 4) - 0.5) * 34), b = 1 - Math.min(1, Math.abs(fbm(x * 9 - w, y * 9, z * 9, s + 6, 3) - 0.5) * 42); return mix3(ramp([[196, 182, 160], [226, 216, 200], [244, 240, 232]], w), [132, 78, 54], Math.max(a, b * 0.7) * 0.72); } },
  titan: { seed: 97, shade: (x, y, z, lat, s) => ramp([[176, 112, 42], [208, 146, 62], [226, 174, 88]], fbm(x * 2, y * 5, z * 2, s, 3) * 0.7 + (Math.sin(lat * 2) + 1) * 0.15) },
  iapetus: { seed: 101, shade: (x, y, z, _l, s) => { const n = fbm(x * 6, y * 6, z * 6, s, 4), bright = clamp01((z + (n - 0.5) * 0.7) * 3 + 0.5); return mix3(ramp([[42, 32, 26], [72, 56, 44]], n), ramp([[176, 172, 164], [226, 224, 218]], n), bright); } },
  triton: { seed: 103, shade: (x, y, z, lat, s) => mix3(ramp([[166, 142, 132], [198, 178, 168], [222, 206, 198]], fbm(x * 6, y * 6, z * 6, s, 4)), [238, 226, 222], clamp01((-lat - 0.15) * 2)) },
};
Object.assign(STYLES, MOON_STYLES);

self.onmessage = (e: MessageEvent<{ id: string; width: number }>) => {
  const { id, width } = e.data, style = STYLES[id], height = width >> 1, out = new Uint8ClampedArray(width * height * 4);
  if (style) for (let j = 0; j < height; j++) {
    const lat = (0.5 - (j + 0.5) / height) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < width; i++) {
      const lon = ((i + 0.5) / width) * 2 * Math.PI, c = style.shade(cl * Math.cos(lon), sl, cl * Math.sin(lon), lat, style.seed), k = (j * width + i) * 4;
      out[k] = c[0]; out[k + 1] = c[1]; out[k + 2] = c[2]; out[k + 3] = 255;
    }
  }
  (self as unknown as Worker).postMessage({ id, width, height, data: out.buffer }, [out.buffer]);
};
