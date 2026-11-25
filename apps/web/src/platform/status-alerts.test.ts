import { describe, expect, it } from 'vitest';
import {
  badServices,
  newerVersion,
  queueText,
  serviceLevel,
  statusAlerts,
  type StatusInputs,
} from './status-alerts';
import type { Overview, ServerService, ServerStatus } from './types';

const now = new Date().toISOString();
const svc = (over: Partial<ServerService>): ServerService => ({
  id: over.name ?? 'x',
  name: 'comandou_api',
  stack: 'comandou',
  image: 'ghcr.io/x/comandou-api:v1.0.0',
  mode: 'replicated',
  desired: 1,
  running: 1,
  updatedAt: now,
  updateState: null,
  lastError: null,
  taskState: 'running',
  ...over,
});

const OVERVIEW: Overview = {
  version: '0.245.0',
  health: { database: 'ok', redis: 'ok', whatsappGateway: 'ok' },
  queue: { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 81 },
  tenants: { provisioned: 1 },
  subscriptions: {},
  business: {
    mrr: '0.00',
    paying: 0,
    pastDue: 0,
    trialing: 0,
    trialEndingSoon: 0,
    trialEnded: 0,
    courtesy: 0,
    blocked: 0,
    demo: 1,
    newLast30: 0,
    cancelledLast30: 0,
    overdue: '0.00',
    overdueCount: 0,
    paidMonth: '0.00',
  },
  support: { chatsWaiting: 0, ticketsOpen: 0, ticketsWaiting: 0 },
  usage: { ordersMonth: 0, sellingLast7: 0, live: 0, unreadable: [] },
  backups: {
    backup: { last: null, lastOkAt: now },
    restoreTest: { last: null, lastOkAt: now },
  },
  last7Days: { fiscalErrors: 0, messageFailures: 0 },
};

const server = (services: ServerService[]) =>
  ({
    enabled: true,
    host: { disks: [{ total: 100, free: 60 }] },
    docker: { services, containers: { total: 7, running: 7, list: [] } },
  }) as unknown as ServerStatus;

const texts = (i: Partial<StatusInputs>) =>
  statusAlerts({ data: OVERVIEW, ...i }).map((a) => a.text);

describe('Status do Super Admin', () => {
  it('a migração que terminou (0 de 1, tarefa completa) não é problema', () => {
    const migrate = svc({ name: 'comandou_migrate', running: 0, taskState: 'complete' });
    expect(serviceLevel(migrate)).toBe('ok');
    expect(badServices([migrate, svc({})])).toEqual([]);
    expect(texts({ server: server([migrate, svc({})]) })).toEqual([]);
    // Serviço que devia estar rodando e parou é problema.
    const down = svc({ name: 'comandou_web', running: 0, taskState: 'failed', lastError: 'oom' });
    expect(texts({ server: server([migrate, down]) })).toEqual([
      'Serviço comandou_web: 0 de 1 rodando (oom)',
    ]);
  });

  it('fila em português: "feitas" é histórico e não alerta; falha alerta', () => {
    expect(queueText(OVERVIEW.queue)).toMatchObject({
      value: '0 na fila',
      sub: '81 feitas',
      level: 'ok',
    });
    const q = queueText({ waiting: 2, active: 1, failed: 3, completed: 0 });
    expect(q).toMatchObject({ value: '3 na fila', level: 'warn', failed: 3 });
    expect(q.sub).toBe('1 rodando · 3 com falha');
    expect(queueText(null).value).toBe('sem Redis');
  });

  it('versão nova só quando a publicada é maior que a que roda', () => {
    expect(newerVersion('v0.246.0', '0.245.0')).toBe(true);
    expect(newerVersion('v0.245.0', '0.245.0')).toBe(false);
    expect(newerVersion('v0.244.9', '0.245.0')).toBe(false);
    expect(newerVersion('v1.0.0', '0.999.999')).toBe(true);
    expect(newerVersion(null, '0.245.0')).toBe(false);
  });

  it('junta o que pede ação, do mais grave para o menos, com a tela que resolve', () => {
    const list = statusAlerts({
      data: {
        ...OVERVIEW,
        business: { ...OVERVIEW.business!, overdueCount: 2, trialEnded: 1 },
        support: { chatsWaiting: 1, ticketsOpen: 3, ticketsWaiting: 1 },
      },
      backup: {
        enabled: false,
        configured: false,
        worker: { alive: true, lastSeenAt: now },
      } as StatusInputs['backup'],
      credentials: [
        { id: 'focus_master', configured: false, required: true },
        { id: 'pagbank', configured: false, required: false },
        { id: 'resend', configured: true, required: true, unreadable: true },
      ],
      platformWa: { configured: true, status: 'logged_out' },
      update: { latest: { version: 'v0.246.0', url: '', publishedAt: null }, job: null },
      sites: {
        checkedAt: now,
        baseDomain: 'comandou.com',
        whatsappGateway: 'ok',
        sites: [{ state: 'offline' }, { state: 'attention' }, { state: 'online' }] as NonNullable<
          StatusInputs['sites']
        >['sites'],
      },
    });
    expect(list[0]).toMatchObject({ level: 'bad', text: '1 site fora do ar', sites: 'offline' });
    expect(list.at(-1)).toMatchObject({ level: 'info', to: '/servidor' });
    const t = list.map((a) => a.text);
    expect(t).toContain('Falta cadastrar: Focus NFe, Resend');
    expect(t).toContain('O WhatsApp do painel está desconectado: leia o QR Code de novo');
    expect(t).toContain('2 faturas vencidas sem pagamento');
    expect(t).toContain('1 teste grátis acabou sem virar assinatura');
    expect(t).toContain('1 chamado espera a sua decisão');
    expect(t.some((x) => x.startsWith('Os backups ficam só neste servidor'))).toBe(true);
    // Opcional que falta não é alerta.
    expect(t.join()).not.toContain('PagBank');
  });
});
