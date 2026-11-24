/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const API_TARGET = process.env.COMANDOU_API_URL ?? 'http://localhost:3000';

/**
 * Identificador desta build. Vai embutido no app (__APP_BUILD__) e em /version.json; quando o
 * servidor passa a responder outro valor, o app aberto sabe que saiu versão nova.
 */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};
const APP_BUILD = `${pkg.version}+${Date.now().toString(36)}`;
/**
 * Versão de Novidades: a do package.json da raiz, que o teste de releases.ts mantém igual à última
 * entrada de Novidades; assim a lista inteira de novidades (pesada) só é baixada quando a tela
 * Novidades abre.
 */
const rootPkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};
/**
 * Versão mostrada no app (topo e login): a tag publicada pelo CI (v0.108.5 → 0.108.5), que é a
 * mesma do Super Admin › Infra. O CI cria correções (0.108.1, 0.108.2...) sem mexer no
 * package.json; fora do CI (dev, testes) vale a versão de Novidades.
 */
const shownVersion = process.env.COMANDOU_VERSION?.trim().replace(/^v/, '') || rootPkg.version;

function versionFile(): Plugin {
  return {
    name: 'comandou-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: pkg.version, build: APP_BUILD }),
      });
    },
  };
}

export default defineConfig({
  define: {
    __APP_BUILD__: JSON.stringify(APP_BUILD),
    __APP_VERSION__: JSON.stringify(shownVersion),
    __APP_RELEASE__: JSON.stringify(rootPkg.version),
  },
  plugins: [
    react(),
    versionFile(),
    VitePWA({
      // "prompt": a versão nova fica esperando e o app mostra o botão "Atualizar" (UpdatePrompt).
      // Trocar sozinho no meio de um pedido perderia o que estava na tela.
      registerType: 'prompt',
      // O manifesto não vai fixo no HTML: public/app-manifest.js escolhe o da tela antes de a
      // página abrir (cardápio e link do entregador têm o da loja). O do painel é
      // public/manifest.webmanifest.
      manifest: false,
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'manifest.webmanifest',
        'app-manifest.js',
        'boot.js',
      ],
      workbox: {
        // Somente assets estáticos versionados vão para cache. A API NUNCA é cacheada pelo SW:
        // dados de restaurante, sessão e valores financeiros sempre vêm do servidor.
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // O visualizador 3D e o descompactador de malhas só baixam quando alguém abre um modelo.
        // O panda dos e-mails (email/) é para o cliente de e-mail, não para o app.
        globIgnores: ['**/model-viewer*.js', 'vendor/**', 'email/**'],
        navigateFallback: '/index.html',
        // A prévia da Loja online (/pedir?previa=1) vem sempre do servidor, que permite a moldura.
        navigateFallbackDenylist: [/^\/api\//, /[?&]previa=1(&|$)/],
        runtimeCaching: [
          // Exceção: as fotos (GET /api/v1/media/<id>) são públicas e nunca mudam (trocar a foto
          // gera outro id). Guardadas no aparelho, o cardápio, o PDV e o garçom mostram as fotos
          // sem internet. Só resposta 200 e com limite de quantidade e idade.
          {
            urlPattern: ({ url, request, sameOrigin }) =>
              sameOrigin &&
              request.method === 'GET' &&
              /^\/api\/v1\/media\/[0-9a-f-]{36}$/i.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'comandou-fotos',
              expiration: {
                maxEntries: 600,
                maxAgeSeconds: 60 * 24 * 3600,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [200] },
            },
          },
          // A API nunca sai do cache (a RegExp do Workbox compara com o endereço inteiro).
          { urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' },
        ],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    // Em dev, acesse http://<slug>.comandou.localhost:5173 (*.localhost resolve para 127.0.0.1).
    allowedHosts: ['.comandou.localhost', 'localhost'],
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
