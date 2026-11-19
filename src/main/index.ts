import { app, BrowserWindow, ipcMain, net, protocol, session, shell } from 'electron';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const USER_AGENT = `COSMOS-desktop/${app.getVersion()}`;
const JSON_HOSTS = new Set(['ssd.jpl.nasa.gov', 'nominatim.openstreetmap.org']);
/** The only hosts COSMOS may contact. Everything else, including library telemetry, is blocked. */
const ALLOWED_HOSTS = new Set([...JSON_HOSTS, 'tile.openstreetmap.org', 'gibs.earthdata.nasa.gov', 's3.amazonaws.com']);
const netLog: { allowed: string[]; blocked: { url: string; method: string; bytes: number; sample: string }[] } = { allowed: [], blocked: [] };
(globalThis as Record<string, unknown>).__cosmosNetLog = netLog;

/** Tile providers are proxied so every viewed tile is cached on disk for offline use. */
const TILE_SOURCES: Record<string, (z: string, x: string, y: string) => string> = {
  osm: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  bluemarble: (z, x, y) =>
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/2004-08-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpeg`,
  terrain: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
};

let offline = false;
let cameraAllowed = false; // set only after the user has agreed inside the app
const trustedOrigin = (o: string) => o.startsWith('app://cosmos') || (!app.isPackaged && o.startsWith('http://localhost'));
const dir = (name: string) => join(app.getPath('userData'), name);
const settingsFile = () => join(app.getPath('userData'), 'settings.json');

function log(level: string, message: string) {
  try {
    mkdirSync(dir('logs'), { recursive: true });
    const file = join(dir('logs'), 'cosmos.log');
    if (existsSync(file) && statSync(file).size > 2_000_000) renameSync(file, file + '.old');
    appendFileSync(file, `${new Date().toISOString()} [${level}] ${message}\n`);
  } catch { /* logging must never crash the app */ }
}

process.on('uncaughtException', (e) => log('fatal', e.stack ?? String(e)));
process.on('unhandledRejection', (e) => log('error', String(e)));

app.commandLine.appendSwitch('force_high_performance_gpu');
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.geojson': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm', '.xml': 'text/xml', '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary',
};
const cors = { 'Access-Control-Allow-Origin': '*' };

async function serveTile(parts: string[]): Promise<Response> {
  const [provider, z, x, y] = parts;
  const build = TILE_SOURCES[provider];
  if (!build || ![z, x, y].every((p) => /^\d+$/.test(p ?? ''))) return new Response(null, { status: 400, headers: cors });
  const file = join(dir('tile-cache'), provider, z, x, y);
  const type = provider === 'bluemarble' ? 'image/jpeg' : 'image/png';
  try {
    return new Response(await readFile(file), { headers: { ...cors, 'Content-Type': type, 'X-Cosmos-Cache': 'hit' } });
  } catch { /* not cached */ }
  if (offline) return new Response(null, { status: 503, headers: cors });
  try {
    const res = await net.fetch(build(z, x, y), { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return new Response(null, { status: res.status, headers: cors });
    const body = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
    return new Response(body, { headers: { ...cors, 'Content-Type': type } });
  } catch (e) {
    log('warn', `tile ${provider}/${z}/${x}/${y}: ${e}`);
    return new Response(null, { status: 503, headers: cors });
  }
}

async function serveApp(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname);
  if (path.startsWith('/tiles/')) return serveTile(path.split('/').slice(2));
  const base = join(__dirname, '..', 'renderer');
  const file = normalize(join(base, path === '/' ? 'index.html' : path));
  if (!file.startsWith(base + sep)) return new Response(null, { status: 403 });
  try {
    return new Response(await readFile(file), {
      headers: { ...cors, 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' },
    });
  } catch {
    return new Response(null, { status: 404, headers: cors });
  }
}

/** JSON from an allow-listed scientific service, with a disk cache used when offline or on failure. */
async function fetchJson(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || !JSON_HOSTS.has(url.hostname)) throw new Error('host not allowed');
  const file = join(dir('data-cache'), createHash('sha256').update(rawUrl).digest('hex') + '.json');
  const cached = async () => {
    const c = JSON.parse(await readFile(file, 'utf8'));
    return { data: c.data, fetchedAt: c.fetchedAt as string, fromCache: true };
  };
  if (offline) {
    try { return await cached(); } catch { return { error: 'offline' }; }
  }
  try {
    const res = await net.fetch(rawUrl, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const fetchedAt = new Date().toISOString();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ data, fetchedAt }));
    return { data, fetchedAt, fromCache: false };
  } catch (e) {
    log('warn', `fetch ${url.hostname}: ${e}`);
    try { return await cached(); } catch { return { error: 'network' }; }
  }
}

async function dirSize(path: string): Promise<number> {
  let total = 0;
  let entries;
  try { entries = await readdir(path, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = join(path, e.name);
    total += e.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return total;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 600, show: false, backgroundColor: '#05060a',
    autoHideMenuBar: true, title: 'COSMOS',
    icon: join(__dirname, '..', 'renderer', 'icon.png'),
    webPreferences: { preload: join(__dirname, '..', 'preload', 'index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.setMenu(null);
  win.once('ready-to-show', () => win.show());
  win.on('enter-full-screen', () => win.webContents.send('fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen', false));
  win.webContents.on('render-process-gone', (_e, d) => log('fatal', `renderer gone: ${d.reason}`));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://') && !url.startsWith('http://localhost')) e.preventDefault(); });
  const dev = process.env.ELECTRON_RENDERER_URL;
  void win.loadURL(dev && !app.isPackaged ? dev : 'app://cosmos/index.html');
}

if (!app.requestSingleInstanceLock() && !process.env.COSMOS_TEST) {
  app.quit();
} else {
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(() => {
    protocol.handle('app', serveApp);
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (d, done) => {
      const u = new URL(d.url), ok = ALLOWED_HOSTS.has(u.hostname) || (!app.isPackaged && u.hostname === 'localhost');
      if (ok) { if (netLog.allowed.length < 200) netLog.allowed.push(`${d.method} ${u.hostname}`); done({}); return; }
      const body = d.uploadData?.[0]?.bytes; log('warn', `blocked network request to ${u.hostname}`);
      if (netLog.blocked.length < 50) netLog.blocked.push({ url: u.origin + u.pathname, method: d.method, bytes: body?.length ?? 0, sample: body ? body.subarray(0, 600).toString('latin1').replace(/[^\x20-\x7e]+/g, ' ') : '' });
      done({ cancel: true });
    });
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done, details) => {
      const d = details as { mediaTypes?: string[]; requestingUrl?: string };
      done(permission === 'media' && cameraAllowed && trustedOrigin(d.requestingUrl ?? '') && !d.mediaTypes?.includes('audio'));
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => (permission === 'media' ? cameraAllowed && trustedOrigin(origin) : true));
    ipcMain.handle('camera:allow', (_e, v: boolean) => { cameraAllowed = !!v; log('info', `camera ${cameraAllowed ? 'allowed by user' : 'closed'}`); });
    ipcMain.handle('settings:load', () => { try { return JSON.parse(readFileSync(settingsFile(), 'utf8')); } catch { return null; } });
    ipcMain.handle('settings:save', (_e, value: unknown) => {
      const tmp = settingsFile() + '.tmp';
      writeFileSync(tmp, JSON.stringify(value, null, 2));
      renameSync(tmp, settingsFile());
    });
    ipcMain.on('log', (_e, level: string, message: string) => log(String(level), String(message).slice(0, 4000)));
    ipcMain.on('offline', (_e, value: boolean) => { offline = !!value; });
    ipcMain.handle('net:json', (_e, url: string) => fetchJson(String(url)));
    ipcMain.handle('fullscreen:toggle', (e) => {
      const w = BrowserWindow.fromWebContents(e.sender); if (w) w.setFullScreen(!w.isFullScreen()); return w?.isFullScreen() ?? false;
    });
    ipcMain.handle('resolution:set', (e, width: number, height: number) => {
      const w = BrowserWindow.fromWebContents(e.sender);
      if (w && !w.isFullScreen()) { w.unmaximize(); w.setContentSize(Math.round(width), Math.round(height)); w.center(); }
    });
    ipcMain.handle('app:info', () => ({ version: app.getVersion(), electron: process.versions.electron, logFile: join(dir('logs'), 'cosmos.log') }));
    ipcMain.handle('cache:size', async () => (await dirSize(dir('tile-cache'))) + (await dirSize(dir('data-cache'))));
    ipcMain.handle('cache:clear', () => { for (const d of ['tile-cache', 'data-cache']) rmSync(dir(d), { recursive: true, force: true }); });
    ipcMain.handle('logs:open', () => shell.showItemInFolder(join(dir('logs'), 'cosmos.log')));
    ipcMain.handle('link:open', (_e, url: string) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); });
    app.on('child-process-gone', (_e, d) => { log('error', `process gone: ${d.type} ${d.reason} ${d.exitCode}`); ((globalThis as Record<string, unknown>).__cosmosGone as string[] | undefined)?.push(`${d.type}:${d.reason}`); });
    (globalThis as Record<string, unknown>).__cosmosGone = [];
    log('info', `COSMOS ${app.getVersion()} started`);
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
