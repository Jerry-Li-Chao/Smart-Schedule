/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// mode "gas" produces one self-contained HTML file that Google Apps Script can serve (the phone UI).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'gas' ? [react(), viteSingleFile()] : [react()],
  server: { port: 5173, strictPort: true },
  build: { outDir: mode === 'gas' ? 'dist-gas' : 'dist', emptyOutDir: true },
  test: { include: ['src/**/*.test.ts'] },
}));
