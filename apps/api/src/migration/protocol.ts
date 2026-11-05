import { createHash, createHmac } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { MIGRATIONS_DIR } from '../database/migrator';

/**
 * Migrar um restaurante para outra instalação do Comandou (ADR 0011, nível 3). O que as duas
 * pontas combinam: as fases, o tamanho dos blocos, o manifesto do pacote e as respostas do
 * destino. A origem fala com o painel de destino (https://admin.<domínio de lá>) pelas rotas
 * /api/v1/platform/receive/*, com o token que o painel de lá gerou.
 */
export const PHASES = ['preparar', 'enviar', 'criar', 'restaurar', 'virar', 'encerrar'] as const;
export type Phase = (typeof PHASES)[number];
export type PhaseStatus = 'pendente' | 'rodando' | 'ok' | 'falhou' | 'pulada' | 'desfeita';

export interface PhaseRow {
  name: Phase;
  status: PhaseStatus;
  startedAt: string | null;
  finishedAt: string | null;
  detail: string | null;
}

export const emptyPhases = (): PhaseRow[] =>
  PHASES.map((name) => ({
    name,
    status: 'pendente',
    startedAt: null,
    finishedAt: null,
    detail: null,
  }));

/** Tamanho de cada bloco enviado (cabe folgado no limite do corpo da requisição). */
export const CHUNK_SIZE = 4 * 1024 * 1024;
/** Limite do corpo aceito pela rota de blocos. */
export const CHUNK_LIMIT = CHUNK_SIZE + 64 * 1024;
/** Maior pacote aceito (o destino guarda os blocos no banco central até restaurar). */
export const MAX_PACKAGE_BYTES = 20 * 1024 * 1024 * 1024;

/** Tabelas do banco central levadas junto com o restaurante (o resto é histórico da origem). */
export const CENTRAL_TABLES = [
  'tenants',
  'tenant_domains',
  'tenant_profiles',
  'subscriptions',
  'tenant_ai_settings',
  'billing_customers',
  'billing_cards',
] as const;
export type CentralRows = Partial<Record<(typeof CENTRAL_TABLES)[number] | 'plans', object[]>>;

/** O que a origem manda ao abrir o recebimento (tudo menos o banco, que vai em blocos). */
export interface Manifest {
  code: string;
  tenantId: string;
  slug: string;
  name: string;
  /** Endereço no destino (o mesmo, ou outro se lá já existir um igual). */
  targetSlug: string;
  mode: 'move' | 'copy';
  keepSuspended: boolean;
  /** Situação do restaurante antes da migração (provisioned ou suspended). */
  previousStatus: string;
  size: number;
  sha256: string;
  chunkSize: number;
  chunks: number;
  /** Migrações já aplicadas no banco do restaurante (o destino precisa ter todas). */
  migrations: string[];
  /** Linhas por tabela no banco do restaurante, contadas com ele parado. */
  counts: Record<string, number>;
  central: CentralRows;
  source: { url: string | null; version: string };
}

export interface Hello {
  ok: true;
  version: string;
  baseDomain: string;
  migrations: string[];
  /** Impressão da INTEGRATIONS_KEY (nunca a chave): igual = os tokens cifrados abrem lá. */
  keyFingerprint: string | null;
  worker: { alive: boolean; lastSeenAt: string | null };
  maxPackageBytes: number;
}

export type ReceptionStatus =
  'receiving' | 'installing' | 'restored' | 'active' | 'failed' | 'discarded';

export interface ReceptionView {
  id: string;
  status: ReceptionStatus;
  step: string | null;
  error: string | null;
  /** Blocos já gravados (índices). */
  received: number[];
  /** criar | restaurar: em qual parte da instalação o serviço de backup de lá está. */
  stage: 'criar' | 'restaurar' | null;
  result: Record<string, unknown>;
  url: string;
}

/** Impressão da chave: HMAC de um texto fixo, curto. Duas stacks com a mesma chave batem. */
export function keyFingerprint(keyB64: string | undefined | null): string | null {
  if (!keyB64) return null;
  return createHmac('sha256', Buffer.from(keyB64, 'base64'))
    .update('comandou:migracao:v1')
    .digest('hex')
    .slice(0, 16);
}

/** Contexto do token da stack de destino cifrado aqui (com o id da stack). */
export const STACK_TOKEN_CONTEXT = 'platform-stack-token';

export const tokenHash = (token: string) => createHash('sha256').update(token).digest();
export const tokenHint = (token: string) => `…${token.slice(-4)}`;

/** Migrações que esta imagem conhece (o destino precisa conhecer todas as do restaurante). */
export function knownMigrations(dir = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
}

/** Endereço do restaurante numa instalação: https://<endereço>.<domínio>. */
export function siteUrl(slug: string, baseDomain: string) {
  const local = /localhost$/.test(baseDomain);
  return `${local ? 'http' : 'https'}://${slug}.${baseDomain}`;
}

/** Normaliza o endereço do painel de destino: só esquema e host (sem caminho). */
export function normalizeStackUrl(raw: string): string {
  const u = new URL(raw.trim());
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('use https://');
  return `${u.protocol}//${u.host.toLowerCase()}`;
}

/** Código no formato do Frappe: MOV-AAAA-NNNNN. */
export const migrationCode = (year: number, n: number) =>
  `MOV-${year}-${String(n).padStart(5, '0')}`;
