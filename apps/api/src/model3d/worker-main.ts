import 'reflect-metadata';
import { DynamicModule, Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createServer } from 'node:http';
import { ENV, Env, loadEnv, resolveFileSecrets } from '../config/env';
import { DatabaseModule } from '../database/database.module';
import { Model3dModule } from './model3d.module';

/**
 * Serviço model3d: o estúdio 3D rodando separado da API, na mesma imagem
 * (`node dist/model3d/worker-main.js`). Consome a fila "model3d" um trabalho por vez, com
 * memória própria: otimizar um escaneamento grande ou esperar a IA não pesa nas réplicas que
 * atendem os pedidos. Só fala com o banco e com o Redis; não recebe tráfego de fora.
 */
@Module({})
class WorkerModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: WorkerModule,
      global: true,
      imports: [DatabaseModule, Model3dModule],
      providers: [{ provide: ENV, useValue: env }],
      exports: [ENV],
    };
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('promessa rejeitada sem tratamento', reason);
});

async function main() {
  const env = loadEnv(resolveFileSecrets({ ...process.env, MODEL3D_WORKER: 'true' }));
  if (!env.REDIS_URL) throw new Error('O serviço model3d precisa do REDIS_URL (fila de trabalhos)');
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env));
  app.enableShutdownHooks();
  // Mesmo teste de saúde da imagem da API (HEALTHCHECK em :3000/api/v1/health/live).
  createServer((req, res) => {
    res.writeHead(req.url === '/api/v1/health/live' ? 200 : 404).end();
  }).listen(env.PORT, '0.0.0.0');
  new Logger('Model3d').log('serviço model3d no ar');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
