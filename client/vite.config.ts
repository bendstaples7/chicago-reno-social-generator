import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Use VITE_API_TARGET env var to switch between Express (3001) and Worker (8787)
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
