import { loadEnv, Env } from '../src/config/env';

export const OWNER_URL =
  process.env.TEST_DATABASE_OWNER_URL ??
  'postgres://comandou_owner:owner_dev_pw@localhost:5432/comandou_test';
export const APP_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://comandou_app:app_dev_pw@localhost:5432/comandou_test';
export const PLATFORM_URL =
  process.env.TEST_DATABASE_PLATFORM_URL ??
  'postgres://comandou_platform:platform_dev_pw@localhost:5432/comandou_test';

/** Segundo banco (simula um banco dedicado) para testar migrações em lista. */
export const DEDICATED_OWNER_URL =
  process.env.TEST_DATABASE_DEDICATED_OWNER_URL ??
  'postgres://comandou_owner:owner_dev_pw@localhost:5432/comandou_dedicado_test';

export function testEnv(overrides: Partial<Record<string, string>> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: APP_URL,
    DATABASE_OWNER_URL: OWNER_URL,
    COMANDOU_BASE_DOMAIN: 'comandou.test',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}
