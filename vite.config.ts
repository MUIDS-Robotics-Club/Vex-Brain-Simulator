import { defineConfig } from 'vite';

// relative base so the built site works from any host path (including GitHub Pages)
export default defineConfig({
  base: './',
  build: { outDir: 'dist' },
  test: { include: ['tests/**/*.test.ts'] },
});
