// Copies the prebuilt Cesium runtime into the renderer's public folder. Cesium is loaded lazily at runtime.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/cesium/Build/Cesium');
const dest = join(root, 'src/renderer/public/cesium');
if (!existsSync(join(dest, 'Cesium.js'))) {
  mkdirSync(dest, { recursive: true });
  for (const item of ['Cesium.js', 'Workers', 'ThirdParty', 'Assets', 'Widgets']) cpSync(join(src, item), join(dest, item), { recursive: true });
  console.log('Cesium runtime copied');
}
rmSync(join(root, 'src/renderer/public/mediapipe'), { recursive: true, force: true });
cpSync(join(root, 'node_modules/@mediapipe/tasks-vision/wasm'), join(root, 'src/renderer/public/mediapipe'), { recursive: true, filter: (p) => !/vision_wasm_internal/.test(p) });
if (existsSync(join(root, 'build/icon.png'))) cpSync(join(root, 'build/icon.png'), join(root, 'src/renderer/public/icon.png'));
