import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  /** Conexão da API: papel pedemais_app (sem BYPASSRLS, não-dono das tabelas). */
  DATABASE_URL: z.string().url(),
  /** Conexão privilegiada (dono). Usada somente por migrações e provisionamento, nunca pela API. */
  DATABASE_OWNER_URL: z.string().url().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  /** Domínio base: <slug>.<PEDEMAIS_BASE_DOMAIN>. Ex.: pedemais.com (prod) ou pedemais.localhost (dev). */
  PEDEMAIS_BASE_DOMAIN: z
    .string()
    .regex(/^[a-z0-9.-]+$/)
    .default('pedemais.localhost'),
  /** Confiar em X-Forwarded-Host/Proto apenas quando atrás do Traefik. */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .positive()
    .max(24 * 30)
    .default(12),
  /** Cookie Secure=true exige HTTPS. Em dev local via http fica false. */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Tentativas de login por IP por minuto. */
  AUTH_LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(5),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração inválida: ${issues}`);
  }
  return parsed.data;
}

export const ENV = Symbol('ENV');
