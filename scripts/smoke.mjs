// End-to-end check of the built desktop app. Usage: node scripts/smoke.mjs <screenshot-dir> [path-to-exe]
import { _electron as electron } from 'playwright-core';
import { PNG } from 'pngjs';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const shots = process.argv[2] ?? 'smoke-shots', exe = process.argv[3];
mkdirSync(shots, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'cosmos-smoke-'));
const launchOpts = { args: [...(exe ? [] : ['.']), '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--user-data-dir=${profile}`], env: { ...process.env, COSMOS_TEST: '1' }, timeout: 60000, ...(exe ? { executablePath: exe } : {}) };
const results = [], problems = [];
let failedResources = 0;
/** Mean and spread of brightness in a screen region, to prove real imagery is on screen. */
async function imageStats(x, y, width, height) {
  const p = PNG.sync.read(await capture({ clip: { x, y, width, height } })); let n = 0, sum = 0, sq = 0;
  for (let i = 0; i < p.data.length; i += 16) { const l = (p.data[i] + p.data[i + 1] + p.data[i + 2]) / 3; n++; sum += l; sq += l * l; }
  const mean = sum / n; return { mean: Math.round(mean), spread: Math.round(Math.sqrt(Math.max(0, sq / n - mean * mean))) };
}
let app, page;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const st = (fn, arg) => page.evaluate(fn, arg);
// The globe renders only on demand, so an idle page may have no new frame to capture. Ask for one and retry.
async function capture(o) { for (let i = 0; ; i++) { try { return await page.screenshot({ ...o, timeout: 8000 }); } catch (e) { if (i === 2) throw e; await page.evaluate(() => window.__cosmos?.earth?.w?.scene.requestRender()).catch(() => {}); await wait(300); } } }
const shot = (n) => capture({ path: join(shots, n + '.png') });
const text = () => page.evaluate(() => document.getElementById('chrome').innerText);
let lastLang = null;
async function step(name, fn) { try { await fn(); const l = await page.evaluate(() => document.documentElement.lang); if (lastLang && l !== lastLang) console.log(`   language is now ${l} after: ${name}`); lastLang = l; results.push(['PASS', name]); console.log('PASS', name); } catch (e) { results.push(['FAIL', name]); console.log('FAIL', name, '-', String(e.message).split('\n').slice(0, 12).join(' | ').slice(0, 1800)); await shot('fail-' + name.replace(/\W+/g, '-')).catch(() => {}); } }
async function launch() {
  app = await electron.launch(launchOpts); page = await app.firstWindow();
  // Keep the window away from the real mouse and keyboard so that nothing but this script drives it.
  // Almost entirely off-screen but still on a display, so Windows keeps rendering it; real mouse input is ignored.
  await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0], a = screen.getPrimaryDisplay().workArea; w.setIgnoreMouseEvents(true); w.setPosition(a.x + a.width - 10, a.y + a.height - 10); w.setSkipTaskbar(true); globalThis.__winEvents = []; for (const e of ['minimize', 'hide', 'restore', 'close']) w.on(e, () => globalThis.__winEvents.push(e)); w.on('minimize', () => w.restore()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (/Failed to load resource/.test(m.text())) failedResources++; if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) problems.push('console: ' + m.text().slice(0, 240)); });
  if (!globalThis.bootShot) { globalThis.bootShot = true; await page.waitForFunction(() => document.getElementById('boot-credit')?.textContent, null, { timeout: 30000 }); await page.screenshot({ path: join(shots, '00-boot.png') }).catch(() => {}); console.log('   boot text:', await page.locator('#boot-credit').innerText()); }
  await page.waitForFunction(() => !!window.__cosmos, null, { timeout: 60000 });
}
const until = (name, f) => page.waitForFunction(f, null, { timeout: 15000, polling: 16 }).catch(async () => { throw new Error(name + ' timed out: ' + await st(() => { const c = window.__cosmos, v = c.view; return JSON.stringify({ visible: document.visibilityState, paused: c.clock.paused, effects: v.effects.active, enabled: v.effects.enabled, flying: !!v.transition, fps: Math.round(v.fps), focus: v.focus }); }) + ' DIAG ' + await diagnose()); });
async function diagnose() {
  const page1 = await st(async () => {
    const c = window.__cosmos, v = c.view, gl = v.renderer.getContext(); let n = 0; const t0 = performance.now(); await new Promise((r) => { const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); });
    const a = performance.now(); v.composer.render(0.016); const js = performance.now() - a; gl.finish(); const total = performance.now() - a, i = v.renderer.info; let ticks = 0; const old = v.tick.bind(v); v.tick = (...x) => { ticks++; return old(...x); }; await new Promise((r) => setTimeout(r, 1000)); v.tick = old;
    return { rafPerSec: n / 2, ticksPerSec: ticks, renderJsMs: Math.round(js), renderWithGpuMs: Math.round(total), contextLost: gl.isContextLost(), gpu: v.gpuName(), calls: i.render.calls, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length, heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576), limit: c.constructor && v.settings.fpsLimit, hidden: document.hidden };
  });
  const main = await app.evaluate(({ app: a, BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return { gone: globalThis.__cosmosGone, gpuStatus: a.getGPUFeatureStatus().webgl2, bounds: w.getBounds(), visible: w.isVisible(), minimized: w.isMinimized(), metrics: a.getAppMetrics().map((m) => m.type + ':' + Math.round(m.cpu.percentCPUUsage) + '%').join(' ') }; });
  return JSON.stringify({ page: page1, main });
}
const flightDone = () => until('camera flight', () => !window.__cosmos.view.transition);
const focus = async (id, ms = 3400) => { await st((i) => window.__cosmos.focusBody(i), id); await wait(ms); };

await launch();
await st(() => { window.__long = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] }); });
await page.setViewportSize?.({ width: 1440, height: 900 }).catch(() => {});
await step('first launch is in Azerbaijani', async () => { const x = await text(); ok(x.includes('Kəşfə başla'), x.slice(0, 80)); await wait(1200); await shot('01-welcome-az'); });
await step('language switches instantly', async () => {
  await page.getByRole('button', { name: 'English', exact: true }).click(); ok((await text()).includes('Start exploring'), 'no English');
  ok((await page.locator('.body-label span').allTextContents()).includes('Jupiter'), 'labels stayed Azerbaijani');
  await page.getByRole('button', { name: 'Azərbaycan dili' }).click(); ok((await text()).includes('Kəşfə başla'), 'no Azerbaijani');
  await page.getByRole('button', { name: 'Kəşfə başla' }).click();
});
await step('solar system renders', async () => { await wait(2500); const s = await st(() => window.__cosmos.view.stats()); ok(s.calls > 5 && s.triangles > 500, JSON.stringify(s)); await shot('02-home-educational'); });
await step('search finds Yupiter and flies there', async () => {
  await page.keyboard.press('Control+k'); await page.keyboard.type('yupiter'); await page.keyboard.press('Enter'); await wait(3500);
  ok(await st(() => window.__cosmos.view.focus === 'jupiter'), 'not focused'); ok((await text()).includes('Qaz nəhəngi'), 'no panel'); await shot('03-jupiter');
});
for (const b of ['earth', 'saturn', 'mars', 'moon', 'venus', 'neptune', 'sun']) await step(`view ${b}`, async () => { await focus(b, 6500); await shot('04-' + b); });
await step('keyboard: space, W, plus, F, Esc', async () => {
  await focus('mars', 2800); await flightDone(); const p0 = await st(() => window.__cosmos.clock.paused); await page.keyboard.press('Space'); ok((await st(() => window.__cosmos.clock.paused)) !== p0, 'space'); await page.keyboard.press('Space');
  await page.locator('#space').hover(); await page.keyboard.down('KeyW'); await wait(250); await page.keyboard.up('KeyW'); ok(await st(() => Math.hypot(...window.__cosmos.view.pan) > 0), 'W');
  const d = await st(() => window.__cosmos.view.targetDist); await page.keyboard.down('Equal'); await wait(250); await page.keyboard.up('Equal'); ok((await st(() => window.__cosmos.view.targetDist)) < d, 'plus');
  await page.keyboard.press('KeyF'); await wait(2800); ok(await st(() => Math.hypot(...window.__cosmos.view.pan) < 1e-6), 'F'); await page.keyboard.press('Escape'); ok(await st(() => !window.__cosmos.infoOpen), 'Esc');
});
if (process.env.SMOKE_STOP === 'keyboard') { await app.close(); console.log(results.every((r) => r[0] === 'PASS') ? 'QUICK PASS' : 'QUICK FAIL'); process.exit(0); }
await step('mouse: rotate, wheel, pan, click', async () => {
  await st(() => window.__cosmos.goHome()); await wait(2800); await flightDone(); const a = await st(() => window.__cosmos.view.az);
  await page.mouse.move(500, 500); await page.mouse.down(); await page.mouse.move(600, 520, { steps: 4 }); await page.mouse.up(); ok((await st(() => window.__cosmos.view.az)) !== a, 'rotate');
  const d = await st(() => window.__cosmos.view.targetDist); await page.mouse.wheel(0, 300); await wait(100); ok((await st(() => window.__cosmos.view.targetDist)) > d, 'wheel');
  await page.mouse.down({ button: 'right' }); await page.mouse.move(540, 560, { steps: 3 }); await page.mouse.up({ button: 'right' }); ok(await st(() => Math.hypot(...window.__cosmos.view.pan) > 0), 'pan');
  await st(() => window.__cosmos.goHome()); await wait(2800); await page.locator('.body-label[data-body=jupiter]').click({ force: true }); ok(await st(() => window.__cosmos.selected === 'jupiter'), 'click select');
});
await step('history and home', async () => { await focus('earth', 300); await focus('mars', 300); await page.getByRole('button', { name: 'Geri', exact: true }).click(); ok(await st(() => window.__cosmos.view.focus === 'earth'), 'back'); await page.getByRole('button', { name: 'İrəli' }).click(); ok(await st(() => window.__cosmos.view.focus === 'mars'), 'forward'); await page.getByRole('button', { name: 'Əsas görünüş' }).click(); ok(await st(() => window.__cosmos.view.focus === 'sun'), 'home'); await wait(2600); });
await step('time controls', async () => { await page.getByRole('button', { name: 'İndi' }).click(); ok(await st(() => window.__cosmos.clock.isRealtime), 'realtime'); await page.getByRole('button', { name: 'Daha sürətli' }).click(); ok(await st(() => window.__cosmos.clock.rate === 60), 'faster'); const t0 = await st(() => window.__cosmos.clock.time); await page.waitForFunction((t) => window.__cosmos.clock.time > t + 10000, t0, { timeout: 5000 }); await page.getByRole('button', { name: 'Zamanı geri çevir' }).click(); ok(await st(() => window.__cosmos.clock.rate === -60), 'reverse'); await page.getByRole('button', { name: 'Zamanı geri çevir' }).click(); });
await step('true scale and eclipse from calendar', async () => {
  await st(() => { const c = window.__cosmos; c.clock.set(Date.parse('2026-08-12T17:46:00Z')); c.clock.paused = true; c.openPanel('events'); }); await wait(1800); ok((await text()).includes('Tutulma') || (await text()).includes('tutulma'), 'no eclipse listed');
  await shot('05-events'); await page.locator('.event', { hasText: 'Günəş tutulması' }).first().getByRole('button').click(); await wait(4500); ok(await st(() => window.__cosmos.view.scale === 'true' && window.__cosmos.view.focus === 'earth'), 'state'); await shot('06-eclipse-earth');
  await st(() => { const c = window.__cosmos; c.clock.set(Date.parse('2026-08-12T17:46:00Z')); c.view.syncTime(c.clock.date); c.view.flyTo('earth', 0.03); }); await wait(3400); await shot('06b-eclipse-close');
  await st(() => { const c = window.__cosmos; c.clock.set(Date.parse('2026-11-24T14:53:00Z')); c.view.syncTime(c.clock.date); c.view.setPose({ focus: 'moon', dist: 0.009, pol: 1.5, az: (() => { const e = c.view.nodes.get('earth').world, m = c.view.nodes.get('moon').world; return Math.atan2(e[0] - m[0], e[2] - m[2]); })() }); }); await wait(3400); await shot('06c-moon-from-earth');
});
await step('JPL Horizons comparison', async () => { await page.getByRole('button', { name: 'JPL Horizons ilə müqayisə et' }).click(); await page.waitForFunction(() => { const c = window.__cosmos.check; return c && c.state !== 'busy'; }, null, { timeout: 30000 }); const c = await st(() => window.__cosmos.check.state); ok(c.ok, JSON.stringify(c)); ok(c.differenceKm < 200000, 'difference ' + c.differenceKm); console.log('   Earth vs Horizons km:', Math.round(c.differenceKm)); });
await step('offline mode shows cached result', async () => { await st(() => window.__cosmos.set({ offlineMode: true })); await page.getByRole('button', { name: 'JPL Horizons ilə müqayisə et' }).click(); await page.waitForFunction(() => { const c = window.__cosmos.check; return c && c.state !== 'busy'; }, null, { timeout: 8000 }); ok((await st(() => window.__cosmos.check.state)).fromCache, 'not cached'); ok((await text()).includes('Saxlanmış nəticə'), 'no label'); await st(() => window.__cosmos.set({ offlineMode: false })); });
await step('favorites, bookmarks, collections', async () => { await page.getByRole('button', { name: 'Seçilmişlərə əlavə et' }).click(); await page.getByRole('button', { name: 'Bu görünüşü saxla' }).click(); await st(() => window.__cosmos.openPanel('library')); await page.getByPlaceholder('Yeni kolleksiyanın adı').fill('Test'); await page.getByRole('button', { name: 'Yarat' }).click(); const s = await st(() => { const v = window.__cosmos; return 0; }); ok((await text()).includes('Test'), 'collection'); await shot('07-library'); await page.keyboard.press('Escape'); });
await step('settings work in English', async () => {
  await st(() => { window.__cosmos.set({ scale: 'educational', showPerf: true }); window.__cosmos.goHome(); window.__cosmos.openPanel('settings'); }); await wait(600); await page.locator('select').first().selectOption('en'); await wait(300); const x = await text(); ok(x.includes('Graphics quality'), 'not English');
  ok(!/[əğış]/i.test(x.replace('Azərbaycan dili', '')), 'Azerbaijani left over: ' + (x.match(/.{0,18}[əğış].{0,18}/i) ?? [''])[0]); await shot('08-settings-en');
  for (const q of ['low', 'medium', 'ultra', 'high']) { await st((v) => window.__cosmos.set({ quality: v }), q); await wait(1000); const f = await st(() => window.__cosmos.view.stats().calls); ok(f > 0, q); }
  await page.keyboard.press('Escape'); await wait(1500);
});
await step('every graphics profile keeps rendering (fps report)', async () => { for (const q of ['low', 'medium', 'high', 'ultra']) { await st((v) => { window.__cosmos.set({ quality: v, fpsLimit: 0 }); window.__cosmos.focusBody('earth'); }, q); await wait(4200); console.log('   ', q, 'fps', Math.round(await st(() => window.__cosmos.view.fps))); } await st(() => window.__cosmos.set({ quality: 'high', fpsLimit: 60 })); });
await step('Earth Explorer', async () => {
  await page.getByRole('button', { name: 'Earth Explorer' }).click(); await page.waitForSelector('.earth-panel', { timeout: 45000 }); await wait(6500); await shot('09-earth-natural'); console.log('   globe camera height km:', Math.round(await st(() => window.__cosmos.earth.w.camera.positionCartographic.height / 1000)), 'canvas', await st(() => { const c = window.__cosmos.earth.w.canvas; return c.width + 'x' + c.height; }));
  failedResources = 0; await page.locator('.earth-panel select').selectOption('bluemarble'); await wait(6000); await shot('10-earth-bluemarble'); const bm = await imageStats(420, 150, 700, 600); console.log('   Blue Marble image', bm, 'failed requests', failedResources); ok(failedResources === 0, 'tile requests failed: ' + failedResources); ok(bm.spread > 18, 'globe looks blank');
  await page.getByPlaceholder('Search for a place').fill('Baku'); await page.keyboard.press('Enter'); await page.waitForSelector('.earth-panel .result', { timeout: 20000 }); await page.locator('.earth-panel .result').first().click(); await wait(6500);
  await page.getByLabel('3D terrain').check(); await wait(4000); ok(await st(() => document.documentElement.lang === 'en'), 'language changed during Earth Explorer'); await page.mouse.move(900, 450); await wait(500); const c = await page.locator('.coords').innerText(); ok(/\d+\.\d+°/.test(c), 'coords: ' + c); console.log('   coords:', c); await shot('11-earth-baku'); const bk = await imageStats(420, 150, 700, 600); console.log('   Baku image', bk, 'failed requests', failedResources); ok(failedResources === 0, 'tile or terrain requests failed: ' + failedResources); ok(bk.mean > 25, 'view is black');
  await page.locator('.earth-panel select').selectOption('osm'); await wait(4500); await shot('12-earth-osm'); const os = await imageStats(420, 150, 700, 600); console.log('   OSM image', os); ok(os.spread > 12, 'map looks blank');
  await page.getByLabel('Real day and night').check(); await wait(800); await page.getByLabel('Real day and night').uncheck();
  await st(() => window.__cosmos.setMode('space')); await wait(800);
});
await step('planets move, meteors and twinkling run, and can be turned off', async () => {
  await st(() => { const c = window.__cosmos; c.set({ skyEffects: true, fpsLimit: 60 }); c.clock.auto = true; c.clock.paused = false; c.goHome(); }); await flightDone(); await wait(600);
  const pos = () => st(() => [...window.__cosmos.view.nodes.get('earth').world]), a = await pos(); await wait(1200); const b = await pos(); ok(Math.hypot(a[0] - b[0], a[2] - b[2]) > 0.5, 'Earth did not visibly move'); ok(await st(() => window.__cosmos.clock.rate === 604800), 'auto speed');
  await until('sky meteor', () => window.__cosmos.view.effects.sky.items.some((s) => s && s.age / s.life > 0.5 && s.age / s.life < 0.8)); await shot('13-meteor');
  await st(() => window.__cosmos.focusBody('earth')); await flightDone(); await until('Earth meteor', () => window.__cosmos.view.effects.earth.items.some((s) => s && s.age / s.life > 0.45)); await shot('14-earth-meteors'); const em = await imageStats(420, 150, 500, 550); console.log('   Earth with meteors', em); ok(em.mean > 25, 'scene went black when a meteor appeared'); await st(() => window.__cosmos.focusBody('sun')); await flightDone(); await wait(800); await shot('15-sun-surface'); ok(await st(() => window.__cosmos.clock.rate === 3600), 'close-up speed');
  const sky = await st(() => ({ stars: window.__cosmos.view.starCount, belts: window.__cosmos.view.belts.count })); console.log('   sky objects', JSON.stringify(sky)); ok(sky.stars > 70000 && sky.belts > 10000, 'catalogues missing');
  await st(() => window.__cosmos.focusBody('jupiter')); await flightDone(); const spin = () => st(() => window.__cosmos.view.nodes.get('jupiter').mesh.quaternion.toArray()), q0 = await spin(); await wait(500); const q1 = await spin(); ok(Math.abs(q0[0] * q1[0] + q0[1] * q1[1] + q0[2] * q1[2] + q0[3] * q1[3]) < 0.9999, 'Jupiter is not rotating'); await shot('16-jupiter');
  await wait(1500); await shot('18-jupiter-moons'); const io = () => st(() => [...window.__cosmos.view.nodes.get('io').world].map((v, i) => v - window.__cosmos.view.nodes.get('jupiter').world[i])), i0 = await io(); await wait(600); const i1 = await io(); ok(Math.hypot(i0[0] - i1[0], i0[1] - i1[1], i0[2] - i1[2]) > 0.05, 'Io did not move'); ok(await page.locator('.body-label[data-body=ganymede]').count() === 1, 'no moon label'); await page.locator('.info .chip', { hasText: 'Europa' }).first().click(); await flightDone(); await wait(2500); ok(await st(() => window.__cosmos.view.focus === 'europa'), 'moon chip'); await shot('19-europa');
  await st(() => window.__cosmos.focusBody('saturn')); await flightDone(); await wait(2500); await shot('20-saturn-moons');
  await st(() => window.__cosmos.goHome()); await flightDone(); await until('busy sky', () => window.__cosmos.view.effects.active >= 3); await shot('17-busy-sky');
  await st(() => window.__cosmos.set({ skyEffects: false })); await wait(300); ok(await st(() => window.__cosmos.view.effects.active === 0), 'effects stayed on'); await st(() => window.__cosmos.set({ skyEffects: true }));
});
await step('Russian interface', async () => { await st(() => { window.__cosmos.set({ scale: 'educational' }); return window.__cosmos.changeLanguage('ru'); }); const x = await text(); ok(x.includes('Солнечная система') && x.includes('Галактика'), 'no Russian: ' + x.slice(0, 80)); ok(await st(() => [...document.querySelectorAll('.body-label span')].some((e) => e.textContent === 'Юпитер')), 'labels'); await st(() => window.__cosmos.focusBody('mars')); await flightDone(); await wait(600); await shot('21-russian'); await st(() => window.__cosmos.changeLanguage('en')); });
await step('galaxy explorer', async () => {
  await page.getByRole('button', { name: 'Galaxy', exact: true }).click(); await page.waitForFunction(() => window.__cosmos.mode === 'deep', null, { timeout: 30000 }); await wait(4200); await shot('22-milky-way'); const a = await st(() => window.__cosmos.view.stats().triangles + window.__cosmos.view.stats().calls); ok(a > 0, 'nothing drawn');
  const bright = await imageStats(300, 200, 800, 450); console.log('   Milky Way image', bright, 'fps', await st(() => Math.round(window.__cosmos.view.fps))); ok(bright.mean > 8 && bright.spread > 8, 'galaxy looks empty');
  await page.locator('.deep-bar .chip', { hasText: 'Andromeda' }).click(); await wait(4200); ok(await st(() => window.__cosmos.galaxy.focus === 'm31' && window.__cosmos.deepSelected === 'm31'), 'no focus'); ok((await text()).includes('million light-years'), 'no distance'); await shot('23-andromeda');
  await page.locator('.deep-bar .chip', { hasText: 'Sagittarius' }).click(); await wait(4200); await shot('24-black-hole'); const d = await st(() => window.__cosmos.view.targetDist); await page.mouse.move(500, 400); await page.mouse.wheel(0, 300); await wait(100); ok((await st(() => window.__cosmos.view.targetDist)) !== d, 'wheel'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await wait(300); ok(await st(() => window.__cosmos.mode === 'space' && !window.__cosmos.view.stage), 'did not return');
});
await step('Mars rover drives and surveys', async () => {
  await st(() => window.__cosmos.focusBody('mars')); await flightDone(); await page.getByRole('button', { name: 'Drive the rover' }).click(); await page.waitForFunction(() => window.__cosmos.mode === 'rover', null, { timeout: 40000 }); await wait(1500); await shot('25-rover'); const before = await st(() => window.__cosmos.rover.distance); await page.keyboard.down('KeyW'); await wait(2200); await page.keyboard.down('KeyA'); await wait(700); await page.keyboard.up('KeyA'); await page.keyboard.up('KeyW'); const s = await st(() => window.__cosmos.rover.status()); ok(s.distance > before + 3, 'did not drive: ' + s.distance); ok(Math.abs(s.heading) > 0.02, 'did not steer'); await shot('26-rover-driving');
  const r = await st(() => { const v = window.__cosmos.rover, q = v.status().targets[0]; v.x = q.x - 6; v.z = q.z - 6; v.speed = 0; return v.status().canScan; }); ok(r, 'target not reachable'); await wait(600); await shot('27-rover-target'); await page.keyboard.press('KeyE'); ok(await st(() => window.__cosmos.rover.status().scanned === 1), 'scan failed'); await page.keyboard.press('Escape'); await wait(300); ok(await st(() => window.__cosmos.mode === 'space' && window.__cosmos.view.focus === 'mars'), 'did not return'); await flightDone();
});
console.log('   main-thread stalls over 50 ms:', await st(() => { const l = window.__long.sort((a, b) => b - a); return `${l.length}, longest ${l.slice(0, 6).join(', ')} ms`; }));
await step('settings persist after restart', async () => { await wait(600); console.log('   before restart:', await st(async () => { const f = await window.cosmos.loadSettings(); return [f?.language, f?.welcomed, window.__cosmos.mode, document.documentElement.lang]; })); await app.close(); await launch(); await wait(900); console.log('   after restart:', await st(async () => { const f = await window.cosmos.loadSettings(); return [f?.language, f?.welcomed, document.documentElement.lang]; })); ok(await st(() => document.documentElement.lang === 'en'), 'language lost'); ok(!(await text()).includes('Start exploring'), 'welcome shown again'); });
console.log('   window events during test:', JSON.stringify(await app.evaluate(() => globalThis.__winEvents).catch(() => 'unavailable')));
await app.close().catch(() => {});
rmSync(profile, { recursive: true, force: true });
console.log('\nproblems:', problems.length ? JSON.stringify([...new Set(problems)].slice(0, 6)) : 'none');
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`${results.length - failed}/${results.length} steps passed`);
process.exit(failed || problems.length ? 1 : 0);
