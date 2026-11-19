// CesiumJS globe. Cesium is loaded only when the user opens Earth Explorer.
export type EarthLayer = 'natural' | 'bluemarble' | 'osm';
// Shares NavigationTarget semantics with the space view: see rotate, zoom and hover below.
export interface GeoResult { name: string; lat: number; lon: number; box?: [number, number, number, number] }
export const LAYER_CREDITS: Record<EarthLayer, string> = {
  natural: 'Natural Earth II (public domain), via CesiumJS',
  bluemarble: 'NASA Blue Marble via NASA GIBS',
  osm: '© OpenStreetMap contributors (ODbL)',
};
export const TERRAIN_CREDIT = 'Terrain Tiles: Mapzen / Amazon Open Data, derived from SRTM, GMTED, NED, ETOPO and other sources';
const TILE_BASE = 'app://cosmos/tiles';

function loadScript(): Promise<any> {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  window.CESIUM_BASE_URL = './cesium/';
  return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = './cesium/Cesium.js'; s.onload = () => ok(window.Cesium); s.onerror = () => fail(new Error('Cesium failed to load')); document.head.append(s); });
}

export class EarthExplorer {
  private C: any; private w: any; private imagery: any; private borders: any; private labels: any; private points: any; private handler: any;
  private flatTerrain: any; private realTerrain: any; layer: EarthLayer = 'natural'; private tileCache = new Map<string, Promise<ImageData | null>>();
  onCoords?: (c: { lat: number; lon: number; height: number | null } | null) => void;
  get ready() { return !!this.w; }

  async open(el: HTMLElement, credits: HTMLElement, date: Date, reduceMotion: boolean) {
    if (this.w) { this.setDate(date); this.w.useDefaultRenderLoop = true; this.w.resize(); return; }
    const C = (this.C = await loadScript());
    this.flatTerrain = new C.EllipsoidTerrainProvider();
    this.realTerrain = this.makeTerrain();
    const w = (this.w = new C.CesiumWidget(el, { baseLayer: false, terrainProvider: this.flatTerrain, scene3DOnly: true, creditContainer: credits, requestRenderMode: true, maximumRenderTimeChange: Infinity, msaaSamples: 4 }));
    const g = w.scene.globe; g.enableLighting = false; g.baseColor = C.Color.fromCssColorString('#0a1626'); g.maximumScreenSpaceError = 1.6; g.tileCacheSize = 160;
    w.scene.screenSpaceCameraController.enableCollisionDetection = true;
    w.scene.highDynamicRange = false; w.clock.shouldAnimate = false;
    await this.setLayer('natural', false);
    this.setDate(date);
    w.camera.setView({ destination: C.Cartesian3.fromDegrees(47.6, 40.3, 2.0e7) });
    if (!reduceMotion) w.camera.flyTo({ destination: C.Cartesian3.fromDegrees(47.6, 40.3, 9.0e6), duration: 2.2 });
    this.handler = new C.ScreenSpaceEventHandler(w.canvas);
    this.handler.setInputAction((m: any) => this.readCoords(m.endPosition), C.ScreenSpaceEventType.MOUSE_MOVE);
    void this.loadVectors();
  }
  private readCoords(pos: any) {
    const { C, w } = this, ray = w.camera.getPickRay(pos), p = ray && w.scene.globe.pick(ray, w.scene);
    if (!p) { this.onCoords?.(null); return; }
    const c = C.Cartographic.fromCartesian(p);
    this.onCoords?.({ lat: C.Math.toDegrees(c.latitude), lon: C.Math.toDegrees(c.longitude), height: this.w.terrainProvider === this.realTerrain ? c.height : null });
  }
  private tile(z: number, x: number, y: number) {
    const key = `${z}/${x}/${y}`; let p = this.tileCache.get(key);
    if (!p) {
      p = (async () => {
        const r = await fetch(`${TILE_BASE}/terrain/${key}`); if (!r.ok) return null;
        const b = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }), c = new OffscreenCanvas(256, 256), g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(b, 0, 0); b.close(); return g.getImageData(0, 0, 256, 256);
      })().catch(() => null);
      this.tileCache.set(key, p); if (this.tileCache.size > 160) this.tileCache.delete(this.tileCache.keys().next().value!);
    }
    return p;
  }
  private makeTerrain() {
    const C = this.C, N = 33;
    return new C.CustomHeightmapTerrainProvider({
      width: N, height: N, tilingScheme: new C.WebMercatorTilingScheme(),
      callback: async (x: number, y: number, level: number) => {
        const out = new Float32Array(N * N), z = Math.min(level, 12), shift = level - z, n = 1 << shift, tx = x >> shift, ty = y >> shift, img = await this.tile(z, tx, ty);
        if (!img) return out; // no elevation available: flat, never made up
        const ox = (x - (tx << shift)) / n, oy = (y - (ty << shift)) / n, span = 1 / n;
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const px = Math.min(255, Math.round((ox + (i / (N - 1)) * span) * 255)), py = Math.min(255, Math.round((oy + (j / (N - 1)) * span) * 255)), k = (py * 256 + px) * 4, d = img.data;
          out[j * N + i] = d[k] * 256 + d[k + 1] + d[k + 2] / 256 - 32768;
        }
        return out;
      },
    });
  }
  async setLayer(layer: EarthLayer, render = true) {
    const { C, w } = this; let provider;
    if (layer === 'natural') provider = await C.TileMapServiceImageryProvider.fromUrl(C.buildModuleUrl('Assets/Textures/NaturalEarthII'));
    else if (layer === 'bluemarble') provider = new C.UrlTemplateImageryProvider({ url: `${TILE_BASE}/bluemarble/{z}/{x}/{y}`, tilingScheme: new C.WebMercatorTilingScheme(), tileWidth: 256, tileHeight: 256, maximumLevel: 8, credit: LAYER_CREDITS.bluemarble });
    else provider = new C.UrlTemplateImageryProvider({ url: `${TILE_BASE}/osm/{z}/{x}/{y}`, maximumLevel: 19, credit: LAYER_CREDITS.osm });
    const next = w.imageryLayers.addImageryProvider(provider, 0);
    if (this.imagery) w.imageryLayers.remove(this.imagery, true);
    this.imagery = next; this.layer = layer; if (render) w.scene.requestRender();
  }
  setTerrain(on: boolean) { this.w.terrainProvider = on ? this.realTerrain : this.flatTerrain; this.w.scene.requestRender(); }
  setLighting(on: boolean) { this.w.scene.globe.enableLighting = on; this.w.scene.requestRender(); }
  setBorders(on: boolean) { if (this.borders) this.borders.show = on; this.w.scene.requestRender(); }
  setLabels(on: boolean) { if (this.labels) { this.labels.show = on; this.points.show = on; } this.w.scene.requestRender(); }
  setDate(d: Date) { if (this.w) { this.w.clock.currentTime = this.C.JulianDate.fromDate(d); this.w.scene.requestRender(); } }
  private async loadVectors() {
    const { C, w } = this;
    const [lines, places] = await Promise.all(['ne_110m_admin_0_boundary_lines_land', 'ne_110m_populated_places_simple'].map((f) => fetch(`./geo/${f}.geojson`).then((r) => r.json())));
    this.borders = w.scene.primitives.add(new C.PolylineCollection());
    const color = C.Color.fromCssColorString('#f2c49a').withAlpha(0.65);
    for (const f of lines.features) {
      const g = f.geometry, parts = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
      for (const p of parts) this.borders.add({ positions: C.Cartesian3.fromDegreesArray(p.flat().slice(0, p.length * 2)), width: 1, material: C.Material.fromType('Color', { color }) });
    }
    this.labels = w.scene.primitives.add(new C.LabelCollection()); this.points = w.scene.primitives.add(new C.PointPrimitiveCollection());
    const near = new C.NearFarScalar(1.5e6, 1, 1.2e7, 0);
    for (const f of places.features) {
      const position = C.Cartesian3.fromDegrees(f.geometry.coordinates[0], f.geometry.coordinates[1]);
      this.points.add({ position, pixelSize: 4, color: C.Color.fromCssColorString('#e8955a'), translucencyByDistance: near, disableDepthTestDistance: 0 });
      this.labels.add({ position, text: f.properties.name, font: '13px Segoe UI, sans-serif', fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(8, 0), horizontalOrigin: C.HorizontalOrigin.LEFT, translucencyByDistance: near });
    }
    w.scene.requestRender();
  }
  flyTo(r: GeoResult, reduceMotion: boolean) {
    const { C, w } = this, duration = reduceMotion ? 0 : 3;
    if (r.box) w.camera.flyTo({ destination: C.Rectangle.fromDegrees(r.box[2], r.box[0], r.box[3], r.box[1]), duration });
    else w.camera.flyTo({ destination: C.Cartesian3.fromDegrees(r.lon, r.lat, 60000), duration });
  }
  flyHome(reduceMotion: boolean) { const C = this.C; this.w.camera.flyTo({ destination: C.Cartesian3.fromDegrees(47.6, 40.3, 9.0e6), duration: reduceMotion ? 0 : 2.5 }); }
  private get scaleByHeight() { return Math.min(1, this.w.camera.positionCartographic.height / 6.4e6); }
  rotate(dx: number, dy: number) { const k = 2.4 * this.scaleByHeight, c = this.w.camera; c.rotateLeft(dx * k); c.rotateDown(-dy * k); this.w.scene.requestRender(); }
  zoom(log: number) { const c = this.w.camera, h = c.positionCartographic.height, next = Math.max(150, Math.min(4e7, h * Math.exp(log))); c.moveForward(h - next); this.w.scene.requestRender(); }
  hover(x: number, y: number) { this.readCoords(new this.C.Cartesian2(x, y)); }
  pause() { if (this.w) this.w.useDefaultRenderLoop = false; }
  resize() { this.w?.resize(); this.w?.scene.requestRender(); }
}

export async function searchPlaces(query: string, language: string): Promise<GeoResult[] | 'offline' | 'network'> {
  const q = new URLSearchParams({ format: 'jsonv2', limit: '5', q: query, 'accept-language': `${language},en` });
  const r = await window.cosmos.fetchJson(`https://nominatim.openstreetmap.org/search?${q}`);
  if ('error' in r) return r.error;
  return (r.data as any[]).map((p) => ({ name: p.display_name, lat: Number(p.lat), lon: Number(p.lon), box: p.boundingbox ? (p.boundingbox.map(Number) as GeoResult['box']) : undefined }));
}
