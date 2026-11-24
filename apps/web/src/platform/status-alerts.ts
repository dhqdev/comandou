import type {
  BackupSettings,
  Overview,
  PendingContract,
  ServerService,
  ServerStatus,
  SitesReport,
  UpdateInfo,
} from './types';
import type { CredentialItem } from './credentials/KeyInUse';
import { ago, levelFor, type Level } from './ui';

/**
 * Leituras da tela Status do Super Admin, sem React (testadas em status-alerts.test.ts): o que
 * é problema de verdade e o que é o normal de cada coisa.
 */

/** Serviço de execução única (migração) que já terminou bem: 0 rodando é o esperado. */
export const finishedService = (s: ServerService) => s.running === 0 && s.taskState === 'complete';

export function serviceLevel(s: ServerService): Level {
  if (s.desired === 0) return 'off';
  if (finishedService(s)) return 'ok';
  if (s.desired !== null && s.running < s.desired) return s.running === 0 ? 'bad' : 'warn';
  return 'ok';
}

/** Serviços com problema de verdade (o migrate que terminou bem e o desligado não contam). */
export const badServices = (list: ServerService[]) =>
  list.filter((s) => serviceLevel(s) !== 'ok' && s.desired !== 0);

/** Idade do último sucesso: alerta se o backup passou de 26 h ou o teste de 8 dias. */
export function ageLevel(at: string | null, warnHours: number): Level {
  if (!at) return 'bad';
  return (Date.now() - new Date(at).getTime()) / 3_600_000 > warnHours ? 'warn' : 'ok';
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;
/** A versão publicada é mais nova que a que está rodando? */
export function newerVersion(latest: string | null | undefined, running: string) {
  const a = latest ? SEMVER.exec(latest) : null;
  const b = SEMVER.exec(running);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++)
    if (Number(a[i]) !== Number(b[i])) return Number(a[i]) > Number(b[i]);
  return false;
}

/** Nome curto da credencial no alerta (o texto completo fica em Credenciais). */
const CRED_NAMES: Record<string, string> = {
  focus_master: 'Focus NFe',
  openrouter_clients: 'OpenRouter dos restaurantes',
  resend: 'Resend',
  asaas: 'Asaas',
  asaas_webhook: 'webhook do Asaas',
  integrations_key: 'chave mestra',
};

/** Credenciais necessárias que faltam ou não abrem (salvas com outra chave mestra). */
export function missingCredentials(items: CredentialItem[]) {
  return items.filter((i) => i.required && (i.configured === false || i.unreadable));
}

/** Fila de tarefas (BullMQ) em português; "feitas" é o histórico guardado, não um problema. */
export function queueText(q: Record<string, number> | null) {
  if (!q) return { value: 'sem Redis', sub: undefined, level: 'off' as Level, failed: 0 };
  if ('inline' in q)
    return {
      value: `${q.inline ?? 0} agendada(s)`,
      sub: 'sem Redis: roda dentro da API',
      level: 'warn' as Level,
      failed: 0,
    };
  const failed = q.failed ?? 0;
  const parts = [
    q.active ? `${q.active} rodando` : null,
    q.delayed ? `${q.delayed} para depois` : null,
    failed ? `${failed} com falha` : null,
    q.completed ? `${q.completed} feitas` : null,
  ].filter(Boolean);
  return {
    value: `${(q.waiting ?? 0) + (q.active ?? 0)} na fila`,
    sub: parts.join(' · ') || 'nada na fila',
    level: (failed ? 'warn' : 'ok') as Level,
    failed,
  };
}

export interface StatusAlert {
  level: Level;
  text: string;
  /** Tela que resolve (clicar leva até ela). */
  to?: string;
  /** Filtro da tabela de sites (em vez de mudar de tela). */
  sites?: 'offline' | 'attention';
}

export interface StatusInputs {
  data: Overview;
  server?: ServerStatus | null;
  backup?: BackupSettings | null;
  contracts?: PendingContract[] | null;
  sites?: SitesReport | null;
  credentials?: CredentialItem[] | null;
  platformWa?: { configured: boolean; status: string } | null;
  update?: UpdateInfo | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Tudo o que pede uma ação do Super Admin, do mais grave para o menos: cada item diz o que está
 * errado e leva à tela que resolve.
 */
export function statusAlerts(i: StatusInputs): StatusAlert[] {
  const { data } = i;
  const out: StatusAlert[] = [];

  for (const [label, st] of [
    ['Banco de dados central', data.health.database],
    ['Redis (filas e tempo real)', data.health.redis],
    ['Serviço do WhatsApp', data.health.whatsappGateway],
  ] as const)
    if (st === 'error') out.push({ level: 'bad', text: `${label} com falha`, to: '/servidor' });

  const sites = i.sites?.sites ?? [];
  const offline = sites.filter((s) => s.state === 'offline').length;
  const attention = sites.filter((s) => s.state === 'attention').length;
  if (offline)
    out.push({
      level: 'bad',
      text: `${plural(offline, 'site fora do ar', 'sites fora do ar')}`,
      sites: 'offline',
    });
  if (attention)
    out.push({
      level: 'warn',
      text: `${plural(attention, 'site pede atenção', 'sites pedem atenção')} (veja o motivo na lista)`,
      sites: 'attention',
    });

  const s = i.server?.enabled ? i.server : null;
  const docker = s && !('error' in s.docker) ? s.docker : null;
  for (const x of badServices(docker?.services ?? []))
    out.push({
      level: serviceLevel(x),
      text: `Serviço ${x.name}: ${x.running} de ${x.desired} rodando${x.lastError ? ` (${x.lastError})` : ''}`,
      to: '/servidor',
    });
  const disk = s?.host.disks[0];
  const diskPct = disk ? ((disk.total - disk.free) / disk.total) * 100 : null;
  if (diskPct !== null && diskPct > 80)
    out.push({
      level: levelFor(diskPct, 80, 90),
      text: `Disco do servidor em ${diskPct.toFixed(0)}%`,
      to: '/servidor',
    });

  const bk = i.backup;
  if (bk && !bk.worker.alive)
    out.push({ level: 'bad', text: 'Serviço de backup parado', to: '/servidor/backups' });
  const b = ageLevel(data.backups.backup.lastOkAt, 26);
  if (b !== 'ok')
    out.push({
      level: b,
      text: `Backup do banco central: último bom ${ago(data.backups.backup.lastOkAt)}`,
      to: '/servidor/backups',
    });
  const r = ageLevel(data.backups.restoreTest.lastOkAt, 24 * 8);
  if (r !== 'ok')
    out.push({
      level: r,
      text: `Teste de restauração: último bom ${ago(data.backups.restoreTest.lastOkAt)}`,
      to: '/servidor/backups',
    });
  if (bk && !(bk.enabled && bk.configured))
    out.push({
      level: 'warn',
      text: 'Os backups ficam só neste servidor: configure o Backblaze para ter uma cópia fora',
      to: '/credenciais#cred-backblaze',
    });

  const missing = missingCredentials(i.credentials ?? []);
  if (missing.length)
    out.push({
      level: 'warn',
      text: `Falta cadastrar: ${missing.map((m) => CRED_NAMES[m.id] ?? m.id).join(', ')}`,
      to: '/credenciais',
    });

  if (i.platformWa?.configured && i.platformWa.status !== 'connected')
    out.push({
      level: 'warn',
      text: 'O WhatsApp do painel está desconectado: leia o QR Code de novo',
      to: '/whatsapp',
    });

  const q = queueText(data.queue);
  if (q.failed)
    out.push({
      level: 'warn',
      text: `${plural(q.failed, 'tarefa falhou', 'tarefas falharam')} na fila (nota fiscal, WhatsApp ou e-mail)`,
      to: '/servidor',
    });

  for (const c of i.contracts ?? [])
    out.push({
      level: new Date(c.deadline).getTime() - Date.now() < 2 * 86400_000 ? 'bad' : 'warn',
      text: `Falta a sua assinatura no contrato ${c.number} (${c.tenantName}), até ${new Date(c.deadline).toLocaleDateString('pt-BR')}`,
      to: `/restaurantes/${c.tenantId}?aba=contrato&contrato=${c.id}`,
    });

  const biz = data.business;
  if (biz?.overdueCount)
    out.push({
      level: 'warn',
      text: `${plural(biz.overdueCount, 'fatura vencida', 'faturas vencidas')} sem pagamento`,
      to: '/cobranca',
    });
  if (biz?.trialEnded)
    out.push({
      level: 'warn',
      text: `${plural(biz.trialEnded, 'teste grátis acabou', 'testes grátis acabaram')} sem virar assinatura`,
      to: '/cobranca',
    });
  if (data.support?.ticketsWaiting)
    out.push({
      level: 'warn',
      text: `${plural(data.support.ticketsWaiting, 'chamado espera', 'chamados esperam')} a sua decisão`,
      to: '/chamados',
    });
  if (data.tenants.failed)
    out.push({
      level: 'warn',
      text: `${plural(data.tenants.failed, 'restaurante parou', 'restaurantes pararam')} no meio da criação`,
      to: '/restaurantes',
    });
  if (data.usage?.unreadable.length)
    out.push({
      level: 'warn',
      text: `Não consegui ler o uso de ${plural(data.usage.unreadable.length, 'banco próprio', 'bancos próprios')}: ${data.usage.unreadable.join(', ')}`,
      to: '/servidor/bancos',
    });
  if (newerVersion(i.update?.latest?.version, data.version))
    out.push({
      level: 'info',
      text: `Versão nova publicada: ${i.update!.latest!.version} (este servidor está na v${data.version})`,
      to: '/servidor',
    });

  const rank: Record<Level, number> = { bad: 0, warn: 1, info: 2, ok: 3, off: 4 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
