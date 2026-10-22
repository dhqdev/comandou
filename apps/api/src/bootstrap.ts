import { INestApplication, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { Env } from './config/env';

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
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  if (env.NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('PedeMais API')
        .setVersion('v1')
        .addCookieAuth('pm_sid')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
  }
  return app;
}
