import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { normalizePhone } from '../messaging/messaging.service';
import { PlatformDb, platformAudit } from '../platform/platform-db.service';
import { PlatformWaAlerts } from './admin-alerts.service';
import { Operator, OPERATOR_COLS } from './admin-bot.service';

export interface MenuSettingsInput {
  enabled: boolean;
  summaryHour: number | null;
}
export interface OperatorInput {
  phone: string;
  label?: string | null;
  adminId?: string;
  alerts?: boolean;
  summary?: boolean;
}

type Who = { id: string; ip: string | null };

/**
 * Super Admin › WhatsApp › Menu do admin: quais números recebem o menu e os avisos, e a hora do
 * resumo do dia. Tudo entra no histórico do painel.
 */
@Injectable()
export class PlatformWaMenuSettings {
  constructor(
    private readonly pdb: PlatformDb,
    private readonly alerts: PlatformWaAlerts,
  ) {}

  async get() {
    const [s] = await this.pdb.query<{ enabled: boolean; summaryHour: number | null }>(
      `SELECT enabled, summary_hour AS "summaryHour" FROM platform_wa_bot_settings WHERE id`,
    );
    const operators = await this.pdb.query<Operator & { createdAt: Date }>(
      `SELECT ${OPERATOR_COLS}, o.created_at AS "createdAt" FROM platform_wa_operators o
         JOIN platform_admins a ON a.id = o.admin_id ORDER BY o.created_at`,
    );
    const admins = await this.pdb.query<{ id: string; name: string }>(
      `SELECT id, name FROM platform_admins WHERE disabled_at IS NULL ORDER BY name`,
    );
    return {
      enabled: s?.enabled ?? false,
      summaryHour: s?.summaryHour ?? null,
      operators: operators.map(({ adminEmail: _e, ...o }) => o),
      admins,
    };
  }

  async save(b: MenuSettingsInput, who: Who) {
    await this.pdb.tx(async (c) => {
      await c.query(
        `UPDATE platform_wa_bot_settings SET enabled = $1, summary_hour = $2, updated_at = now()
          WHERE id`,
        [b.enabled, b.summaryHour],
      );
      await platformAudit(c, {
        adminId: who.id,
        action: 'whatsapp.menu_settings',
        entity: 'whatsapp',
        data: { ...b },
        ip: who.ip,
      });
    });
    return this.get();
  }

  async add(b: OperatorInput, who: Who) {
    const phone = normalizePhone(b.phone);
    if (!phone)
      throw new UnprocessableEntityException(
        'Telefone inválido: use DDD e número, ex.: 11 91234-5678',
      );
    const adminId = b.adminId ?? who.id;
    await this.pdb.tx(async (c) => {
      const {
        rows: [a],
      } = await c.query(`SELECT 1 FROM platform_admins WHERE id = $1 AND disabled_at IS NULL`, [
        adminId,
      ]);
      if (!a) throw new UnprocessableEntityException('Administrador não encontrado');
      const { rowCount } = await c.query(
        `INSERT INTO platform_wa_operators (phone, label, admin_id, alerts, summary)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (phone) DO NOTHING`,
        [phone, b.label?.trim() || null, adminId, b.alerts ?? true, b.summary ?? true],
      );
      if (!rowCount) throw new ConflictException('Esse número já está cadastrado');
      await platformAudit(c, {
        adminId: who.id,
        action: 'whatsapp.operator_added',
        entity: 'whatsapp',
        data: { phone: `…${phone.slice(-4)}`, adminId },
        ip: who.ip,
      });
    });
    return this.get();
  }

  async update(
    id: string,
    b: Partial<Pick<OperatorInput, 'label' | 'alerts' | 'summary'>>,
    who: Who,
  ) {
    await this.pdb.tx(async (c) => {
      const { rowCount } = await c.query(
        `UPDATE platform_wa_operators SET label = CASE WHEN $2::boolean THEN $3 ELSE label END,
                alerts = coalesce($4, alerts), summary = coalesce($5, summary)
          WHERE id = $1`,
        [id, b.label !== undefined, b.label?.trim() || null, b.alerts ?? null, b.summary ?? null],
      );
      if (!rowCount) throw new NotFoundException('Número não encontrado');
      await platformAudit(c, {
        adminId: who.id,
        action: 'whatsapp.operator_updated',
        entity: 'whatsapp',
        entityId: id,
        data: { alerts: b.alerts, summary: b.summary },
        ip: who.ip,
      });
    });
    return this.get();
  }

  async remove(id: string, who: Who) {
    await this.pdb.tx(async (c) => {
      const { rows } = await c.query<{ phone: string }>(
        `DELETE FROM platform_wa_operators WHERE id = $1 RETURNING phone`,
        [id],
      );
      if (!rows[0]) throw new NotFoundException('Número não encontrado');
      await platformAudit(c, {
        adminId: who.id,
        action: 'whatsapp.operator_removed',
        entity: 'whatsapp',
        entityId: id,
        data: { phone: `…${rows[0].phone.slice(-4)}` },
        ip: who.ip,
      });
    });
    return this.get();
  }

  /** Mensagem de teste para o número (confere que chega e já abre o menu). */
  async test(id: string) {
    const [op] = await this.pdb.query<{ phone: string }>(
      `SELECT phone FROM platform_wa_operators WHERE id = $1`,
      [id],
    );
    if (!op) throw new NotFoundException('Número não encontrado');
    const r = await this.alerts.sendTo(
      op,
      '✅ *Menu do Super Admin ligado neste número.*\n\nResponda *menu* para ver as opções. Os avisos automáticos e o resumo do dia chegam aqui.',
    );
    if (r.status !== 'sent')
      throw new UnprocessableEntityException(r.error ?? 'Não foi possível enviar');
    return { ok: true };
  }
}
