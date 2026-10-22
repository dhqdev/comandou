import { readFileSync } from 'node:fs';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  /** Conexão da API: papel comandou_app (sem BYPASSRLS, não-dono das tabelas). */
  DATABASE_URL: z.string().url(),
  /** Conexão privilegiada (dono). Usada somente por migrações e provisionamento, nunca pela API. */
  DATABASE_OWNER_URL: z.string().url().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  /** Domínio base: <slug>.<COMANDOU_BASE_DOMAIN>. Ex.: comandou.com (prod) ou comandou.localhost (dev). */
  COMANDOU_BASE_DOMAIN: z
    .string()
    .regex(/^[a-z0-9.-]+$/)
    .default('comandou.localhost'),
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
  /** Redis opcional: com mais de uma réplica da API, distribui eventos de tempo real entre elas. */
  REDIS_URL: z.string().url().optional(),
  /** Executa os consumidores das filas neste processo (desligue numa réplica só de HTTP). */
  QUEUE_WORKERS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Prefixo das chaves no Redis: filas e limite de requisições (isola ambientes que compartilham o Redis). */
  QUEUE_PREFIX: z
    .string()
    .regex(/^[a-z0-9_-]{1,40}$/)
    .default('comandou'),
  /**
   * Chave (32 bytes em base64) que cifra credenciais de integrações (token Focus NFe, sessões).
   * Sem ela, a configuração fiscal não aceita token.
   */
  INTEGRATIONS_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, '32 bytes em base64')
      .optional(),
  ),
  FOCUS_NFE_URL_HOMOLOGACAO: z.string().url().default('https://homologacao.focusnfe.com.br'),
  FOCUS_NFE_URL_PRODUCAO: z.string().url().default('https://api.focusnfe.com.br'),
  /** Graph API da Meta (WhatsApp Cloud API), com a versão no caminho. */
  WHATSAPP_GRAPH_URL: z.string().url().default('https://graph.facebook.com/v25.0'),
  /** Serviço interno de WhatsApp (Baileys/QR Code). Ex.: http://whatsapp-gateway:3100 */
  WHATSAPP_GATEWAY_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().url().optional(),
  ),
  WHATSAPP_GATEWAY_TOKEN: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(24).optional(),
  ),
  /**
   * Conexão do painel Super Admin: papel comandou_platform (sem BYPASSRLS, políticas próprias).
   * Sem ela, o painel (admin.<domínio base>) fica desligado.
   */
  PLATFORM_DATABASE_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().url().optional(),
  ),
  PLATFORM_SESSION_TTL_HOURS: z.coerce.number().int().positive().max(24).default(8),
  /** Sessão do painel expira após este tempo sem uso. */
  PLATFORM_IDLE_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .max(24 * 60)
    .default(30),
  /** Token do endpoint /api/v1/metrics (Prometheus). Sem ele, o endpoint não existe. */
  METRICS_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(24).optional()),
  /** Token do provider HTTP do Traefik (domínios personalizados). Sem ele, o endpoint não existe. */
  TRAEFIK_PROVIDER_TOKEN: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(24).optional(),
  ),
  TRAEFIK_ENTRYPOINT: z.string().default('websecure'),
  /** Resolver HTTP-01/TLS-ALPN para domínios de clientes (o *.comandou.com usa DNS-01). */
  TRAEFIK_CUSTOM_CERT_RESOLVER: z.string().default('letsencrypt-http'),
  /**
   * Alternativa ao certificado coringa: o provider HTTP também lista admin.<base> e <slug>.<base> de
   * cada restaurante ativo, e o Traefik emite um certificado (HTTP-01) para cada um.
   */
  TRAEFIK_TENANT_HOSTS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Resolver dos endereços de restaurantes. Vazio: usa TRAEFIK_CUSTOM_CERT_RESOLVER. */
  TRAEFIK_TENANT_CERT_RESOLVER: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().optional(),
  ),
  TRAEFIK_API_SERVICE: z.string().default('comandou-api@swarm'),
  TRAEFIK_WEB_SERVICE: z.string().default('comandou-web@swarm'),
  /** Requisições por minuto por IP em cada rota (padrão geral; algumas rotas têm limite próprio). */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  /** Tentativas de login por IP por minuto. */
  AUTH_LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(5),
  /**
   * Bloqueio temporário por conta: com N senhas erradas para o mesmo e-mail na janela, novas
   * tentativas recebem 429 até a janela passar (vale entre réplicas e IPs diferentes).
   */
  AUTH_ACCOUNT_LOCK_THRESHOLD: z.coerce.number().int().positive().default(10),
  AUTH_ACCOUNT_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  /** Intervalo da limpeza de dados vencidos (sessões antigas, chaves de idempotência). 0 desliga. */
  MAINTENANCE_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(360),
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

/** Variáveis que podem vir de arquivo (Docker secrets). Outras `*_FILE` do ambiente são ignoradas. */
export const FILE_SECRET_VARS = [
  'DATABASE_URL',
  'DATABASE_OWNER_URL',
  'REDIS_URL',
  'PROVISION_ADMIN_PASSWORD',
  'INTEGRATIONS_KEY',
  'WHATSAPP_GATEWAY_TOKEN',
  'PLATFORM_DATABASE_URL',
  'PLATFORM_ADMIN_PASSWORD',
  'PLATFORM_ADMIN_TOTP_SECRET',
  'METRICS_TOKEN',
  'TRAEFIK_PROVIDER_TOKEN',
] as const;

/**
 * Suporte a Docker secrets: VAR_FILE=/run/secrets/x vira VAR=<conteúdo do arquivo>.
 * Assim senhas não aparecem em `docker inspect` nem na definição da stack.
 * Só as variáveis da lista são lidas: o ambiente costuma ter outras `*_FILE`
 * (ex.: SSL_CERT_FILE) que não são segredos da aplicação.
 */
export function resolveFileSecrets(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...source };
  for (const target of FILE_SECRET_VARS) {
    const value = source[`${target}_FILE`];
    if (!value) continue;
    if (out[target]) continue;
    out[target] = readFileSync(value, 'utf8').trim();
  }
  return out;
}
