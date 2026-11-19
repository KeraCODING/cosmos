import * as THREE from 'three';
import { satellite } from '../astro/satellites';

const load = (src: string) => new Promise<HTMLImageElement>((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('image ' + src)); i.src = src; });

/** Loads textures on demand, keeps a small recently-used set and frees GPU memory for the rest. */
export class TextureManager {
  private worker = new Worker(new URL('./texture.worker.ts', import.meta.url), { type: 'module' });
  private pendingWorker = new Map<string, { preview?: (t: THREE.Texture) => void; done: (t: THREE.Texture) => void; low?: THREE.Texture; target: number }>();
  private cache = new Map<string, { texture: THREE.Texture; used: number }>();
  private loading = new Map<string, Promise<THREE.Texture>>();
  width = 1024; capacity = 6; anisotropy = 4;
  constructor() {
    this.worker.onmessage = (e: MessageEvent<{ id: string; width: number; height: number; data: ArrayBuffer }>) => {
      const { id, width, height, data } = e.data, t = new THREE.DataTexture(new Uint8Array(data), width, height, THREE.RGBAFormat);
      t.flipY = true; this.finish(t);
      const job = this.pendingWorker.get(id); if (!job) { t.dispose(); return; }
      // A small preview appears almost at once; the full surface replaces it when ready.
      if (width < job.target) { job.low = t; job.preview?.(t); this.worker.postMessage({ id, width: job.target }); return; }
      this.pendingWorker.delete(id); job.done(t); job.low?.dispose();
    };
  }
  private finish<T extends THREE.Texture>(t: T) {
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = this.anisotropy; t.needsUpdate = true;
    return t;
  }
  private async naturalEarth() {
    const level = this.width >= 1024 ? 2 : 1, cols = 2 << level, rows = 1 << level, size = 256;
    const c = document.createElement('canvas'); c.width = cols * size; c.height = rows * size;
    const g = c.getContext('2d')!, base = './cesium/Assets/Textures/NaturalEarthII';
    await Promise.all(Array.from({ length: cols * rows }, async (_, n) => {
      const x = n % cols, y = Math.floor(n / cols), img = await load(`${base}/${level}/${x}/${y}.jpg`);
      g.drawImage(img, x * size - 0.5, (rows - 1 - y) * size - 0.5, size + 1, size + 1); // TMS rows count from the south
    }));
    return this.finish(new THREE.CanvasTexture(c));
  }
  private async build(id: string, preview?: (t: THREE.Texture) => void): Promise<THREE.Texture> {
    if (id === 'earth') return this.naturalEarth();
    if (id === 'moon') return this.finish(new THREE.CanvasTexture(await load('./cesium/Assets/Textures/moonSmall.jpg')));
    const target = satellite(id) ? Math.min(1024, this.width) : this.width; return new Promise((done) => { this.pendingWorker.set(id, { done, preview, target }); this.worker.postMessage({ id, width: Math.min(256, target / 2) }); });
  }
  get(id: string, preview?: (t: THREE.Texture) => void): Promise<THREE.Texture> {
    const hit = this.cache.get(id);
    if (hit) { hit.used = performance.now(); return Promise.resolve(hit.texture); }
    let p = this.loading.get(id);
    if (!p) {
      p = this.build(id, preview).then((texture) => { this.cache.set(id, { texture, used: performance.now() }); this.loading.delete(id); return texture; });
      p.catch(() => this.loading.delete(id));
      this.loading.set(id, p);
    }
    return p;
  }
  touch(id: string) { const h = this.cache.get(id); if (h) h.used = performance.now(); }
  /** Returns the ids that were evicted so their materials can drop the reference. */
  evict(keep: Set<string>): string[] {
    const out: string[] = [], sorted = [...this.cache.entries()].filter(([k]) => !keep.has(k)).sort((a, b) => a[1].used - b[1].used);
    while (this.cache.size - out.length > this.capacity && sorted.length) { const [k, v] = sorted.shift()!; v.texture.dispose(); this.cache.delete(k); out.push(k); }
    return out;
  }
  clear() { this.cache.forEach((v) => v.texture.dispose()); this.cache.clear(); }
  get count() { return this.cache.size; }
}
