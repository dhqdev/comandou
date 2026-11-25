import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { GatewayClient } from '../messaging/gateway.client';
import { PLATFORM_WA_ID } from '../messaging/whatsapp-inbound.service';
import { PlatformBackupService } from '../platform/platform-backup.service';
import { PlatformCacheService } from '../platform/platform-cache.service';
import { PlatformDb, platformAudit } from '../platform/platform-db.service';
import type { Actor } from '../platform/platform.service';
import { PlatformWaChecks } from './admin-checks.service';
import {
  clip,
  CONFIRM,
  HELP,
  isHelp,
  isHome,
  isYes,
  mainMenu,
  normalizeInput,
  optionOf,
  PendingAction,
  PICK_LIMIT,
  pickList,
  Screen,
  STATE_TTL_MS,
  tenantMenu,
} from './admin-menu';
import { PlatformWaOutbox } from './platform-wa-outbox.service';

/** Número cadastrado em Super Admin › WhatsApp › Menu do admin. */
export interface Operator {
  id: string;
  phone: string;
  label: string | null;
  adminId: string;
  adminName: string;
  adminEmail: string;
  alerts: boolean;
  summary: boolean;
}

interface State {
  screen: Screen;
  tenantId: string | null;
  choices: string[];
  pending: PendingAction | null;
  updatedAt: Date;
}

const FRESH: State = {
  screen: 'main',
  tenantId: null,
  choices: [],
  pending: null,
  updatedAt: new Date(0),
};

/** Mesma comparação de telefone do serviço (DDD + 8 últimos dígitos). */
const KEY_SQL = (col: string) =>
  `(CASE WHEN length(${col}) >= 12 AND left(${col}, 2) = '55' THEN substr(${col}, 3, 2)
         ELSE left(${col}, 2) END) || right(${col}, 8)`;

export const OPERATOR_COLS = `o.id, o.phone, o.label, o.admin_id AS "adminId", a.name AS "adminName",
  a.email::text AS "adminEmail", o.alerts, o.summary`;

/**
 * Menu do Super Admin pelo WhatsApp do painel. Só responde a números cadastrados (de um Super
 * Admin ativo); qualquer outra pessoa segue só na conversa do painel, sem resposta automática.
 * Leitura à vontade; o que muda algo (backup agora, teste de restauração, limpar cache) pede SIM
 * e entra no histórico do painel no nome do Super Admin dono do número.
 */
@Injectable()
export class PlatformWaBot {
  private readonly logger = new Logger('PlatformWaBot');

  constructor(
    private readonly pdb: PlatformDb,
    private readonly outbox: PlatformWaOutbox,
    private readonly gateway: GatewayClient,
    private readonly checks: PlatformWaChecks,
    private readonly backup: PlatformBackupService,
    private readonly cache: PlatformCacheService,
  ) {}

  /** Número de Super Admin ativo com este telefone (menu ligado). */
  async operatorFor(phone: string | null): Promise<Operator | null> {
    if (!phone || !this.pdb.enabled) return null;
    const [o] = await this.pdb.query<Operator>(
      `SELECT ${OPERATOR_COLS} FROM platform_wa_operators o
         JOIN platform_admins a ON a.id = o.admin_id AND a.disabled_at IS NULL
         JOIN platform_wa_bot_settings s ON s.id AND s.enabled
        WHERE ${KEY_SQL('o.phone')} = ${KEY_SQL('$1::text')} LIMIT 1`,
      [phone],
    );
    return o ?? null;
  }

  /** Mensagem de texto que chegou e já foi gravada na conversa do painel. */
  async handle(chat: { jid: string; phone: string | null; waId: string }, text: string) {
    const op = await this.operatorFor(chat.phone);
    if (!op) return;
    // Conversa do menu não fica como "não lida" no painel; a mensagem fica azul no celular.
    await this.pdb.query(`UPDATE platform_wa_chats SET unread = 0 WHERE jid = $1`, [chat.jid]);
    if (this.gateway.configured)
      void this.gateway
        .markRead(PLATFORM_WA_ID, chat.jid, chat.waId)
        .catch((e: Error) => this.logger.warn(`marcar como lida: ${e.message}`));
    let reply: string;
    try {
      reply = await this.answer(op, text);
    } catch (e) {
      this.logger.warn(`menu: ${(e as Error).message}`);
      reply = `Não consegui ler isso agora: ${(e as Error).message.slice(0, 160)}\n\n_0 = menu_`;
    }
    await this.outbox.deliver(chat.jid, clip(reply), null, chat.jid, chat.phone);
  }

  /* ------------------------------------------------------------------ estado */

  private async load(op: Operator): Promise<State> {
    const [s] = await this.pdb.query<State>(
      `SELECT screen, tenant_id AS "tenantId", choices, pending, updated_at AS "updatedAt"
         FROM platform_wa_bot_state WHERE operator_id = $1`,
      [op.id],
    );
    if (!s) return { ...FRESH };
    // Parado há muito tempo: volta ao começo, mas lembra o último restaurante (atalho "r").
    if (Date.now() - new Date(s.updatedAt).getTime() > STATE_TTL_MS)
      return { ...FRESH, tenantId: s.tenantId };
    return s;
  }

  private async save(op: Operator, s: State) {
    await this.pdb.query(
      `INSERT INTO platform_wa_bot_state (operator_id, screen, tenant_id, choices, pending, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (operator_id) DO UPDATE SET screen = $2, tenant_id = $3, choices = $4,
         pending = $5, updated_at = now()`,
      [op.id, s.screen, s.tenantId, JSON.stringify(s.choices), s.pending],
    );
  }

  /* ------------------------------------------------------------------ conversa */

  /** Responde uma mensagem do Super Admin e grava onde a conversa parou. */
  async answer(op: Operator, raw: string): Promise<string> {
    const s = await this.load(op);
    const t = normalizeInput(raw);
    const pending = s.pending;
    s.pending = null;
    let reply: string;
    if (pending && isYes(t)) reply = await this.run(op, pending, s);
    else if (pending && t) reply = `Ok, não fiz nada.\n\n${await this.route(op, s, t)}`;
    else reply = await this.route(op, s, t);
    await this.save(op, s);
    return reply;
  }

  private async home(op: Operator, s: State) {
    s.screen = 'main';
    s.choices = [];
    const last = s.tenantId ? await this.checks.tenantHead(s.tenantId) : null;
    return mainMenu(op.adminName, last?.name ?? null);
  }

  private async route(op: Operator, s: State, t: string): Promise<string> {
    if (!t || isHome(t)) return this.home(op, s);
    if (isHelp(t)) return HELP;
    if (t === 'r' && s.tenantId) return this.openTenant(s, s.tenantId);
    const n = optionOf(t);
    if (n === 0 && s.screen !== 'pick') return this.home(op, s);
    switch (s.screen) {
      case 'pick':
        if (n === 0) return this.home(op, s);
        if (n !== null) {
          const id = s.choices[n - 1];
          if (!id) return `Não tem a opção ${n} na lista. Responda outro número ou digite o nome.`;
          return this.openTenant(s, id);
        }
        return this.search(s, t);
      case 'tenant':
        if (n !== null && s.tenantId) return this.tenantOption(op, s, n);
        return this.search(s, t);
      case 'backups':
        if (n === 1) return this.ask(s, 'backup');
        if (n === 2) return this.ask(s, 'restore_test');
        break;
      case 'alerts':
        if (n === 1 || n === 2) return this.toggle(op, s, n === 1 ? 'alerts' : 'summary');
        break;
    }
    if (n !== null) return this.mainOption(op, s, n);
    // Texto solto: busca um restaurante pelo nome.
    return this.search(s, t);
  }

  private async mainOption(op: Operator, s: State, n: number): Promise<string> {
    s.screen = 'main';
    switch (n) {
      case 1:
        return this.withFooter(await this.checks.summary());
      case 2: {
        const list = await this.checks.findTenants(null, PICK_LIMIT);
        s.screen = 'pick';
        s.choices = list.map((x) => x.id);
        return pickList('*Escolha o restaurante* (mais recentes)', list);
      }
      case 3:
        return this.withFooter(await this.checks.health());
      case 4:
        return this.withFooter(await this.checks.issuesText());
      case 5:
        s.screen = 'backups';
        return this.checks.backups();
      case 6:
        return this.withFooter(await this.checks.servers());
      case 7:
        return this.withFooter(await this.checks.newcomers());
      case 8:
        return this.withFooter(await this.checks.billing());
      case 9:
        s.screen = 'alerts';
        return this.alertsScreen(op);
      default:
        return `Não tem a opção ${n}.\n\n${await this.home(op, s)}`;
    }
  }

  private withFooter(text: string, tenant = false) {
    return `${text}\n\n_${tenant ? 'Outra opção do restaurante, 8 = trocar, 0 = menu' : '0 = menu'}_`;
  }

  private async search(s: State, q: string): Promise<string> {
    if (q.length < 2) return 'Digite pelo menos 2 letras do nome, ou *0* para o menu.';
    const list = await this.checks.findTenants(q, PICK_LIMIT);
    if (list.length === 1) return this.openTenant(s, list[0].id);
    s.screen = 'pick';
    s.choices = list.map((x) => x.id);
    return pickList(`*Restaurantes com "${q.slice(0, 40)}"*`, list);
  }

  private async openTenant(s: State, id: string): Promise<string> {
    const t = await this.checks.tenantHead(id);
    if (!t) {
      s.tenantId = null;
      s.screen = 'main';
      return 'Esse restaurante não existe mais. *0* = menu.';
    }
    s.tenantId = id;
    s.screen = 'tenant';
    s.choices = [];
    return tenantMenu(t);
  }

  private async tenantOption(op: Operator, s: State, n: number): Promise<string> {
    const id = s.tenantId!;
    const run = async (f: () => Promise<string>) => this.withFooter(await f(), true);
    switch (n) {
      case 1:
        return run(() => this.checks.tenantOverview(id));
      case 2:
        return run(() => this.checks.tenantMovement(id));
      case 3:
        return run(async () => (await this.checks.tenantScan(id)).text);
      case 4:
        return run(() => this.checks.tenantTeam(id));
      case 5:
        return run(() => this.checks.tenantHistory(id));
      case 6:
        return run(() => this.checks.tenantDatabase(id));
      case 7:
        return this.ask(s, 'clear_cache');
      case 8: {
        const list = await this.checks.findTenants(null, PICK_LIMIT);
        s.screen = 'pick';
        s.choices = list.map((x) => x.id);
        return pickList('*Escolha o restaurante* (mais recentes)', list);
      }
      default: {
        const t = await this.checks.tenantHead(id);
        return `Não tem a opção ${n}.\n\n${t ? tenantMenu(t) : ''}`;
      }
    }
  }

  private ask(s: State, a: PendingAction) {
    s.pending = a;
    return CONFIRM[a];
  }

  /** Ação confirmada com SIM. Entra no histórico do painel no nome do dono do número. */
  private async run(op: Operator, a: PendingAction, s: State): Promise<string> {
    const actor: Actor = {
      admin: { id: op.adminId, email: op.adminEmail, name: op.adminName, sessionId: '' },
    };
    const note = (c: PoolClient) =>
      platformAudit(c, {
        adminId: op.adminId,
        action: 'whatsapp.menu_action',
        entity: 'whatsapp',
        entityId: op.id,
        tenantId: a === 'clear_cache' ? s.tenantId : null,
        data: { action: a },
      });
    try {
      if (a === 'backup' || a === 'restore_test') {
        await this.backup.request(a, actor);
        await this.pdb.tx(note);
        s.screen = 'backups';
        return a === 'backup'
          ? '⏳ Backup pedido. O serviço de backup começa em até 1 minuto; se falhar, aviso aqui.\n\n_0 = menu_'
          : '⏳ Teste de restauração pedido. Se falhar, aviso aqui.\n\n_0 = menu_';
      }
      if (!s.tenantId) return 'Escolha um restaurante antes. *0* = menu.';
      const r = await this.cache.clear(s.tenantId, actor);
      await this.pdb.tx(note);
      return this.withFooter(
        `✅ Cache limpo. ${r.screens} tela(s) aberta(s) recarregaram; as fechadas limpam quando abrirem.`,
        true,
      );
    } catch (e) {
      return `🔴 Não deu certo: ${(e as Error).message.slice(0, 200)}\n\n_0 = menu_`;
    }
  }

  /* ------------------------------------------------------------------ avisos */

  private async alertsScreen(op: Operator) {
    const [st] = await this.pdb.query<{ summaryHour: number | null }>(
      `SELECT summary_hour AS "summaryHour" FROM platform_wa_bot_settings WHERE id`,
    );
    const hour = st?.summaryHour;
    return [
      '*Meus avisos neste número*',
      '',
      `1. Avisos automáticos: ${op.alerts ? '✅ ligados' : '⚪ desligados'}`,
      '   _backup que falhou, serviço fora do ar, banco que não ficou pronto, restaurante novo, assinatura em atraso_',
      `2. Resumo do dia: ${op.summary ? '✅ ligado' : '⚪ desligado'}${hour != null ? ` (às ${hour}h)` : ' (horário desligado no painel)'}`,
      '',
      '_Responda 1 ou 2 para trocar. 0 = menu._',
    ].join('\n');
  }

  private async toggle(op: Operator, s: State, col: 'alerts' | 'summary') {
    const [r] = await this.pdb.query<{ alerts: boolean; summary: boolean }>(
      `UPDATE platform_wa_operators SET ${col} = NOT ${col} WHERE id = $1 RETURNING alerts, summary`,
      [op.id],
    );
    s.screen = 'alerts';
    return this.alertsScreen({ ...op, ...r });
  }
}
