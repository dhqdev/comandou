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
  // Banco próprio por restaurante (ADR 0011): "dedicated" cria cada restaurante novo no seu
  // banco (pelo serviço de backup); "shared" mantém o modo antigo, tudo no banco central.
  TENANT_DATABASE_MODE: z.enum(['dedicated', 'shared']).default('dedicated'),
  // Conexões por banco de restaurante em cada réplica da API (abertas sob demanda).
  TENANT_DATABASE_POOL_MAX: z.coerce.number().int().positive().max(20).default(3),
  /**
   * Isolamento entre restaurantes. Uma consulta da API que passar disso é cancelada pelo Postgres
   * (0 = sem limite), para um relatório travado de um restaurante não segurar conexões de todos.
   */
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(60_000),
  /** Espera máxima por uma conexão livre; depois disso a requisição recebe 503 em vez de travar. */
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  /**
   * Transações ao mesmo tempo de um mesmo restaurante, em cada réplica (0 = sem limite). O resto
   * espera na fila dele, sem ocupar as conexões que os outros restaurantes usam.
   */
  TENANT_MAX_CONCURRENT_TX: z.coerce.number().int().min(0).default(5),
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
  /**
   * "Manter conectado" no login do restaurante: a sessão vale estes dias e se renova a cada uso,
   * então quem usa o aparelho pelo menos uma vez nesse prazo não precisa entrar de novo.
   */
  SESSION_REMEMBER_DAYS: z.coerce.number().int().positive().max(180).default(60),
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
  /**
   * Token master da conta Focus NFe do Comandou (modo revenda). Com ele o painel cadastra a empresa
   * do restaurante na Focus (certificado A1 + CSC) sem o lojista ter conta lá. Sem ele, só o modo
   * "token próprio" fica disponível.
   */
  FOCUS_NFE_MASTER_TOKEN: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(8).optional(),
  ),
  /**
   * PagBank (pagamento pelo app). Credenciais ficam no painel Super Admin, cifradas no banco;
   * aqui só os endereços (os testes apontam para um PagBank falso).
   */
  PAGBANK_API_URL_SANDBOX: z.string().url().default('https://sandbox.api.pagseguro.com'),
  PAGBANK_API_URL_PRODUCAO: z.string().url().default('https://api.pagseguro.com'),
  PAGBANK_CONNECT_URL_SANDBOX: z
    .string()
    .url()
    .default('https://connect.sandbox.pagbank.com.br/oauth2/authorize'),
  PAGBANK_CONNECT_URL_PRODUCAO: z
    .string()
    .url()
    .default('https://connect.pagbank.com.br/oauth2/authorize'),
  /** Graph API da Meta (WhatsApp Cloud API), com a versão no caminho. */
  WHATSAPP_GRAPH_URL: z.string().url().default('https://graph.facebook.com/v25.0'),
  /** OpenRouter (assistente de IA). A chave fica no painel Super Admin, cifrada no banco. */
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  // Modelo que lê foto e PDF na importação do cardápio (precisa aceitar imagem).
  AI_IMPORT_MODEL: z.string().min(3).max(120).default('google/gemini-2.5-flash'),
  // Modelo que cria a foto ilustrativa de um item sem foto (primeiros passos).
  AI_IMAGE_MODEL: z.string().min(3).max(120).default('google/gemini-2.5-flash-image'),
  /**
   * Integração com o iFood (cardápio). Credenciais do aplicativo do Comandou no Portal do
   * Desenvolvedor do iFood. Sem elas, o cardápio de integração fica indisponível.
   * centralized = um app para todas as lojas (cada loja autoriza no Portal do Parceiro);
   * distributed = cada loja autoriza com um código (userCode) e o Comandou guarda o refresh token.
   */
  IFOOD_API_URL: z.string().url().default('https://merchant-api.ifood.com.br'),
  IFOOD_APP_MODE: z.enum(['centralized', 'distributed']).default('centralized'),
  /** Keeta (Open Delivery 1.5 com ajustes): base da API. As chaves ficam em Super Admin › Credenciais. */
  KEETA_API_URL: z.string().url().default('https://open.mykeeta.com/api/open/opendelivery'),
  /** 99Food pelo Open Delivery (token por loja, polling): base da API. Chaves em Credenciais. */
  FOOD99_API_URL: z.string().url().default('https://openapi.99food.com/v4/opendelivery'),
  /** Rappi (Orders Rests API): domínio do Brasil. Chaves e segredo do webhook em Credenciais. */
  RAPPI_API_URL: z.string().url().default('https://api.rappi.com.br'),
  IFOOD_CLIENT_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(8).optional()),
  IFOOD_CLIENT_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(8).optional(),
  ),
  /** Segundos de espera depois de uma alteração antes de mandar ao iFood (junta várias edições). */
  IFOOD_SYNC_DELAY_SECONDS: z.coerce.number().int().min(0).max(3600).default(20),
  /**
   * Aplicativos de delivery (ADR 0015). De quantos em quantos segundos buscar eventos (0 = não
   * busca nesta réplica). Fora dos testes, nunca menos de 30 s (regra do iFood).
   */
  CHANNELS_POLL_SECONDS: z.coerce.number().int().min(0).max(3600).default(30),
  /** Intervalo mínimo entre dois pollings da mesma credencial, entre todas as réplicas. */
  CHANNELS_POLL_MIN_SECONDS: z.coerce.number().int().min(0).max(3600).default(30),
  /** Duração da trava do polling: se a réplica cair, outra assume depois disso. */
  CHANNELS_LEASE_SECONDS: z.coerce.number().int().min(5).max(900).default(90),
  /** Varredura da caixa de entrada e de saída (o que ficou para trás depois de uma queda). */
  CHANNELS_SWEEP_SECONDS: z.coerce.number().int().min(0).max(3600).default(20),
  /** API do GitHub usada pela esteira de chamados (troca só nos testes). */
  GITHUB_API_URL: z.string().url().default('https://api.github.com'),
  /** De quantos em quantos segundos a esteira de chamados procura trabalho (0 = parada). */
  TICKETS_PIPELINE_SECONDS: z.coerce.number().int().min(0).max(3600).default(10),
  /** Busca de endereço (Nominatim/OpenStreetMap) usada nas áreas de entrega. */
  GEOCODER_URL: z.string().url().default('https://nominatim.openstreetmap.org'),
  /**
   * Photon (komoot): reserva da busca de endereço, tolerante a palavra a mais ou com erro.
   * Vazio desliga.
   */
  PHOTON_URL: z.union([z.string().url(), z.literal('')]).default('https://photon.komoot.io'),
  /**
   * Consulta de CEP: ViaCEP (principal, também acha o CEP pela rua), BrasilAPI e OpenCEP
   * (reservas quando a ViaCEP falha ou não conhece o CEP).
   */
  VIACEP_URL: z.string().url().default('https://viacep.com.br'),
  BRASILAPI_URL: z.string().url().default('https://brasilapi.com.br'),
  OPENCEP_URL: z.string().url().default('https://opencep.com'),
  /**
   * Porta do teste "site no ar" do painel (https://<slug>.<base>:<porta>/api/v1/health/site).
   * Vazia = porta padrão (443 com COOKIE_SECURE=true, 80 sem). Em dev local: 5173 (Vite).
   */
  SITE_CHECK_PORT: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(1).max(65535).optional(),
  ),
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
  /**
   * Sessão do painel com "Lembrar este aparelho": vale estes dias, renovada a cada uso e sem o
   * limite de inatividade. Ações sensíveis (assinar contrato) continuam pedindo o código.
   */
  PLATFORM_REMEMBER_DAYS: z.coerce.number().int().positive().max(90).default(30),
  /** Token do endpoint /api/v1/metrics (Prometheus). Sem ele, o endpoint não existe. */
  METRICS_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(24).optional()),
  /** Agente do servidor (painel Super Admin → Servidor). Sem URL, a tela mostra "não instalado". */
  /** Repositório (dono/nome) onde o painel procura a última versão publicada. */
  UPDATE_RELEASES_REPO: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/)
    .default('dhqdev/comandou'),
  /**
   * Token do GitHub (só leitura) para achar a última versão com o repositório privado. Sem ele,
   * o painel olha as tags das imagens no GHCR, que basta enquanto os pacotes forem públicos.
   */
  UPDATE_GITHUB_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  /** Prefixo das imagens do Comandou no GHCR (mesmo valor de AGENT_IMAGE_PREFIX do agente). */
  UPDATE_IMAGE_PREFIX: z.string().default('ghcr.io/dhqdev/comandou-'),
  HOST_AGENT_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  HOST_AGENT_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(24).optional()),
  /**
   * Métricas por restaurante (rótulo = slug, sem rota): uso de cada cliente para decidir quem
   * precisa de banco dedicado (ADR 0011). Desligado por padrão.
   */
  METRICS_PER_TENANT: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
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
  /**
   * Site público no domínio base (comandou.com e www.comandou.com): o provider HTTP lista os dois
   * endereços. Desligue se o domínio base apontar para outro servidor.
   */
  TRAEFIK_SITE_HOSTS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Resolver dos endereços de restaurantes. Vazio: usa TRAEFIK_CUSTOM_CERT_RESOLVER. */
  TRAEFIK_TENANT_CERT_RESOLVER: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().optional(),
  ),
  /**
   * Versão desta imagem (tag publicada pelo CI, ex.: v0.110.2; vem do build). Com ela, a
   * migração deixa de fora os restaurantes que ficaram em outra versão e o painel sabe qual é a
   * versão principal. Vazio (desenvolvimento): tudo segue junto, como antes.
   */
  COMANDOU_VERSION: z.preprocess((v) => {
    // Valor fora do formato (ex.: "latest") não derruba a API: só fica sem versão.
    const t = typeof v === 'string' ? v.trim().replace(/^v?/, 'v') : '';
    return /^v\d+\.\d+\.\d+$/.test(t) ? t : undefined;
  }, z.string().optional()),
  TRAEFIK_API_SERVICE: z.string().default('comandou-api@swarm'),
  TRAEFIK_WEB_SERVICE: z.string().default('comandou-web@swarm'),
  /**
   * CrowdSec (docs/crowdsec.md): com o bouncer ligado, o provider HTTP passa todas as rotas pelo
   * middleware do plugin do CrowdSec no Traefik, menos os caminhos que nunca podem ser
   * bloqueados (webhook do Asaas, teste de status, métricas). Ligue depois de o Traefik ter o
   * plugin (scripts/crowdsec.sh faz nessa ordem); sem o plugin, roteadores de reserva mantêm os
   * sites no ar, só sem bloqueio.
   */
  CROWDSEC_BOUNCER: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Nome do plugin na configuração estática do Traefik (experimental.plugins.<nome>). */
  CROWDSEC_PLUGIN_NAME: z.string().default('crowdsec'),
  /** LAPI do CrowdSec (host:porta) vista pelo Traefik, na rede network_public. */
  CROWDSEC_LAPI_HOST: z.string().default('crowdsec_crowdsec:8080'),
  /** Chave do bouncer (a mesma do secret comandou_crowdsec_bouncer_key). */
  CROWDSEC_BOUNCER_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(16).optional(),
  ),
  /** IPs ou faixas (separados por vírgula) que o bouncer nunca bloqueia, além das redes privadas. */
  CROWDSEC_TRUSTED_IPS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
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
  /** Ciclo da cobrança (faturas, vencidas, bloqueio automático). 0 desliga. */
  BILLING_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(30),
  /** Conferência do pagamento pelo app (pendentes, vencidos, lançar no caixa, devolver). 0 desliga. */
  /**
   * Atualizações de restaurante agendadas no painel e limpeza das versões antigas que ninguém
   * usa mais (0 desliga; as cópias de versões antigas rodam com 0).
   */
  TENANT_UPDATE_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(60),
  ONLINE_PAY_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(60),
  /** Lembretes da Agenda pelo WhatsApp: de quanto em quanto tempo procura os que venceram. 0 desliga. */
  AGENDA_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(60),
  /** Endereço da API do Asaas (só para testes; o painel escolhe sandbox ou produção). */
  ASAAS_BASE_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
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
  'TENANT_DATABASE_OWNER_URLS',
  'DATABASE_ADMIN_URL',
  'POSTGRES_PASSWORD',
  'REDIS_URL',
  'PROVISION_ADMIN_PASSWORD',
  'INTEGRATIONS_KEY',
  'FOCUS_NFE_MASTER_TOKEN',
  'IFOOD_CLIENT_SECRET',
  'WHATSAPP_GATEWAY_TOKEN',
  'PLATFORM_DATABASE_URL',
  'PLATFORM_ADMIN_PASSWORD',
  'PLATFORM_ADMIN_TOTP_SECRET',
  'METRICS_TOKEN',
  'TRAEFIK_PROVIDER_TOKEN',
  'CROWDSEC_BOUNCER_KEY',
  'HOST_AGENT_TOKEN',
  'UPDATE_GITHUB_TOKEN',
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
