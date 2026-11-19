import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

const root = process.cwd();
const cjs = (entry: string, outDir: string) => ({
  build: {
    outDir: resolve(root, outDir),
    rollupOptions: { input: resolve(root, entry), output: { format: 'cjs' as const, entryFileNames: 'index.cjs' } },
  },
});

export default defineConfig({
  main: cjs('src/main/index.ts', 'out/main'),
  preload: cjs('src/preload/index.ts', 'out/preload'),
  renderer: {
    root: resolve(root, 'src/renderer'),
    base: './',
    build: {
      outDir: resolve(root, 'out/renderer'),
      emptyOutDir: true,
      chunkSizeWarningLimit: 1500,
      rollupOptions: { input: resolve(root, 'src/renderer/index.html') },
    },
  },
});
