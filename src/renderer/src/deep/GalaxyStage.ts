// Milky Way and nearby galaxies. Positions and distances are catalogue data; the particle structure is an artistic model.
import * as THREE from 'three';
import data from '../data/generated/galaxies.json';
import type { Stage, StageHost } from '../engine/stage';
import { transitionDistance, easeInOut } from '../engine/transition';

export type DeepKind = 'spiral' | 'elliptical' | 'irregular' | 'lenticular' | 'blackhole';
export interface DeepObject { id: string; kind: DeepKind; radius: number; distanceKpc: number; pos: THREE.Vector3; measurements: number }
export const DEEP_SOURCE = { name: data.source, url: data.url, retrieved: data.retrieved };
export const SUN_KPC = 8.178;
const A = [[-0.0548755604, -0.873437090, -0.4838350155], [0.4941094279, -0.4448296300, 0.7469822445], [-0.8676661490, -0.1980763734, 0.4559837762]];
/** Galactic position, kpc, with the Galactic centre at the origin and the Sun on the negative x axis. */
export function galacticPosition(raDeg: number, decDeg: number, kpc: number): [number, number, number] {
  const r = Math.PI / 180, e = [Math.cos(decDeg * r) * Math.cos(raDeg * r), Math.cos(decDeg * r) * Math.sin(raDeg * r), Math.sin(decDeg * r)], g = A.map((m) => m[0] * e[0] + m[1] * e[1] + m[2] * e[2]);
  return [-SUN_KPC + g[0] * kpc, g[1] * kpc, 0.02 + g[2] * kpc];
}
const toScene = (p: [number, number, number]) => new THREE.Vector3(p[0], p[2], -p[1]);
export const DEEP_OBJECTS: DeepObject[] = [
  { id: 'milkyway', kind: 'spiral', radius: 15, distanceKpc: 0, pos: new THREE.Vector3(), measurements: 0 },
  ...data.objects.map((o) => ({ id: o.id, kind: o.kind as DeepKind, radius: o.visualRadiusKpc, distanceKpc: o.distanceKpc, measurements: o.measurements, pos: o.id === 'sgra' ? new THREE.Vector3() : toScene(galacticPosition(o.ra, o.dec, o.distanceKpc)) })),
];

const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function build(n: number, fill: (add: (r: number, th: number, y: number, c: number[], s: number) => void, R: () => number, G: () => number) => void) {
  const polar = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n); let i = 0;
  const add = (r: number, th: number, y: number, c: number[], s: number) => { if (i >= n) return; polar.set([r, th, y], i * 3); col.set(c, i * 3); size[i++] = s; };
  const R = rng(n * 7 + 11), G = () => Math.sqrt(-2 * Math.log(R() || 1e-6)) * Math.cos(6.2832 * R()); fill(add, R, G);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('aPolar', new THREE.BufferAttribute(polar, 3)); g.setAttribute('aColor', new THREE.BufferAttribute(col, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); g.setDrawRange(0, i); return g;
}
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const BLUE = [0.5, 0.68, 1.15], WHITE = [1, 0.95, 0.88], GOLD = [1.2, 0.8, 0.46], PINK = [1.5, 0.36, 0.56], VIOLET = [0.62, 0.42, 1.1];
function spiral(n: number, arms: number, pitch: number) {
  return build(n, (add, R, G) => {
    const tan = Math.tan(pitch);
    for (let i = 0; i < n; i++) {
      const k = R();
      if (k < 0.13) { const r = Math.abs(G()) * 0.1; add(r, R() * 6.2832, G() * 0.06 * Math.exp(-r * 4), mix(GOLD, WHITE, R() * 0.5).map((c) => c * 0.55), 0.012 + R() * 0.012); }
      else if (k < 0.76) {
        const t = Math.pow(R(), 0.62), r = 0.07 + t * 0.93, arm = Math.floor(R() * arms), off = G() * (0.2 + 0.25 * (1 - t)), young = Math.exp(-off * off * 8), hii = R() < 0.018, c = hii ? PINK : R() < 0.05 ? VIOLET : mix(WHITE, BLUE, young * (0.45 + R() * 0.5));
        add(r * (1 + G() * 0.035), (arm / arms) * 6.2832 + Math.log(r / 0.07) / tan + off, G() * 0.016, c.map((v) => v * (hii ? 0.85 : 0.42 + young * 0.35)), hii ? 0.03 + R() * 0.035 : 0.005 + R() * 0.011);
      } else { const r = Math.min(1.05, -Math.log(R() || 1e-6) * 0.27); add(r, R() * 6.2832, G() * 0.026, mix(WHITE, GOLD, R()).map((v) => v * 0.2), 0.006 + R() * 0.008); }
    }
  });
}
const elliptical = (n: number) => build(n, (add, R, G) => { for (let i = 0; i < n; i++) { const r = Math.pow(R(), 2.4), th = R() * 6.2832, u = R() * 2 - 1, s = Math.sqrt(1 - u * u); add(r * s, th, r * u * 0.72 + G() * 0.004, mix(GOLD, WHITE, R() * 0.45).map((c) => c * 0.34), 0.012 + R() * 0.018); } });
function irregular(n: number) { return build(n, (add, R, G) => { const blobs = Array.from({ length: 9 }, () => [Math.sqrt(R()) * 0.72, R() * 6.2832, 0.1 + R() * 0.22]); for (let i = 0; i < n; i++) { const b = blobs[Math.floor(R() * 9)], ax = b[0] * Math.cos(b[1]) + G() * b[2], az = b[0] * Math.sin(b[1]) + G() * b[2], hii = R() < 0.05; add(Math.hypot(ax, az), Math.atan2(az, ax), G() * 0.09, (hii ? PINK : mix(BLUE, WHITE, R())).map((c) => c * 0.42), hii ? 0.04 : 0.009 + R() * 0.012); } }); }
function lenticular(n: number) { return build(n, (add, R, G) => { for (let i = 0; i < n; i++) { if (R() < 0.45) { const r = Math.pow(R(), 2) * 0.55, u = R() * 2 - 1; add(r * Math.sqrt(1 - u * u), R() * 6.2832, r * u * 0.72, GOLD.map((c) => c * 0.4), 0.012 + R() * 0.016); } else add(0.45 + Math.abs(G()) * 0.26, R() * 6.2832, G() * 0.012, WHITE.map((c) => c * 0.26), 0.006 + R() * 0.008); } }); }
function dust(n: number, arms: number, pitch: number) { return build(n, (add, R, G) => { const tan = Math.tan(pitch); for (let i = 0; i < n; i++) { const t = Math.pow(R(), 0.7), r = 0.1 + t * 0.82; add(r, (Math.floor(R() * arms) / arms) * 6.2832 + Math.log(r / 0.07) / tan - 0.22 + G() * 0.1, G() * 0.006, [1, 1, 1], 0.03 + R() * 0.05); } }); }

const VERT = /* glsl */ `attribute vec3 aPolar, aColor; attribute float aSize; uniform float uT, uScale, uK, uMax, uGain; varying vec3 vC;
void main(){ float w = .9 / (.3 + aPolar.x), th = aPolar.y - uT * w; vec4 mv = modelViewMatrix * vec4(aPolar.x * cos(th), aPolar.z, aPolar.x * sin(th), 1.); gl_Position = projectionMatrix * mv; float s = aSize * uScale * uK / max(.0001, -mv.z); gl_PointSize = clamp(s, 1., uMax); vC = aColor * uGain * min(1., s * s + .16); }`;
const FRAG = `varying vec3 vC; void main(){ vec2 c = gl_PointCoord - .5; float a = exp(-dot(c,c) * 14.); gl_FragColor = vec4(vC * a, 1.); }`;
const DUST_FRAG = `varying vec3 vC; void main(){ vec2 c = gl_PointCoord - .5; float a = exp(-dot(c,c) * 10.) * .34; gl_FragColor = vec4(vec3(1. - a * min(1., vC.r)), 1.); }`;
const SKY_VERT = `attribute vec3 aColor; attribute float aSize; uniform float uPx; varying vec3 vC; void main(){ vC = aColor; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.); gl_Position = p.xyww; gl_PointSize = aSize * uPx; }`;
const glow = (() => { let t: THREE.Texture | null = null; return () => { if (t) return t; const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!, r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.16, 'rgba(255,255,255,.45)'); r.addColorStop(0.45, 'rgba(255,255,255,.08)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); return (t = new THREE.CanvasTexture(c)); }; })();

interface Node { o: DeepObject; group: THREE.Group; sprite: THREE.Sprite; points: THREE.Object3D[]; mats: THREE.ShaderMaterial[]; label: HTMLButtonElement }
export interface GalaxyEvents { select(id: string | null): void; focus(id: string): void; sun(): void; name(id: string): string }

export class GalaxyStage implements Stage {
  scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(50, 1, 0.001, 2e6); bloom = { strength: 0.2, radius: 0.5, threshold: 1.05 }; allowPan = true;
  private root = new THREE.Group(); private nodes: Node[] = []; private labels = document.createElement('div'); private sunLabel = document.createElement('button'); private sunDot: THREE.Sprite; private time = 0; private k = 900; private field: THREE.ShaderMaterial; private hole = new THREE.Group();
  focus = 'milkyway'; private point = new THREE.Vector3(); private tr?: { t: number; from: THREE.Vector3; d0: number; d1: number; sep: number; a0: number; a1: number; p0: number; p1: number }; private hoverId: string | null = null;
  constructor(labelRoot: HTMLElement, private ev: GalaxyEvents, quality: number) {
    this.labels.className = 'deep-labels'; labelRoot.append(this.labels); this.scene.add(this.root);
    const n = Math.round(240000 * quality), t = Math.round(46000 * quality), tmpl = { milky: spiral(n, 4, 0.23), spiral: spiral(t, 2, 0.3), elliptical: elliptical(t), irregular: irregular(Math.round(t * 0.6)), lenticular: lenticular(t), milkyDust: dust(Math.round(9000 * quality), 4, 0.23), dust: dust(Math.round(2600 * quality), 2, 0.3) };
    for (const o of DEEP_OBJECTS) {
      const group = new THREE.Group(); group.position.copy(o.pos); const hash = [...o.id].reduce((s, c) => s * 31 + c.charCodeAt(0), 7); group.rotation.set(o.id === 'milkyway' ? 0 : ((hash % 100) / 100 - 0.5) * 2.2, (hash % 628) / 100, o.id === 'milkyway' ? 0 : (((hash >> 3) % 100) / 100 - 0.5) * 1.5);
      const color = o.kind === 'elliptical' || o.kind === 'lenticular' ? 0xffc48a : o.kind === 'irregular' ? 0xa8c6ff : o.kind === 'blackhole' ? 0xffb066 : 0xd8dfff, sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true })); sprite.position.copy(o.pos); this.root.add(sprite);
      const points: THREE.Object3D[] = [], mats: THREE.ShaderMaterial[] = [], add = (g: THREE.BufferGeometry, isDust = false) => { const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: isDust ? DUST_FRAG : FRAG, transparent: true, depthWrite: false, depthTest: false, premultipliedAlpha: isDust, blending: isDust ? THREE.MultiplyBlending : THREE.AdditiveBlending, uniforms: { uT: { value: 0 }, uScale: { value: o.radius }, uK: { value: 900 }, uMax: { value: 46 }, uGain: { value: o.id === 'milkyway' ? 0.8 : 1 } } }), p = new THREE.Points(g, m); m.userData = { dust: isDust, count: g.drawRange.count }; p.frustumCulled = false; p.renderOrder = isDust ? 2 : 1; p.scale.setScalar(o.radius); group.add(p); points.push(p); mats.push(m); };
      if (o.id === 'milkyway') { add(tmpl.milky); add(tmpl.milkyDust, true); } else if (o.kind === 'spiral') { add(tmpl.spiral); add(tmpl.dust, true); } else if (o.kind !== 'blackhole') add(tmpl[o.kind]);
      this.root.add(group);
      const label = document.createElement('button'); label.className = 'body-label deep'; label.type = 'button'; label.dataset.deep = o.id; label.innerHTML = '<i></i><span></span>'; label.addEventListener('click', (e) => { e.stopPropagation(); ev.select(o.id); }); label.addEventListener('dblclick', (e) => { e.stopPropagation(); ev.focus(o.id); }); this.labels.append(label);
      this.nodes.push({ o, group, sprite, points, mats, label });
    }
    this.buildHole();
    this.sunDot = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: 0xffd9a0, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true })); this.sunDot.position.copy(toScene([-SUN_KPC, 0, 0.02])); this.root.add(this.sunDot);
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 180 }, (_, i) => new THREE.Vector3(Math.cos(i / 28.65) * SUN_KPC, 0, Math.sin(i / 28.65) * SUN_KPC))), new THREE.LineBasicMaterial({ color: 0xe08a4c, transparent: true, opacity: 0.34, depthTest: false })); this.root.add(ring);
    this.sunLabel.className = 'body-label deep sun-here'; this.sunLabel.type = 'button'; this.sunLabel.innerHTML = '<i></i><span></span>'; this.sunLabel.addEventListener('click', (e) => { e.stopPropagation(); ev.sun(); }); this.labels.append(this.sunLabel);
    const R = rng(99), m = 5200, pos = new Float32Array(m * 3), col = new Float32Array(m * 3), size = new Float32Array(m);
    for (let i = 0; i < m; i++) { const u = R() * 2 - 1, a = R() * 6.2832, s = Math.sqrt(1 - u * u), w = R(), b = 0.05 + Math.pow(R(), 3) * 0.5; pos.set([s * Math.cos(a), u, s * Math.sin(a)], i * 3); col.set(mix([0.7, 0.8, 1], [1, 0.72, 0.55], w).map((c) => c * b), i * 3); size[i] = 1 + R() * 1.7; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aColor', new THREE.BufferAttribute(col, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); this.field = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: `varying vec3 vC; void main(){ vec2 c = gl_PointCoord - .5; gl_FragColor = vec4(vC * exp(-dot(c,c) * 16.), 1.); }`, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, uniforms: { uPx: { value: 1 } } }); const f = new THREE.Points(g, this.field); f.frustumCulled = false; f.renderOrder = -5; this.scene.add(f);
    this.refreshNames();
  }
  private buildHole() {
    const disc = new THREE.Mesh(new THREE.RingGeometry(1.5, 6.2, 160, 1), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uT: { value: 0 } }, vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`, fragmentShader: `varying vec2 vP; uniform float uT; void main(){ float r = length(vP), a = atan(vP.y, vP.x), s = .55 + .45 * sin(a * 5. + r * 5. - uT * 2.2 / r) * sin(a * 11. - r * 3. - uT * 1.4 / r), f = smoothstep(1.5, 1.9, r) * (1. - smoothstep(3.6, 6.2, r)), d = 1. + .75 * cos(a); gl_FragColor = vec4(vec3(1.25, .52, .16) * f * d * d * (.42 + .58 * s) / (r * .55), 1.); }` })); disc.rotation.x = -1.28; disc.renderOrder = 3; this.hole.add(disc);
    const black = new THREE.Mesh(new THREE.SphereGeometry(1.25, 48, 24), new THREE.MeshBasicMaterial({ color: 0, depthTest: false, transparent: true })); black.renderOrder = 4; this.hole.add(black);
    const halo = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.42, 128), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.1, 1.05, .42), depthTest: false, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); halo.renderOrder = 5; this.hole.add(halo); (this.hole as THREE.Group & { halo?: THREE.Mesh }).halo = halo; this.hole.scale.setScalar(0.0022); this.hole.visible = false; this.root.add(this.hole);
  }
  refreshNames() { for (const n of this.nodes) { n.label.querySelector('span')!.textContent = this.ev.name(n.o.id); n.label.setAttribute('aria-label', this.ev.name(n.o.id)); } this.sunLabel.querySelector('span')!.textContent = this.ev.name('sun'); }
  private node(id: string) { return this.nodes.find((n) => n.o.id === id)!; }
  private viewDist(o: DeepObject) { return o.kind === 'blackhole' ? 0.045 : o.id === 'milkyway' ? 34 : o.radius * 3.2; }
  enter(h: StageHost) { this.labels.hidden = false; h.az = 0.5; h.pol = 1.08; h.dist = 0.2; h.targetDist = 34; h.pan = [0, 0, 0]; this.focus = 'milkyway'; this.point.set(-SUN_KPC, 0.02, 0); this.tr = { t: 0, from: this.point.clone(), d0: 0.2, d1: 34, sep: SUN_KPC, a0: 0.5, a1: 0.75, p0: 1.45, p1: 1.08 }; }
  exit() { this.labels.hidden = true; }
  flyTo(id: string, h: StageHost) { const n = this.node(id), d = this.viewDist(n.o); this.focus = id; this.tr = { t: 0, from: this.point.clone(), d0: h.dist, d1: d, sep: this.point.distanceTo(n.o.pos), a0: h.az, a1: h.az + 0.55, p0: h.pol, p1: 1.16 }; h.targetDist = d; }
  bounds(): [number, number] { const o = this.node(this.focus).o; return [o.kind === 'blackhole' ? 0.009 : o.radius * 0.18, 90000]; }
  pick(x: number, y: number, reach: number) { let best: string | null = null, gap = reach; for (const n of this.nodes) { const s = this.screen(n.o.pos); if (!s) continue; const d = Math.hypot(s.x - x, s.y - y); if (d < gap) { gap = d; best = n.o.id; } } return best; }
  hover(id: string | null) { if (id === this.hoverId) return; this.hoverId = id; for (const n of this.nodes) n.label.classList.toggle('hover', n.o.id === id); }
  click(id: string | null) { this.ev.select(id); }
  doubleClick(id: string | null) { if (id) this.ev.focus(id); }
  select(id: string | null) { for (const n of this.nodes) n.label.classList.toggle('selected', n.o.id === id); }
  private w = 1; private h = 1; private tmp = new THREE.Vector3();
  private screen(world: THREE.Vector3) { const p = this.tmp.copy(world).add(this.root.position).project(this.camera); return p.z > 1 ? null : { x: ((p.x + 1) / 2) * this.w, y: ((1 - p.y) / 2) * this.h }; }
  update(dt: number, h: StageHost) {
    if (!h.paused && !h.settings.reduceMotion) this.time += dt * 0.05; this.w = h.width; this.h = h.height; this.k = h.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360)) * h.pixelRatio;
    const target = this.node(this.focus).o.pos;
    if (this.tr) { const t = this.tr; t.t = Math.min(1, t.t + dt / (h.settings.reduceMotion ? 0.01 : 3.2)); const e = easeInOut(t.t); this.point.copy(t.from).lerp(target, e); h.dist = transitionDistance(t.d0, t.d1, t.sep, t.t); h.az = t.a0 + (t.a1 - t.a0) * e; h.pol = t.p0 + (t.p1 - t.p0) * e; if (t.t >= 1) this.tr = undefined; }
    else { this.point.copy(target); h.dist = Math.exp(Math.log(h.dist) + (Math.log(h.targetDist) - Math.log(h.dist)) * (1 - Math.exp(-dt * 8))); }
    const c = this.camera, s = Math.sin(h.pol); c.position.set(h.dist * s * Math.sin(h.az), h.dist * Math.cos(h.pol), h.dist * s * Math.cos(h.az)); c.lookAt(0, 0, 0); c.near = Math.max(1e-5, h.dist * 0.01); c.far = 4e5; c.updateProjectionMatrix(); c.updateMatrixWorld();
    this.root.position.set(-this.point.x - h.pan[0], -this.point.y - h.pan[1], -this.point.z - h.pan[2]); this.field.uniforms.uPx.value = h.pixelRatio;
    const pxK = h.height / (2 * Math.tan((c.fov * Math.PI) / 360)), placed: [number, number][] = [];
    for (const n of this.nodes) {
      const dc = Math.max(1e-6, this.tmp.copy(n.o.pos).add(this.root.position).distanceTo(c.position)), px = (n.o.radius / dc) * pxK, near = px > 14; n.points.forEach((p) => { p.visible = near; }); n.mats.forEach((m) => { m.uniforms.uT.value = this.time; m.uniforms.uK.value = this.k; // light adds up, so brightness follows how densely the stars land on screen
        if (!m.userData.dust) m.uniforms.uGain.value = THREE.MathUtils.clamp((0.15 * px * px) / m.userData.count, 0.018, 0.3); }); const size = Math.max(n.o.radius * (near ? 0.42 : 1.5), dc * 0.012); n.sprite.scale.setScalar(n.o.kind === 'blackhole' ? Math.max(0.25, dc * 0.012) : size); n.sprite.material.opacity = n.o.kind === 'blackhole' ? 0.75 * Math.min(1, dc / 2) : near ? 0.1 : Math.min(0.85, 0.3 + px * 0.05);
      const q = this.screen(n.o.pos), show = !!q && q.x > -30 && q.x < h.width + 30 && q.y > -20 && q.y < h.height + 20 && !(n.o.id === 'milkyway' && this.point.length() < 1 && h.dist < 3) && (n.o.id === this.focus || !placed.some(([a, b]) => Math.hypot(a - q.x, b - q.y) < 46)); n.label.hidden = !show; if (show && q) { placed.push([q.x, q.y]); n.label.style.transform = `translate(${(q.x - 8.5).toFixed(1)}px, ${(q.y - 11).toFixed(1)}px)`; }
    }
    this.hole.visible = this.point.length() < 1 && h.dist < 3; if (this.hole.visible) { const mw = this.nodes[0], g = this.node('sgra'); mw.points.forEach((p) => { p.visible = h.dist > 0.9; }); mw.sprite.visible = false; g.sprite.visible = false; } else { this.nodes[0].sprite.visible = true; this.node('sgra').sprite.visible = true; } if (this.hole.visible) { (this.hole.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>).material.uniforms.uT.value = this.time * 20; this.hole.children[2].quaternion.copy(c.quaternion); this.hole.children[1].visible = true; }
    const sd = this.tmp.copy(this.sunDot.position).add(this.root.position).distanceTo(c.position); this.sunDot.scale.setScalar(sd * 0.022); const sq = this.screen(this.sunDot.position); this.sunLabel.hidden = !sq || sd > 300 || this.hole.visible; if (sq) this.sunLabel.style.transform = `translate(${(sq.x - 8.5).toFixed(1)}px, ${(sq.y - 11).toFixed(1)}px)`;
  }
}
