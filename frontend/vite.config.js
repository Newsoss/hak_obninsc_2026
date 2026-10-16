import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// В Docker бэкенд доступен как http://backend:8000, локально — localhost
const target = process.env.API_PROXY_TARGET || 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': target,
      '/docs': target,
      '/openapi.json': target,
    },
  },
});
