import { defineConfig } from 'vite';

// En dev, Vite sirve el cliente (5173) y reenvía el WebSocket /ws al servidor Node (3000).
// En producción, el propio servidor Node sirve dist/client en el puerto 3000.
export default defineConfig({
  root: '.',
  server: {
    host: true, // accesible desde la LAN también en dev
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
      '/api': { target: 'http://localhost:3000' },
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 800, // Three.js ocupa ~560 KB minificado
  },
});
