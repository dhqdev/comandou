import { loadEnv, Env } from '../src/config/env';

export const OWNER_URL =
  process.env.TEST_DATABASE_OWNER_URL ??
  'postgres://pedemais_owner:owner_dev_pw@localhost:5432/pedemais_test';
export const APP_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://pedemais_app:app_dev_pw@localhost:5432/pedemais_test';
export const PLATFORM_URL =
  process.env.TEST_DATABASE_PLATFORM_URL ??
  'postgres://pedemais_platform:platform_dev_pw@localhost:5432/pedemais_test';

export function testEnv(overrides: Partial<Record<string, string>> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: APP_URL,
    DATABASE_OWNER_URL: OWNER_URL,
    PEDEMAIS_BASE_DOMAIN: 'pedemais.test',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}
