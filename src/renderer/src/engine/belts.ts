// Real numbered asteroids, Jupiter Trojans and trans-Neptunian objects, moved along their orbits on the GPU.
import * as THREE from 'three';
import { meanMotionDeg, orbitBasis, SMALL_BODY_REF_MS } from '../astro/smallBodies';
import { AU_KM } from '../astro/ephemeris';
import { EDU_DISTANCE, KM_PER_UNIT, type ScaleMode } from './scale';

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aP, aQ; attribute vec4 aEl; attribute vec2 aLook; uniform float uDays, uEdu, uAu, uPixel; varying vec3 vColor;
void main(){
  float e = aEl.y, M = aEl.z + aEl.w * uDays, E = M + e * sin(M);
  for (int i = 0; i < 4; i++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
  float x = aEl.x * (cos(E) - e), y = aEl.x * sqrt(1.0 - e * e) * sin(E), r = aEl.x * (1.0 - e * cos(E));
  vec3 p = aP * x + aQ * y; p *= uEdu > 0.5 ? uAu * sqrt(r) / r : uAu;
  vec4 mv = modelViewMatrix * vec4(p.x, p.z, -p.y, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aLook.x * uPixel;
  vColor = aLook.y < 0.5 ? vec3(.25,.22,.19) : aLook.y < 1.5 ? vec3(.34,.26,.16) : vec3(.2,.27,.36);
  #include <logdepthbuf_vertex>
}`;
const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
void main(){
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord - .5; float a = smoothstep(.25, .05, dot(c, c)); gl_FragColor = vec4(vColor * a, 1.0);
}`;

export class AsteroidBelts {
  points?: THREE.Points; count = 0; private wanted = 1; private visible = true; private material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uDays: { value: 0 }, uEdu: { value: 1 }, uAu: { value: 46 }, uPixel: { value: 1 } } });
  ready: Promise<void>;
  constructor(private scene: THREE.Scene, private onError: (e: unknown) => void) { this.ready = this.load(); }
  private async load() {
    try {
      const res = await fetch('./data/small-bodies.bin'); if (!res.ok) throw new Error('HTTP ' + res.status); const d = new Float32Array(await res.arrayBuffer()), n = d.length / 8, order = Array.from({ length: n }, (_, i) => i), rad = Math.PI / 180;
      // A fixed shuffle means lower quality settings still show every region.
      for (let i = n - 1, seed = 12345; i > 0; i--) { seed = (seed * 16807) % 2147483647; const j = seed % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
      const P = new Float32Array(n * 3), Q = new Float32Array(n * 3), el = new Float32Array(n * 4), look = new Float32Array(n * 2);
      order.forEach((src, k) => { const o = src * 8, b = orbitBasis(d[o + 2], d[o + 3], d[o + 4]); P.set(b.P, k * 3); Q.set(b.Q, k * 3); el.set([d[o], d[o + 1], d[o + 5] * rad, meanMotionDeg(d[o]) * rad], k * 4); look.set([Math.max(1.1, Math.min(2.5, 3.3 - d[o + 6] * 0.22)), d[o + 7]], k * 2); });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('aP', new THREE.BufferAttribute(P, 3)); g.setAttribute('aQ', new THREE.BufferAttribute(Q, 3)); g.setAttribute('aEl', new THREE.BufferAttribute(el, 4)); g.setAttribute('aLook', new THREE.BufferAttribute(look, 2));
      this.points = new THREE.Points(g, this.material); this.points.frustumCulled = false; this.points.renderOrder = 1; this.count = n; this.scene.add(this.points); this.apply();
    } catch (e) { this.onError(e); }
  }
  private apply() { if (!this.points) return; this.points.visible = this.visible; this.points.geometry.setDrawRange(0, Math.round(this.count * this.wanted)); }
  configure(visible: boolean, fraction: number) { this.visible = visible; this.wanted = fraction; this.apply(); }
  update(time: number, mode: ScaleMode, origin: THREE.Vector3, pixelRatio: number) {
    if (!this.points) return; const u = this.material.uniforms; u.uDays.value = (time - SMALL_BODY_REF_MS) / 86400000; u.uEdu.value = mode === 'educational' ? 1 : 0; u.uAu.value = mode === 'educational' ? EDU_DISTANCE : AU_KM / KM_PER_UNIT; u.uPixel.value = pixelRatio; this.points.position.copy(origin);
  }
}
