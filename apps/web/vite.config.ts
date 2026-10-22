/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const API_TARGET = process.env.PEDEMAIS_API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'PedeMais',
        short_name: 'PedeMais',
        description: 'Gestão completa para restaurantes',
        lang: 'pt-BR',
        theme_color: '#5B21B6',
        background_color: '#0F0B1E',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Somente assets estáticos versionados vão para cache. A API NUNCA é cacheada pelo SW:
        // dados de restaurante, sessão e valores financeiros sempre vêm do servidor.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [{ urlPattern: /^\/api\//, handler: 'NetworkOnly' }],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    // Em dev, acesse http://<slug>.pedemais.localhost:5173 (*.localhost resolve para 127.0.0.1).
    allowedHosts: ['.pedemais.localhost', 'localhost'],
    proxy: {
      // changeOrigin=false preserva o Host do restaurante para a API resolver o tenant.
      '/api': { target: API_TARGET, changeOrigin: false, ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
  },
});
