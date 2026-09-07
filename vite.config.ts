import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SURVIVE AI — Vite configuration
// Dev server binds 0.0.0.0 so the sandbox preview proxy can reach it.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true, // accept sandbox preview proxy hosts
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
