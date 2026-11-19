// Artistic sky effects: shooting stars across the sky and meteors burning up in Earth's atmosphere.
// They are labelled as artistic in the interface and are not observations or predictions.
import * as THREE from 'three';

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec2 aCorner; attribute vec3 aFrom, aTo, aColor; attribute vec4 aState; uniform vec2 uRes; varying vec3 vColor; varying vec2 vC;
vec3 at(float t){
  vec3 p = mix(aFrom, aTo, t);
  #ifdef SKY
  p = normalize(p);
  #endif
  return p;
}
vec4 clip(vec3 p){
  #ifdef SKY
  return projectionMatrix * vec4(mat3(viewMatrix) * p, 1.0);
  #else
  return projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  #endif
}
void main(){
  float s = aCorner.x; vC = aCorner; vColor = aColor * aState.w;
  vec4 head = clip(at(aState.x)), tail = clip(at(max(0.0, aState.x - aState.y)));
  if (head.w <= 0.0 || tail.w <= 0.0 || aState.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 a = tail.xy / tail.w, b = head.xy / head.w, d = (b - a) * uRes; float l = length(d); vec2 n = l > 1e-4 ? vec2(-d.y, d.x) / l : vec2(0.0, 1.0);
  vec4 p = mix(tail, head, s); p.xy += n * aCorner.y * aState.z * (0.2 + 0.8 * s) * (0.35 + 0.65 * smoothstep(1.0, 0.9, s)) * 2.0 / uRes * p.w; gl_Position = p;
  #ifdef SKY
  gl_Position.z = gl_Position.w * 0.99999;
  #else
  #include <logdepthbuf_vertex>
  #endif
}`;
const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vColor; varying vec2 vC;
void main(){
  #ifndef SKY
  #include <logdepthbuf_fragment>
  #endif
  float s = clamp(vC.x, 0.0, 1.0), across = clamp(1.0 - vC.y * vC.y, 0.0, 1.0), along = pow(s, 2.4) * smoothstep(1.0, 0.94, s); // multisampling can sample just outside the quad
  gl_FragColor = vec4(min(vColor * across * across * along, vec3(12.0)), 1.0);
}`;

interface Streak { life: number; age: number; from: THREE.Vector3; to: THREE.Vector3; length: number; width: number; color: THREE.Color; gain: number }
class StreakLayer {
  mesh: THREE.Mesh; items: (Streak | null)[]; private from: Float32Array; private to: Float32Array; private state: Float32Array; private color: Float32Array; private geo = new THREE.InstancedBufferGeometry(); res = { value: new THREE.Vector2(1, 1) };
  constructor(private capacity: number, sky: boolean) {
    this.items = Array(capacity).fill(null); this.from = new Float32Array(capacity * 3); this.to = new Float32Array(capacity * 3); this.state = new Float32Array(capacity * 4); this.color = new Float32Array(capacity * 3);
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3)); this.geo.setAttribute('aCorner', new THREE.Float32BufferAttribute([0, -1, 1, -1, 1, 1, 0, 1], 2)); this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    const attr = (name: string, a: Float32Array, n: number) => { const b = new THREE.InstancedBufferAttribute(a, n); b.setUsage(THREE.DynamicDrawUsage); this.geo.setAttribute(name, b); };
    attr('aFrom', this.from, 3); attr('aTo', this.to, 3); attr('aState', this.state, 4); attr('aColor', this.color, 3); this.geo.instanceCount = capacity;
    this.mesh = new THREE.Mesh(this.geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, defines: sky ? { SKY: 1 } : {}, uniforms: { uRes: this.res }, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = sky ? -8 : 3;
  }
  add(s: Streak) { const i = this.items.indexOf(null); if (i >= 0) this.items[i] = s; }
  get active() { return this.items.filter(Boolean).length; }
  clear() { this.items.fill(null); this.state.fill(0); (this.geo.getAttribute('aState') as THREE.BufferAttribute).needsUpdate = true; }
  update(dt: number) {
    this.items.forEach((s, i) => {
      const k = i * 4; if (!s) { this.state[k + 3] = 0; return; } s.age += dt; const t = s.age / s.life;
      if (t >= 1) { this.items[i] = null; this.state[k + 3] = 0; return; }
      s.from.toArray(this.from, i * 3); s.to.toArray(this.to, i * 3); this.state[k] = t; this.state[k + 1] = s.length; this.state[k + 2] = s.width; this.state[k + 3] = Math.sin(Math.PI * Math.min(1, t * 1.08)) * s.gain; s.color.toArray(this.color, i * 3);
    });
    for (const n of ['aFrom', 'aTo', 'aState', 'aColor']) (this.geo.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = (c: THREE.Camera, x: number, y: number) => new THREE.Vector3(x, y, 0.5).unproject(c).sub(c.position).normalize();

export class SkyEffects {
  private sky = new StreakLayer(56, true); private earth = new StreakLayer(30, false); private nextSky = 0.2; private nextEarth = 0.3; private nextShower = 4; private shower: { radiant: THREE.Vector3; left: number; wait: number } | null = null; enabled = true; rate = 1;
  constructor(scene: THREE.Scene) { scene.add(this.sky.mesh, this.earth.mesh); }
  get active() { return this.sky.active + this.earth.active; }
  configure(enabled: boolean, rate: number) { this.enabled = enabled; this.rate = rate; if (!enabled) { this.sky.clear(); this.earth.clear(); } this.sky.mesh.visible = enabled; this.earth.mesh.visible = enabled; }
  /** With a radiant, streaks fly outward from one point, as meteor showers appear to. */
  private spawnSky(c: THREE.PerspectiveCamera, radiant?: THREE.Vector3) {
    const from = radiant ? radiant.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(0.28)).normalize() : pick(c, rand(-0.95, 0.95), rand(-0.3, 1)), e = c.matrixWorld.elements, right = new THREE.Vector3(e[0], e[1], e[2]), up = new THREE.Vector3(e[4], e[5], e[6]), fire = Math.random() < 0.16, span = rand(0.2, 0.42) * (fire ? 1.35 : 1);
    const to = (radiant ? from.clone().addScaledVector(from.clone().sub(radiant).normalize(), span * 1.25) : from.clone().addScaledVector(up, -span).addScaledVector(right, rand(-0.65, 0.65) * span)).normalize(), tint = fire ? (Math.random() < 0.35 ? new THREE.Color(0.65, 1, 0.75) : new THREE.Color(1, 0.72, 0.42)) : new THREE.Color(0.86, 0.92, 1);
    this.sky.add({ life: rand(0.65, 1.2) * (fire ? 1.35 : 1), age: 0, from, to, length: rand(0.45, 0.65), width: fire ? 3.2 : rand(1.4, 1.9), color: tint, gain: fire ? 5 : 2.4 });
  }
  private spawnEarth(c: THREE.Camera, earth: THREE.Vector3) {
    const view = c.position.clone().sub(earth).normalize(), n = view.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(0.72)).normalize(), t = new THREE.Vector3().randomDirection().cross(n).normalize();
    this.earth.add({ life: rand(0.45, 0.9), age: 0, from: n.clone().multiplyScalar(1.05).addScaledVector(t, -0.11), to: n.clone().multiplyScalar(1.004).addScaledVector(t, 0.11), length: 0.62, width: rand(1.5, 2.6), color: new THREE.Color(1, rand(0.7, 0.92), rand(0.45, 0.75)), gain: rand(4, 7) });
  }
  update(dt: number, cam: THREE.PerspectiveCamera, width: number, height: number, earthPos: THREE.Vector3, earthRadius: number, earthPx: number) {
    if (!this.enabled) return;
    this.sky.res.value.set(width, height); this.earth.res.value.set(width, height); this.earth.mesh.position.copy(earthPos); this.earth.mesh.scale.setScalar(earthRadius); this.earth.mesh.updateMatrixWorld();
    this.nextSky -= dt; if (this.nextSky <= 0) { this.spawnSky(cam); this.nextSky = rand(0.12, 0.6) / this.rate; }
    this.nextShower -= dt; if (this.nextShower <= 0) { this.shower = { radiant: pick(cam, rand(-0.55, 0.55), rand(-0.1, 0.7)), left: Math.round(rand(10, 20) * this.rate), wait: 0 }; this.nextShower = rand(9, 18); }
    if (this.shower) { this.shower.wait -= dt; if (this.shower.wait <= 0) { this.spawnSky(cam, this.shower.radiant); this.shower.wait = rand(0.04, 0.14); if (--this.shower.left <= 0) this.shower = null; } }
    this.nextEarth -= dt; if (earthPx > 70 && this.nextEarth <= 0) { this.spawnEarth(cam, earthPos); this.nextEarth = rand(0.07, 0.26) / this.rate; }
    this.sky.update(dt); this.earth.update(dt);
  }
}
