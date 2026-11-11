import { INestApplication, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { Env } from './config/env';
import { CHUNK_LIMIT } from './migration/protocol';

export async function createApp(
  env: Env,
  opts: { logger?: boolean } = {},
): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    bufferLogs: true,
    logger: opts.logger === false ? false : undefined,
  });
  if (opts.logger !== false) app.useLogger(app.get(Logger));
  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);
  app.getHttpAdapter().getInstance().locals.loginRateLimit = env.AUTH_LOGIN_RATE_LIMIT;
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false })); // CSP do SPA é definida no Nginx.
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '256kb' });
  // Fotos (POST /media): o corpo é a própria imagem, já reduzida pelo navegador.
  app.useBodyParser('raw', { type: ['image/webp', 'image/jpeg', 'image/png'], limit: '3mb' });
  // Comprovante do Pix em PDF (o que o app do banco gera), até 3 MB.
  app.useBodyParser('raw', { type: 'application/pdf', limit: '3mb' });
  // Vídeos da conversa do cliente com a loja (até 20 MB; a rota confere tipo e assinatura).
  app.useBodyParser('raw', {
    type: ['video/mp4', 'video/webm', 'video/quicktime'],
    limit: '20mb',
  });
  // Modelo 3D do item do cardápio (GLB/USDZ, até 12 MB; a rota confere tipo e assinatura).
  app.useBodyParser('raw', { type: ['model/gltf-binary', 'model/vnd.usdz+zip'], limit: '12mb' });
  // Migrar cliente: blocos do pacote vindos da instalação de origem (rota confere o token).
  app.useBodyParser('raw', { type: 'application/octet-stream', limit: CHUNK_LIMIT });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  if (env.NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Comandou API')
        .setVersion('v1')
        .addCookieAuth('cm_sid')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
  }
  return app;
}
