import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Testes de integração compartilham um banco real; rodar arquivos em série evita interferência.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    globalSetup: ['test/global-setup.ts'],
  },
});
