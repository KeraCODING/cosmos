import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { AU_KM, bodyBasis, geoMoonEcliptic, helioEcliptic, orbitSamples, BODY_IDS, type BodyId, type V3 } from '../astro/ephemeris';
import { bodyById, CATALOG } from '../data/catalog';
import { satellite, satelliteOffsetKm, satellitesOf, SATELLITES } from '../astro/satellites';
import { PROFILES, type Settings } from '../settings/store';
import { homeDistance, maxDistance, sceneHelio, sceneMoonOffset, sceneRadius, sceneSatelliteOffset, toScene, type ScaleMode } from './scale';
import { transitionDistance, easeInOut } from './transition';
import { TextureManager } from './textures';
import { SkyEffects } from './effects';
import type { Stage, StageHost } from './stage';
import { AsteroidBelts } from './belts';
import { nextSpinTime } from '../sim/clock';
import { ATMO_VERT, atmoFrag, GLARE_FRAG, GLARE_VERT, RING_FRAG, RING_SHADE_GLSL, RING_VERT, SHADOW_GLSL, SKY_FRAG, SKY_VERT, STAR_FRAG, STAR_VERT, SUN_FRAG, SUN_VERT } from './shaders';

const BASE: Record<string, number> = { mercury: 0x8a8179, venus: 0xd9c49c, earth: 0x4a6b8f, moon: 0x8d8a85, mars: 0xa8603c, jupiter: 0xc6a584, saturn: 0xd2bb8e, uranus: 0xaedcdf, neptune: 0x4b76c0, phobos: 0x6d5f53, deimos: 0x83735f, io: 0xd8b458, europa: 0xd8cdb8, ganymede: 0x8d8377, callisto: 0x6f665c, mimas: 0xbfc0c3, enceladus: 0xeef2f6, tethys: 0xcfd1d5, dione: 0xc7c9cd, rhea: 0xbfc0c4, titan: 0xcf9140, iapetus: 0x8a8378, miranda: 0x8f8a84, ariel: 0xa9a9ab, umbriel: 0x5c5a5a, titania: 0x97908a, oberon: 0x827c76, triton: 0xc8b5ac };
const ATMOSPHERES: Record<string, { beta: V3; mie: number; hR: number; hM: number; gain: number }> = {
  earth: { beta: [37, 86, 211], mie: 134, hR: 0.00133, hM: 0.00019, gain: 5.5 },
  venus: { beta: [46, 40, 26], mie: 18, hR: 0.0026, hM: 0.0012, gain: 4 },
  titan: { beta: [20, 12, 4], mie: 7, hR: 0.016, hM: 0.01, gain: 2.6 },
  mars: { beta: [5.2, 3.3, 1.8], mie: 3.5, hR: 0.0033, hM: 0.0016, gain: 7 },
};
/** Polar flattening of the drawn shape. */
const FLATTENING: Record<string, number> = { earth: 0.00335, mars: 0.00589, jupiter: 0.06487, saturn: 0.09796, uranus: 0.02293, neptune: 0.01708 };
interface BodyNode {
  id: BodyId; radius: number; world: V3; group: THREE.Group; mesh: THREE.Mesh; material?: THREE.MeshStandardMaterial;
  atmosphere?: THREE.Mesh; ring?: THREE.Mesh; orbit?: THREE.Line; orbitBuiltAt: number; hasTexture: boolean; requested: boolean;
  shadow: { uSunPos: { value: THREE.Vector3 }; uSunRadius: { value: number }; uOccluders: { value: THREE.Vector4[] }; uOccluderCount: { value: number }; uRingN: { value: THREE.Vector3 }; uRingC: { value: THREE.Vector3 }; uRingR: { value: number } };
}
export interface CameraPose { focus: BodyId; az: number; pol: number; dist: number }
export interface ViewEvents { onSelect(id: BodyId | null): void; onFocus(id: BodyId): void; onContextLost(): void; onTextureError(id: string): void; onLeaveSystem(): void }

const v = new THREE.Vector3(), v2 = new THREE.Vector3();
const clampPol = (p: number) => Math.max(0.02, Math.min(Math.PI - 0.02, p));
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class SpaceView {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(45, 1, 1e-6, 2e6);
  private composer!: EffectComposer; private bloom!: UnrealBloomPass; private renderPass!: RenderPass; stage: Stage | null = null; private savedOrbit?: { az: number; pol: number; dist: number; targetDist: number; pan: V3 }; ready: Promise<unknown> = Promise.resolve(); private uploads: (() => void)[] = []; private dynScale = 1; private slowFor = 0; private fastFor = 0; private lastLabels = 0; private labelText = new Map<string, string>();
  private textures = new TextureManager(); private nodes = new Map<BodyId, BodyNode>(); private geos: THREE.SphereGeometry[] = [];
  private sunLight = new THREE.PointLight(0xfff4e8, 2.5, 0, 0); private sky!: THREE.Mesh; private stars?: THREE.Points; private glare!: THREE.Mesh;
  private orbitRoot = new THREE.Group(); private labels = new Map<BodyId, HTMLButtonElement>();
  private keys = new Set<string>(); private pointer?: { id: number; x: number; y: number; button: number; moved: boolean };
  private settings: Settings; private last = 0; private lastDraw = 0; private frames = 0; private fpsAt = 0;
  private transition?: { t: number; dur: number; fromPoint: V3; fromDist: number; toDist: number; fromAz: number; toAz: number; fromPol: number; toPol: number; toPan: V3; fromPan: V3 };
  focus: BodyId = 'sun'; selected: BodyId | null = null; az = 0.7; pol = 1.12; dist = 420; targetDist = 420; pan: V3 = [0, 0, 0];
  scale: ScaleMode = 'educational'; fps = 0; running = true; simDate = new Date(); hover?: BodyId;
  private focusPoint: V3 = [0, 0, 0]; effects!: SkyEffects; belts!: AsteroidBelts; effectsPaused = false; private fxTime = 0; timeRate = 0; private spinTime = Date.now(); starCount = 0;
  get isOverview() { return this.focus === 'sun' && this.dist > this.nodes.get('sun')!.radius * 12; }

  constructor(private canvas: HTMLCanvasElement, private labelRoot: HTMLElement, settings: Settings, private events: ViewEvents, private labelName: (id: BodyId) => string) {
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1; this.renderer.info.autoReset = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.events.onContextLost(); });
    this.scene.add(this.sunLight, this.orbitRoot, new THREE.AmbientLight(0xffffff, 0.012));
    this.buildSky(); this.applySettings(settings, true); this.buildBodies(); this.bindInput(); this.home(true);
    this.starsReady = this.loadStars();
  }
  starsReady: Promise<void> = Promise.resolve();
  /** Everything worth doing before the first frame, so that exploring starts without stutter. */
  async prepare(step: (key: string) => void) {
    step('stars'); await this.starsReady; step('asteroids'); await this.belts.ready; step('textures'); await this.textures.get('earth').catch(() => null); step('shaders'); this.positionBodies(); this.nodes.forEach((n) => { n.group.position.set(0, 0, 0); }); await this.renderer.compileAsync(this.scene, this.camera).catch(() => null);
  }

  // ----- construction -----
  private buildSky() {
    this.effects = new SkyEffects(this.scene); this.belts = new AsteroidBelts(this.scene, (e) => window.cosmos.log('error', `asteroids: ${e}`));
    const tex = new THREE.TextureLoader().load('./textures/milkyway.jpg'); tex.wrapS = THREE.RepeatWrapping; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, transparent: true, blending: THREE.NoBlending, uniforms: { uMap: { value: tex }, uGain: { value: 1.9 } } }));
    this.sky.frustumCulled = false; this.sky.renderOrder = -10; this.scene.add(this.sky);
    this.glare = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: GLARE_VERT, fragmentShader: GLARE_FRAG, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, uniforms: { uSize: { value: 0.1 }, uGain: { value: 1 } } }));
    this.glare.frustumCulled = false; this.glare.renderOrder = 5; this.scene.add(this.glare);
  }
  /** Loads the brightest part of the full Hipparcos catalogue that the quality setting allows. */
  private async loadStars() {
    let d: Float32Array; try { const r = await fetch('./data/stars.bin'); if (!r.ok) throw new Error('HTTP ' + r.status); d = new Float32Array(await r.arrayBuffer()); } catch (e) { window.cosmos.log('error', `stars: ${e}`); return; }
    const limit = PROFILES[this.settings.quality].stars, rad = Math.PI / 180, E = 0.4090928; let n = 0; while (n * 4 < d.length && d[n * 4 + 2] <= limit) n++;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), phase = new Float32Array(n), spike = new Float32Array(n), c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const i = k * 4, V = d[i + 2], ra = d[i] * rad, de = d[i + 1] * rad, x = Math.cos(de) * Math.cos(ra), y = Math.cos(de) * Math.sin(ra), z = Math.sin(de), ey = y * Math.cos(E) + z * Math.sin(E), ez = -y * Math.sin(E) + z * Math.cos(E); pos.set([x, ez, -ey], k * 3);
      const flux = Math.pow(10, -0.4 * (V - 1)), b = Math.min(1, 0.085 + 0.75 * Math.sqrt(flux)), bv = Math.max(-0.4, Math.min(2, d[i + 3])), t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
      c.setRGB(t > 6600 ? Math.min(1, (t / 6600) ** -0.25) : 1, t > 6600 ? Math.min(1, (t / 6600) ** -0.12) : Math.min(1, Math.max(0.45, 0.39 * Math.log(t / 100) - 0.63)), t >= 6600 ? 1 : Math.max(0.2, Math.min(1, 0.54 * Math.log(t / 100 - 10) - 1.2)));
      col.set([c.r * b, c.g * b, c.b * b], k * 3); size[k] = Math.max(1.2, Math.min(4.4, 4.9 - V * 0.56)); phase[k] = (k * 2.399963) % 6.283; spike[k] = Math.max(0, Math.min(1, (2.4 - V) / 2.6));
    }
    const g = new THREE.BufferGeometry(), set = (name: string, a: Float32Array, s: number) => g.setAttribute(name, new THREE.BufferAttribute(a, s)); set('position', pos, 3); set('aSize', size, 1); set('aColor', col, 3); set('aPhase', phase, 1); set('aSpike', spike, 1);
    this.stars = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uScale: { value: this.renderer.getPixelRatio() }, uTime: { value: 0 }, uTwinkle: { value: 1 } } }));
    this.stars.frustumCulled = false; this.stars.renderOrder = -9; this.scene.add(this.stars); this.starCount = n;
  }
  private buildGeometries() {
    this.geos.forEach((g) => g.dispose());
    const s = PROFILES[this.settings.quality].segments; this.geos = [s, Math.round(s / 2), 20].map((n) => new THREE.SphereGeometry(1, n, Math.round(n / 2)));
    this.nodes.forEach((n) => { n.mesh.geometry = this.geos[0]; if (n.atmosphere) n.atmosphere.geometry = this.geos[1]; });
  }
  private patch(mat: THREE.MeshStandardMaterial, node: BodyNode) {
    mat.customProgramCacheKey = () => (node.id === 'earth' || node.id === 'saturn' ? node.id : 'planet');
    mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, node.shadow);
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;').replace('#include <project_vertex>', '#include <project_vertex>\nvWPos=(modelMatrix*vec4(transformed,1.)).xyz;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\n${SHADOW_GLSL}`)
        .replace('#include <opaque_fragment>', `outgoingLight *= eclipseLight(vWPos)${node.id === 'saturn' ? ' * ringShade(vWPos)' : ''};\n#include <opaque_fragment>`);
      if (node.id === 'saturn') s.fragmentShader = s.fragmentShader.replace('void main() {', `${RING_SHADE_GLSL}\nvoid main() {`);
      if (node.id === 'earth') s.fragmentShader = s.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(1.0, 0.62, smoothstep(0.02, 0.1, diffuseColor.b - diffuseColor.r));');
    };
  }
  private buildBodies() {
    this.buildGeometries();
    for (const id of BODY_IDS) {
      const rec = bodyById(id)!, group = new THREE.Group();
      const shadow = { uSunPos: { value: new THREE.Vector3() }, uSunRadius: { value: 1 }, uOccluders: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uOccluderCount: { value: 0 }, uRingN: { value: new THREE.Vector3(0, 1, 0) }, uRingC: { value: new THREE.Vector3() }, uRingR: { value: 1 } };
      let material: THREE.MeshStandardMaterial | undefined, mat: THREE.Material;
      const node = { id, radius: 1, world: [0, 0, 0], group, shadow, orbitBuiltAt: -Infinity, hasTexture: false, requested: false } as unknown as BodyNode;
      if (id === 'sun') mat = new THREE.ShaderMaterial({ vertexShader: SUN_VERT, fragmentShader: SUN_FRAG, uniforms: { uTime: { value: 0 }, uDetail: { value: 0 } } });
      else { material = new THREE.MeshStandardMaterial({ color: BASE[id], roughness: id === 'earth' ? 1 : 0.95, metalness: 0 }); this.patch(material, node); mat = material; }
      node.material = material; node.mesh = new THREE.Mesh(this.geos[0], mat); group.add(node.mesh);
      const a = ATMOSPHERES[id];
      if (a) {
        const top = 1 + a.hR * 7;
        node.atmosphere = new THREE.Mesh(this.geos[1], new THREE.ShaderMaterial({ vertexShader: ATMO_VERT, fragmentShader: atmoFrag(PROFILES[this.settings.quality].atmosphereSteps), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
          uniforms: { uCam: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3() }, uBetaR: { value: new THREE.Vector3(...a.beta) }, uBetaM: { value: a.mie }, uHR: { value: a.hR }, uHM: { value: a.hM }, uTop: { value: top }, uGain: { value: a.gain }, uSunPos: shadow.uSunPos, uSunRadius: shadow.uSunRadius, uOccluders: shadow.uOccluders, uOccluderCount: shadow.uOccluderCount } }));
        node.atmosphere.scale.setScalar(top); node.atmosphere.renderOrder = 2; node.mesh.add(node.atmosphere);
      }
      if (id === 'saturn') {
        const g = new THREE.RingGeometry(1.2387, 2.2695, 180, 1); g.rotateX(-Math.PI / 2);
        node.ring = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: RING_FRAG, side: THREE.DoubleSide, transparent: true, depthWrite: false, uniforms: { uSunPos: shadow.uSunPos, uSunRadius: shadow.uSunRadius, uOccluders: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uOccluderCount: { value: 1 } } }));
        node.ring.renderOrder = 1; node.mesh.add(node.ring);
      }
      this.scene.add(group); this.nodes.set(id, node);
      const b = document.createElement('button'); b.className = 'body-label'; b.type = 'button'; b.dataset.body = id; b.innerHTML = '<i></i><span></span>';
      b.addEventListener('click', (e) => { e.stopPropagation(); this.select(id); });
      b.addEventListener('dblclick', (e) => { e.stopPropagation(); this.events.onFocus(id); });
      this.labelRoot.append(b); this.labels.set(id, b);
    }
    this.refreshLabels(); this.rescale();
  }
  refreshLabels() { this.labels.forEach((b, id) => { b.querySelector('span')!.textContent = this.labelName(id); b.setAttribute('aria-label', this.labelName(id)); }); }
  private rescale() {
    for (const n of this.nodes.values()) {
      n.radius = sceneRadius(this.scale, n.id, bodyById(n.id)!.radiusKm); n.mesh.scale.set(n.radius, n.radius * (1 - (FLATTENING[n.id] ?? 0)), n.radius);
      n.orbitBuiltAt = -Infinity;
    }
    this.positionBodies();
  }

  // ----- settings -----
  applySettings(s: Settings, first = false) {
    const prev = this.settings; this.settings = s; const p = PROFILES[s.quality];
    this.textures.width = { low: 512, medium: 1024, high: 2048 }[s.textureQuality]; this.textures.capacity = { low: 3, medium: 5, high: 9 }[s.textureQuality];
    this.renderer.setPixelRatio(this.basePixelRatio());
    const need = first || prev.quality !== s.quality || prev.antialias !== s.antialias || (this as any).builtFor !== `${s.quality}${s.antialias}`;
    if (need) {
      (this as any).builtFor = `${s.quality}${s.antialias}`; this.buildComposer(s);
      if (!first) {
        this.buildGeometries(); this.rebuildAtmospheres(); this.nodes.forEach((n) => { n.orbitBuiltAt = -Infinity; });
        if (this.stars) { this.scene.remove(this.stars); this.stars.geometry.dispose(); (this.stars.material as THREE.Material).dispose(); this.stars = undefined; void this.loadStars(); }
      }
    }
    if (!first && s.textureQuality !== (this as any).texQ) this.reloadTextures();
    (this as any).texQ = s.textureQuality;
    this.effects.configure(s.skyEffects && !s.reduceMotion, { low: 0.45, medium: 0.75, high: 1, ultra: 1.25 }[s.quality]);
    this.belts.configure(s.asteroids, { low: 0.2, medium: 0.55, high: 1, ultra: 1 }[s.quality]);
    this.bloom.enabled = s.bloom && p.bloom; this.orbitRoot.visible = s.showOrbits; this.labelRoot.hidden = !s.showLabels;
    this.nodes.forEach((n) => { if (n.atmosphere) n.atmosphere.visible = s.atmosphere; });
    this.resize();
  }
  private reloadTextures() { this.textures.clear(); this.nodes.forEach((n) => { n.hasTexture = false; n.requested = false; if (n.material) { n.material.map = null; n.material.color.set(BASE[n.id]); n.material.needsUpdate = true; } }); }
  private rebuildAtmospheres() { this.nodes.forEach((n) => { if (n.atmosphere) { const m = n.atmosphere.material as THREE.ShaderMaterial; m.fragmentShader = atmoFrag(PROFILES[this.settings.quality].atmosphereSteps); m.needsUpdate = true; } }); }
  private buildComposer(s: Settings) {
    this.composer?.dispose();
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: s.antialias ? PROFILES[s.quality].msaa : 0 });
    this.composer = new EffectComposer(this.renderer, rt); this.renderPass = new RenderPass(this.stage?.scene ?? this.scene, this.stage?.camera ?? this.camera); this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.08, 0.3, 2.2); this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());
  }
  private basePixelRatio() { return Math.min(window.devicePixelRatio * PROFILES[this.settings.quality].pixelRatio * this.settings.renderScale, 2.5) * this.dynScale; }
  /** Lowers the internal resolution while the frame rate is short of the target, and restores it when there is room. */
  private adaptResolution(dt: number) {
    const s = this.settings; if (!s.autoResolution || this.fps <= 0) return; const goal = Math.min(s.fpsLimit || 60, 60) * 0.86;
    if (this.fps < goal) { this.slowFor += dt; this.fastFor = 0; } else if (this.fps > goal * 1.1) { this.fastFor += dt; this.slowFor = 0; } else { this.slowFor = 0; this.fastFor = 0; }
    if (this.slowFor > 2.5 && this.dynScale > 0.6) { this.dynScale = Math.max(0.6, this.dynScale - 0.1); this.slowFor = 0; this.renderer.setPixelRatio(this.basePixelRatio()); this.resize(); } else if (this.fastFor > 9 && this.dynScale < 1) { this.dynScale = Math.min(1, this.dynScale + 0.1); this.fastFor = 0; this.renderer.setPixelRatio(this.basePixelRatio()); this.resize(); }
  }
  get renderQuality() { return this.dynScale; }
  pressed(code: string) { return this.keys.has(code); }
  private host(): StageHost { const self = this; return { get az() { return self.az; }, set az(v) { self.az = v; }, get pol() { return self.pol; }, set pol(v) { self.pol = v; }, get dist() { return self.dist; }, set dist(v) { self.dist = v; }, get targetDist() { return self.targetDist; }, set targetDist(v) { self.targetDist = v; }, get pan() { return self.pan; }, set pan(v) { self.pan = v; }, settings: this.settings, width: this.canvas.clientWidth, height: this.canvas.clientHeight, pixelRatio: this.renderer.getPixelRatio(), paused: this.effectsPaused, pressed: (c) => this.keys.has(c) }; }
  get stageHost() { return this.host(); }
  /** Switches the 3D place while keeping one renderer, one camera input system and one post-processing chain. */
  setStage(s: Stage | null) {
    if (s === this.stage) return; this.stage?.exit(); if (s && !this.stage) this.savedOrbit = { az: this.az, pol: this.pol, dist: this.dist, targetDist: this.targetDist, pan: [...this.pan] };
    this.stage = s; this.transition = undefined; this.renderPass.scene = s?.scene ?? this.scene; this.renderPass.camera = s?.camera ?? this.camera; this.labelRoot.classList.toggle('staged', !!s); this.bloom.strength = s?.bloom.strength ?? 0.08; this.bloom.radius = s?.bloom.radius ?? 0.3; this.bloom.threshold = s?.bloom.threshold ?? 2.2;
    if (s) s.enter(this.host()); else if (this.savedOrbit) { Object.assign(this, this.savedOrbit); this.savedOrbit = undefined; } this.resize();
  }
  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false); this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h);
    for (const c of [this.camera, this.stage?.camera]) if (c) { c.aspect = w / h; c.updateProjectionMatrix(); }
  }

  // ----- navigation -----
  private minDist(id = this.focus) { return this.nodes.get(id)!.radius * 1.04; }
  private viewDist(id: BodyId) { return id === 'sun' ? this.nodes.get(id)!.radius * 4 : this.nodes.get(id)!.radius * (id === 'saturn' ? 8 : satellitesOf(id).length ? 6.5 : 3.4); }
  private startTransition(toDist: number, toAz = this.az, toPol = this.pol) {
    const reduce = this.settings.reduceMotion;
    this.transition = { t: 0, dur: reduce ? 0.001 : 2.4, fromPoint: [...this.focusPoint], fromDist: this.dist, toDist, fromAz: this.az, toAz, fromPol: this.pol, toPol, fromPan: [...this.pan], toPan: [0, 0, 0] };
  }
  /** Brings positions up to date immediately, so that a camera move planned after a date jump uses the new geometry. */
  syncTime(date: Date) { this.simDate = date; this.spinTime = date.getTime(); this.positionBodies(); }
  flyTo(id: BodyId, dist?: number) {
    this.focus = id; this.select(id, true); const n = this.nodes.get(id)!;
    // Arrive on the day side so a newly focused body is visible, unless the caller set a pose.
    const sun = new THREE.Vector3(-n.world[0], -n.world[1], -n.world[2]), az = sun.lengthSq() > 0 ? Math.atan2(sun.x, sun.z) + 0.95 : this.az;
    let delta = (az - this.az) % (Math.PI * 2); if (delta > Math.PI) delta -= Math.PI * 2; if (delta < -Math.PI) delta += Math.PI * 2;
    this.startTransition(dist ?? this.viewDist(id), this.az + delta, 1.25); this.targetDist = dist ?? this.viewDist(id);
  }
  setPose(p: CameraPose) { this.focus = p.focus; this.select(p.focus, true); this.startTransition(p.dist, p.az, p.pol); this.targetDist = p.dist; }
  get pose(): CameraPose { return { focus: this.focus, az: this.az, pol: this.pol, dist: this.targetDist }; }
  home(instant = false) {
    this.focus = 'sun'; this.select(null, true); const d = homeDistance(this.scale);
    if (instant) { this.dist = this.targetDist = d; this.pan = [0, 0, 0]; this.positionBodies(); this.focusPoint = this.nodes.get('sun')?.world ?? [0, 0, 0]; return; }
    this.startTransition(d, this.az, 1.12); this.targetDist = d;
  }
  select(id: BodyId | null, silent = false) {
    this.selected = id; this.labels.forEach((b, k) => b.classList.toggle('selected', k === id));
    this.nodes.forEach((n) => { if (n.orbit) (n.orbit.material as THREE.LineBasicMaterial).color.set(n.id === id ? 0xc9793a : 0x39414f); });
    if (!silent) this.events.onSelect(id);
  }
  setScale(mode: ScaleMode) {
    if (mode === this.scale) return;
    const ratio = this.dist / this.nodes.get(this.focus)!.radius; this.scale = mode; this.rescale(); this.focusPoint = [...this.nodes.get(this.focus)!.world]; this.pan = [0, 0, 0];
    const n = this.nodes.get(this.focus)!, d = this.focus === 'sun' && ratio > 30 ? homeDistance(mode) : Math.min(maxDistance(mode), Math.max(this.minDist(), n.radius * ratio));
    this.dist = this.targetDist = d; this.transition = undefined;
  }
  zoom(factor: number) {
    const [lo, hi] = this.stage ? this.stage.bounds() : [this.minDist(), maxDistance(this.scale)];
    if (!this.stage && factor > 1 && this.focus === 'sun' && this.targetDist >= hi * 0.999) { this.events.onLeaveSystem(); return; }
    this.targetDist = Math.max(lo, Math.min(hi, this.targetDist * factor));
    if (this.transition) this.transition.toDist = this.targetDist; // input during a flight adjusts it instead of cutting it short
  }
  private pick(x: number, y: number, reach = 14): BodyId | null {
    let best: BodyId | null = null, bestD = Infinity, bestGap = Infinity; const h = this.canvas.clientHeight, w = this.canvas.clientWidth, k = h / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    for (const n of this.nodes.values()) {
      v.setFromMatrixPosition(n.group.matrixWorld); const dc = v.distanceTo(this.camera.position); v.project(this.camera); if (v.z > 1) continue;
      const sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h, d = Math.hypot(sx - x, sy - y), disc = (n.radius / dc) * k, gap = Math.max(0, d - disc);
      // The object closest to the pointer on screen wins; among overlapping discs, the nearer one.
      if (d < Math.max(reach, disc) && (gap < bestGap - 1e-6 || (gap <= bestGap + 1e-6 && dc < bestD))) { bestGap = gap; bestD = dc; best = n.id; }
    }
    return best;
  }
  setKey(code: string, down: boolean) { if (down) this.keys.add(code); else this.keys.delete(code); }
  clearKeys() { this.keys.clear(); }
  private bindInput() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, button: e.button, moved: false }; });
    c.addEventListener('pointermove', (e) => {
      const p = this.pointer; if (!p || p.id !== e.pointerId) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; if (Math.abs(dx) + Math.abs(dy) > 2) p.moved = true; p.x = e.clientX; p.y = e.clientY;
      if (p.button === 0) {
        const s = 0.0042 * this.settings.rotateSensitivity, da = -dx * s, dp = -dy * s * (this.settings.invertY ? -1 : 1), t = this.transition;
        void t; this.rotateBy(da, dp);
      } else if (p.button === 2) this.panPixels(dx, dy);
    });
    const up = (e: PointerEvent) => { const p = this.pointer; if (!p || p.id !== e.pointerId) return; this.pointer = undefined; if (p.button === 0 && !p.moved) { const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; if (this.stage) this.stage.click(this.stage.pick(x, y, 18)); else this.select(this.pick(x, y)); } };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', () => { this.pointer = undefined; });
    c.addEventListener('dblclick', (e) => { const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; if (this.stage) { this.stage.doubleClick(this.stage.pick(x, y, 18)); return; } const id = this.pick(x, y); if (id) this.events.onFocus(id); });
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(Math.exp(Math.sign(e.deltaY) * Math.min(1, Math.abs(e.deltaY) / 100) * 0.16 * this.settings.zoomSensitivity)); }, { passive: false });
  }
  // Shared by mouse and hand input, so both drive exactly the same camera.
  rotateBy(da: number, dp: number) { const t = this.transition; if (t) { t.fromAz += da; t.toAz += da; t.fromPol = clampPol(t.fromPol + dp); t.toPol = clampPol(t.toPol + dp); } else { this.az += da; this.pol = clampPol(this.pol + dp); } }
  panPixels(dx: number, dy: number) { if (this.transition || (this.stage && !this.stage.allowPan)) return; const k = (2 * this.dist * Math.tan(((this.stage?.camera ?? this.camera).fov * Math.PI) / 360)) / this.canvas.clientHeight; this.movePan(-dx * k, dy * k, 0); }
  stopMotion() { this.targetDist = this.dist; if (this.transition) this.transition.toDist = this.dist; }
  pickAt(x: number, y: number, reach = 14): string | null { return this.stage ? this.stage.pick(x, y, reach) : this.pick(x, y, reach); }
  hoverAt(x: number, y: number, reach = 14) { if (this.stage) { this.stage.hover(this.stage.pick(x, y, reach)); return undefined; } this.setHover(this.pick(x, y, reach)); return this.hover; }
  setHover(id: BodyId | null) { if (this.stage) { this.stage.hover(id); return; } if ((this.hover ?? null) === id) return; this.hover = id ?? undefined; this.labels.forEach((b, k) => b.classList.toggle('hover', k === id)); this.nodes.forEach((n) => { if (n.orbit && n.id !== this.selected) (n.orbit.material as THREE.LineBasicMaterial).color.set(n.id === id ? 0x8a6a50 : 0x39414f); }); }
  private movePan(r: number, u: number, f: number) {
    const e = (this.stage?.camera ?? this.camera).matrixWorld.elements;
    for (let i = 0; i < 3; i++) this.pan[i] += e[i] * r + e[i + 4] * u - e[i + 8] * f;
  }

  // ----- per-frame -----
  private positionBodies() {
    const d = this.simDate;
    for (const id of BODY_IDS) {
      if (id === 'moon' || satellite(id) || !this.nodes.has(id)) continue;
      this.nodes.get(id)!.world = sceneHelio(this.scale, helioEcliptic(id, d));
    }
    const e = this.nodes.get('earth'), m = this.nodes.get('moon');
    if (e && m) { const o = sceneMoonOffset(this.scale, geoMoonEcliptic(d), e.radius); m.world = [e.world[0] + o[0], e.world[1] + o[1], e.world[2] + o[2]]; }
    // Moon phases follow the same limited rate as planet spin, so fast time does not turn them into flicker.
    const when = new Date(this.spinTime);
    for (const s of SATELLITES) { const n = this.nodes.get(s.id as BodyId), p = this.nodes.get(s.parent as BodyId); if (!n || !p) continue; const km = satelliteOffsetKm(s.id, when), o = sceneSatelliteOffset(this.scale, [km[0] / AU_KM, km[1] / AU_KM, km[2] / AU_KM], p.radius, bodyById(s.parent)!.radiusKm); n.world = [p.world[0] + o[0], p.world[1] + o[1], p.world[2] + o[2]]; }
  }
  private orient(n: BodyNode) {
    const b = bodyBasis(n.id, new Date(this.spinTime)), x = toScene(b.primeMeridian), y = toScene(b.north), east = toScene(b.east);
    // Mesh axes: +x prime meridian, +y north, -z east longitude 90.
    n.mesh.matrixAutoUpdate = true; n.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(v.set(...x), v2.set(...y), new THREE.Vector3(-east[0], -east[1], -east[2])));
  }
  private buildOrbit(n: BodyNode) {
    const rec = bodyById(n.id)!, pts = PROFILES[this.settings.quality].orbitPoints; if (!rec.orbitDays) return;
    const sat = satellite(n.id), parent = sat ? this.nodes.get(sat.parent as BodyId)! : null, s = orbitSamples(n.id, this.simDate, Math.abs(rec.orbitDays), n.id === 'moon' || sat ? 96 : pts), earth = this.nodes.get('earth')!;
    const a = new Float32Array(s.length * 3);
    s.forEach((p, i) => a.set(sat ? sceneSatelliteOffset(this.scale, p, parent!.radius, bodyById(sat.parent)!.radiusKm) : n.id === 'moon' ? sceneMoonOffset(this.scale, p, earth.radius) : sceneHelio(this.scale, p), i * 3));
    if (!n.orbit) { n.orbit = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x39414f, transparent: true, opacity: 0.8, depthWrite: false })); n.orbit.frustumCulled = false; this.orbitRoot.add(n.orbit); }
    n.orbit.geometry.setAttribute('position', new THREE.BufferAttribute(a, 3)); n.orbitBuiltAt = this.simDate.getTime();
    (n.orbit.material as THREE.LineBasicMaterial).color.set(n.id === this.selected ? 0xc9793a : 0x39414f);
  }
  private requestTexture(n: BodyNode) {
    if (n.requested || !n.material) return; n.requested = true;
    // One new surface per frame, so that several arriving together cannot stall the view.
    const apply = (t: THREE.Texture) => { this.uploads.push(() => { if (!n.material || !n.requested) return; n.material.map = t; n.material.color.set(0xffffff); n.material.needsUpdate = true; n.hasTexture = true; }); };
    this.textures.get(n.id, apply).then(apply)
      .catch((e) => { window.cosmos.log('error', `texture ${n.id}: ${e}`); this.events.onTextureError(n.id); });
  }
  tick(now: number, simDate: Date, ) {
    if (!this.running) return false;
    const limit = this.settings.fpsLimit;
    if (limit > 0 && now - this.lastDraw < 1000 / limit - 1.5) return false;
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000); this.last = now; this.lastDraw = now; this.simDate = simDate;
    this.frames++; if (now - this.fpsAt >= 500) { this.fps = (this.frames * 1000) / (now - this.fpsAt); this.frames = 0; this.fpsAt = now; }
    this.adaptResolution(dt); this.uploads.shift()?.();
    if (this.stage) { const h = this.host(); this.stage.update(dt, h); const k = this.keys; if (this.stage.allowPan && k.size && !k.has('Shift')) { const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0), r = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0), sp = this.dist * dt * 0.9; if (f || r) this.movePan(r * sp, 0, f * sp); } if (k.has('Equal') || k.has('NumpadAdd')) this.zoom(Math.exp(-dt * 1.4)); if (k.has('Minus') || k.has('NumpadSubtract')) this.zoom(Math.exp(dt * 1.4)); this.renderer.info.reset(); this.composer.render(dt); return true; }
    this.spinTime = nextSpinTime(this.spinTime, simDate.getTime(), this.timeRate, dt * 1000); this.positionBodies();
    const target = this.nodes.get(this.focus)!;
    // keyboard movement
    const sp = this.dist * dt * 0.9, k = this.keys;
    if (k.size) { const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0), r = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0); if ((f || r) && !this.transition) this.movePan(r * sp, 0, f * sp); if (k.has('Equal') || k.has('NumpadAdd')) this.zoom(Math.exp(-dt * 1.4)); if (k.has('Minus') || k.has('NumpadSubtract')) this.zoom(Math.exp(dt * 1.4)); }
    let focusP: V3 = target.world;
    if (this.transition) {
      const t = this.transition; t.t = Math.min(1, t.t + dt / t.dur); const e = easeInOut(t.t); focusP = lerp3(t.fromPoint, target.world, e);
      const sep = Math.hypot(t.fromPoint[0] - target.world[0], t.fromPoint[1] - target.world[1], t.fromPoint[2] - target.world[2]);
      this.dist = transitionDistance(t.fromDist, t.toDist, sep, t.t); this.az = t.fromAz + (t.toAz - t.fromAz) * e; this.pol = t.fromPol + (t.toPol - t.fromPol) * e; this.pan = lerp3(t.fromPan, t.toPan, e);
      if (t.t >= 1) this.transition = undefined;
    } else this.dist = Math.exp(Math.log(this.dist) + (Math.log(this.targetDist) - Math.log(this.dist)) * (1 - Math.exp(-dt * 9)));
    this.focusPoint = [...focusP];
    const o: V3 = [focusP[0] + this.pan[0], focusP[1] + this.pan[1], focusP[2] + this.pan[2]];
    const sp2 = Math.sin(this.pol), cam = this.camera; cam.position.set(this.dist * sp2 * Math.sin(this.az), this.dist * Math.cos(this.pol), this.dist * sp2 * Math.cos(this.az)); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0);
    let nearest = Infinity;
    const sunN = this.nodes.get('sun')!, rel = (w: V3): V3 => [w[0] - o[0], w[1] - o[1], w[2] - o[2]], sunRel = rel(sunN.world);
    this.sunLight.position.set(...sunRel); this.orbitRoot.position.set(...sunRel);
    const useShadows = this.scale === 'true' && this.settings.eclipseShadows, earth = this.nodes.get('earth')!, moon = this.nodes.get('moon')!;
    const h = this.canvas.clientHeight, pxK = h / (2 * Math.tan((cam.fov * Math.PI) / 360)); cam.updateMatrixWorld();
    const keep = new Set<string>([this.focus]);
    for (const n of this.nodes.values()) {
      const p = rel(n.world); n.group.position.set(...p); const dc = Math.max(1e-9, Math.hypot(p[0] - cam.position.x, p[1] - cam.position.y, p[2] - cam.position.z)), px = (n.radius / dc) * pxK;
      nearest = Math.min(nearest, Math.max(dc - n.radius * 1.02, n.radius * 0.002)); n.group.visible = px > 0.25;
      n.mesh.geometry = this.geos[px > 180 ? 0 : px > 40 ? 1 : 2]; if (n.atmosphere) n.atmosphere.geometry = this.geos[px > 40 ? 1 : 2];
      if (n.id !== 'sun' && (px > (satellite(n.id) ? 5 : 2.5) || n.id === this.focus)) { this.requestTexture(n); keep.add(n.id); this.textures.touch(n.id); }
      if (n.group.visible) this.orient(n);
      n.shadow.uSunPos.value.set(...sunRel); n.shadow.uSunRadius.value = sunN.radius;
      const sat = satellite(n.id), occ = n.id === 'earth' ? moon : n.id === 'moon' ? earth : sat ? this.nodes.get(sat.parent as BodyId)! : null; n.shadow.uOccluderCount.value = useShadows && occ ? 1 : 0;
      if (occ) { const q = rel(occ.world); n.shadow.uOccluders.value[0].set(q[0], q[1], q[2], occ.radius); }
      if (n.atmosphere?.visible && n.group.visible) {
        const u = (n.atmosphere.material as THREE.ShaderMaterial).uniforms, inv = n.mesh.quaternion.clone().invert(), topR = u.uTop.value as number;
        u.uCam.value.set(cam.position.x - p[0], cam.position.y - p[1], cam.position.z - p[2]).applyQuaternion(inv).divideScalar(n.radius);
        u.uSunDir.value.set(sunRel[0] - p[0], sunRel[1] - p[1], sunRel[2] - p[2]).normalize().applyQuaternion(inv);
        (n.atmosphere.material as THREE.ShaderMaterial).side = u.uCam.value.length() < topR ? THREE.BackSide : THREE.FrontSide;
      }
      if (n.ring) { const u = (n.ring.material as THREE.ShaderMaterial).uniforms; u.uOccluders.value[0].set(p[0], p[1], p[2], n.radius); n.shadow.uRingN.value.set(0, 1, 0).applyQuaternion(n.mesh.quaternion); n.shadow.uRingC.value.set(p[0], p[1], p[2]); n.shadow.uRingR.value = n.radius; }
      if (sat) {
        const near = this.moonRelevant(sat.id, sat.parent), parent = this.nodes.get(sat.parent as BodyId)!;
        if (near && !(this as any).orbitBuiltThisFrame && (!n.orbit || Math.abs(simDate.getTime() - n.orbitBuiltAt) > 40 * 86400000)) { this.buildOrbit(n); (this as any).orbitBuiltThisFrame = true; }
        if (n.orbit) { n.orbit.visible = near; n.orbit.position.set(parent.world[0] - sunN.world[0], parent.world[1] - sunN.world[1], parent.world[2] - sunN.world[2]); }
      } else if (n.orbit || bodyById(n.id)?.orbitDays) {
        const period = Math.abs(bodyById(n.id)!.orbitDays!) * 86400000;
        if (Math.abs(simDate.getTime() - n.orbitBuiltAt) > period / 10 && !(this as any).orbitBuiltThisFrame) { this.buildOrbit(n); (this as any).orbitBuiltThisFrame = true; }
        if (n.orbit) { n.orbit.visible = this.dist > target.radius * (this.scale === 'educational' ? 7 : 60); if (n.id === 'moon') n.orbit.position.set(earth.world[0] - sunN.world[0], earth.world[1] - sunN.world[1], earth.world[2] - sunN.world[2]); }
      }
    }
    (this as any).orbitBuiltThisFrame = false;
    this.textures.evict(keep).forEach((id) => { const n = this.nodes.get(id as BodyId); if (n?.material) { n.material.map = null; n.material.color.set(BASE[id]); n.material.needsUpdate = true; n.requested = false; n.hasTexture = false; } });
    cam.near = Math.max(1e-7, nearest * 0.25); cam.far = Math.max(cam.near * 1e7, this.dist * 200, 2e5); cam.updateProjectionMatrix();
    this.sky.position.set(0, 0, 0);
    this.belts.update(simDate.getTime(), this.scale, v.set(...sunRel), this.renderer.getPixelRatio()); if (!this.effectsPaused) this.fxTime += dt;
    if (this.stars) { const u = (this.stars.material as THREE.ShaderMaterial).uniforms; u.uScale.value = this.renderer.getPixelRatio(); u.uTime.value = this.fxTime; u.uTwinkle.value = this.effects.enabled ? 1 : 0; }
    { const u = (sunN.mesh.material as THREE.ShaderMaterial).uniforms, sp = sunN.group.position; u.uTime.value = this.settings.reduceMotion ? 0 : this.fxTime; u.uDetail.value = THREE.MathUtils.clamp(((sunN.radius / Math.max(1e-9, v.copy(sp).distanceTo(cam.position))) * pxK - 35) / 170, 0, 1); }
    { const ep = earth.group.position, px = (earth.radius / Math.max(1e-9, ep.distanceTo(cam.position))) * pxK; if (!this.effectsPaused) this.effects.update(dt, cam, this.canvas.clientWidth, this.canvas.clientHeight, ep, earth.radius, px); }
    this.glare.position.set(...sunRel); const gu = (this.glare.material as THREE.ShaderMaterial).uniforms; const sd = Math.hypot(sunRel[0] - cam.position.x, sunRel[1] - cam.position.y, sunRel[2] - cam.position.z);
    gu.uSize.value = Math.max(0.012, Math.min(0.3, (sunN.radius / sd) * 1.5)); gu.uGain.value = 0.3 * (1 - 0.72 * (sunN.mesh.material as THREE.ShaderMaterial).uniforms.uDetail.value);
    this.renderer.info.reset(); this.composer.render(dt); this.placeLabels(pxK);
    return true;
  }
  private moonRelevant(id: string, parent: string) { return [this.focus, this.selected].some((x) => x === id || x === parent || (!!x && satellite(x)?.parent === parent)); }
  private placeLabels(pxK: number) {
    const now = performance.now(); if (!this.settings.showLabels || now - this.lastLabels < 30) return; this.lastLabels = now;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight, placed: [number, number][] = [], cam = this.camera;
    const focus = this.nodes.get(this.focus)!; v2.setFromMatrixPosition(focus.group.matrixWorld); const fd = v2.distanceTo(cam.position); const f2 = v2.clone().project(cam), fR = (focus.radius / fd) * pxK, fx = (f2.x + 1) / 2 * w, fy = (1 - f2.y) / 2 * h;
    const order = [...this.nodes.values()].sort((a, b) => (Number(b.id === this.selected) - Number(a.id === this.selected)) || b.radius - a.radius);
    for (const n of order) {
      const b = this.labels.get(n.id)!; v.setFromMatrixPosition(n.group.matrixWorld); const dc = v.distanceTo(cam.position); v.project(cam);
      const x = (v.x + 1) / 2 * w, y = (1 - v.y) / 2 * h, r = (n.radius / dc) * pxK;
      const moonOf = satellite(n.id); let show = v.z < 1 && x > -40 && x < w + 40 && y > -20 && y < h + 20 && (!moonOf || this.moonRelevant(n.id, moonOf.parent));
      if (show && n !== focus && dc > fd && Math.hypot(x - fx, y - fy) < fR) show = false; // behind the focused body
      if (show && n.id !== this.selected && placed.some(([a, c]) => Math.hypot(a - x, c - y) < 34)) show = false;
      b.hidden = !show; if (!show) continue; placed.push([x, y]);
      const large = r > 8, tr = large ? `translate(${x.toFixed(1)}px, ${(y + Math.min(r, h * 0.42) + 2).toFixed(1)}px) translateX(-50%)` : `translate(${(x - 8.5).toFixed(1)}px, ${(y - 11).toFixed(1)}px)`; if (this.labelText.get(n.id) !== tr) { this.labelText.set(n.id, tr); b.style.transform = tr; } b.classList.toggle('large', large);
    }
  }
  stats() { const i = this.renderer.info; return { fps: this.fps, calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, loaded: this.textures.count }; }
  gpuName() { const g = this.renderer.getContext(), e = g.getExtension('WEBGL_debug_renderer_info'); return e ? String(g.getParameter(e.UNMASKED_RENDERER_WEBGL)) : null; }
  get catalogSize() { return CATALOG.length; }
}
