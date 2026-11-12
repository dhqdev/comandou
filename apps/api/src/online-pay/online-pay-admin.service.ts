import {
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { z } from 'zod';
import { seal } from '../common/secret-box';
import { ENV, Env } from '../config/env';
import { PlatformDb, platformAudit } from '../platform/platform-db.service';
import { OnlinePayService } from './online-pay.service';

const percent = z
  .string()
  .trim()
  .regex(/^\d{1,2}(\.\d{1,2})?$/, 'percentual com até 2 casas (ex.: 1.5)')
  .refine((v) => Number(v) <= 20, 'no máximo 20%');
const fixed = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, 'valor fixo (ex.: 0.30)')
  .refine((v) => Number(v) <= 100, 'no máximo R$ 100');

export const OnlinePaySettingsBody = z.object({
  enabled: z.boolean(),
  environment: z.enum(['sandbox', 'production']),
  /** Vazio mantém o que está salvo. */
  platformToken: z.string().trim().max(400).optional(),
  clientId: z.string().trim().max(80).optional(),
  clientSecret: z.string().trim().max(400).optional(),
  receiverAccountId: z
    .string()
    .trim()
    .regex(/^ACCO_[A-Za-z0-9-]{4,60}$/, 'o id da conta começa com ACCO_')
    .or(z.literal(''))
    .optional(),
  feePercent: percent,
  feeFixed: fixed,
});

export const TenantFeeBody = z.object({
  /** null volta para a taxa padrão. */
  fee: z.object({ percent, fixed, note: z.string().trim().max(200).optional() }).nullable(),
});

interface Actor {
  admin: { id: string; name: string };
  ip?: string;
}

/** Super Admin → Cobrança → Pagamentos pelo app: conta da Comandou, aplicação, taxas e relatório. */
@Injectable()
export class OnlinePayAdminService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
    private readonly pay: OnlinePayService,
  ) {}

  private requireKey() {
    if (!this.env.INTEGRATIONS_KEY)
      throw new ServiceUnavailableException(
        'Servidor sem INTEGRATIONS_KEY: não é possível guardar as chaves com segurança',
      );
    return this.env.INTEGRATIONS_KEY;
  }

  async overview() {
    const cfg = await this.pay.platformCfg();
    const [row] = await this.db.query<{ updated_at: Date }>(
      `SELECT updated_at FROM platform_online_pay_settings`,
    );
    // Restaurantes conectados e o que a taxa rendeu no mês (central + bancos próprios).
    const accSql = `SELECT tenant_id, environment, seller_account_id, card_enabled, pix_enabled,
                           connected_at, last_error FROM online_pay_accounts`;
    const feeSql = `SELECT tenant_id, count(*)::int AS n, COALESCE(sum(amount), 0)::text AS amount,
                           COALESCE(sum(fee_amount), 0)::text AS fees
                      FROM online_charges
                     WHERE status IN ('paid','refund_due','refunded')
                       AND paid_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
                     GROUP BY tenant_id`;
    const accounts = [
      ...(await this.db.query<Record<string, unknown> & { tenant_id: string }>(accSql)),
      ...(
        await this.db.eachDedicated<Record<string, unknown> & { tenant_id: string }>(accSql)
      ).flatMap((d) => d.rows),
    ];
    const fees = [
      ...(await this.db.query<{ tenant_id: string; n: number; amount: string; fees: string }>(
        feeSql,
      )),
      ...(
        await this.db.eachDedicated<{ tenant_id: string; n: number; amount: string; fees: string }>(
          feeSql,
        )
      ).flatMap((d) => d.rows),
    ];
    const names = await this.db.query<{ id: string; name: string; slug: string }>(
      `SELECT id, name, slug FROM tenants`,
    );
    const custom = await this.db.query<{
      tenant_id: string;
      fee_percent: string;
      fee_fixed: string;
      note: string | null;
    }>(`SELECT tenant_id, fee_percent::text, fee_fixed::text, note FROM tenant_online_pay_fees`);
    const byId = new Map(names.map((t) => [t.id, t]));
    const ids = new Set([...accounts.map((a) => a.tenant_id), ...custom.map((c) => c.tenant_id)]);
    return {
      settings: {
        enabled: cfg?.enabled ?? false,
        environment: cfg?.environment ?? 'sandbox',
        hasPlatformToken: !!cfg?.platformToken,
        clientId: cfg?.clientId ?? null,
        hasClientSecret: !!cfg?.clientSecret,
        receiverAccountId: cfg?.receiverAccountId ?? null,
        feePercent: cfg?.feePercent ?? '1.00',
        feeFixed: cfg?.feeFixed ?? '0.00',
        redirectUri: this.pay.redirectUri(),
        keyConfigured: !!this.env.INTEGRATIONS_KEY,
        updatedAt: row?.updated_at ?? null,
      },
      month: {
        n: fees.reduce((a, f) => a + Number(f.n), 0),
        amount: fees.reduce((a, f) => a + Number(f.amount), 0).toFixed(2),
        fees: fees.reduce((a, f) => a + Number(f.fees), 0).toFixed(2),
      },
      tenants: [...ids].map((id) => {
        const a = accounts.find((x) => x.tenant_id === id);
        const f = fees.find((x) => x.tenant_id === id);
        const c = custom.find((x) => x.tenant_id === id);
        return {
          id,
          name: byId.get(id)?.name ?? id,
          slug: byId.get(id)?.slug ?? null,
          connected: !!a?.connected_at && a.environment === (cfg?.environment ?? 'sandbox'),
          environment: a?.environment ?? null,
          sellerAccountId: a?.seller_account_id ?? null,
          cardEnabled: a?.card_enabled ?? false,
          pixEnabled: a?.pix_enabled ?? false,
          lastError: a?.last_error ?? null,
          fee: c ? { percent: c.fee_percent, fixed: c.fee_fixed, note: c.note } : null,
          month: { n: f?.n ?? 0, amount: f?.amount ?? '0.00', fees: f?.fees ?? '0.00' },
        };
      }),
    };
  }

  async saveSettings(b: z.infer<typeof OnlinePaySettingsBody>, actor: Actor) {
    const key = this.requireKey();
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE platform_online_pay_settings SET enabled = $1, environment = $2,
                platform_token_enc = COALESCE($3, platform_token_enc),
                client_id = COALESCE($4, client_id),
                client_secret_enc = COALESCE($5, client_secret_enc),
                receiver_account_id = CASE WHEN $6::text IS NULL THEN receiver_account_id ELSE NULLIF($6, '') END,
                fee_percent = $7, fee_fixed = $8, updated_at = now(), updated_by = $9`,
        [
          b.enabled,
          b.environment,
          b.platformToken ? seal(key, b.platformToken, 'online-pay:platform-token') : null,
          b.clientId || null,
          b.clientSecret ? seal(key, b.clientSecret, 'online-pay:client-secret') : null,
          b.receiverAccountId ?? null,
          b.feePercent,
          b.feeFixed,
          actor.admin.id,
        ],
      );
      await platformAudit(c, {
        adminId: actor.admin.id,
        action: 'platform.online_pay.settings_updated',
        entity: 'online_pay',
        // Nunca grava token nem segredo: só se foram trocados.
        data: {
          enabled: b.enabled,
          environment: b.environment,
          platformToken: !!b.platformToken,
          clientId: b.clientId || undefined,
          clientSecret: !!b.clientSecret,
          receiverAccountId: b.receiverAccountId,
          feePercent: b.feePercent,
          feeFixed: b.feeFixed,
        },
        ip: actor.ip,
      });
    });
    const cfg = await this.pay.platformCfg();
    if (
      b.enabled &&
      (!cfg?.platformToken || !cfg.clientId || !cfg.clientSecret || !cfg.receiverAccountId)
    )
      return {
        ...(await this.overview()),
        warning:
          'Ligado, mas falta o token da conta, a aplicação do Connect ou a conta que recebe a taxa: os restaurantes ainda não veem a opção.',
      };
    return this.overview();
  }

  /** Cria a aplicação do Connect no PagBank com o token da conta da Comandou. */
  async createApplication(origin: string, actor: Actor) {
    const key = this.requireKey();
    const cfg = await this.pay.platformCfg();
    if (!cfg?.platformToken)
      throw new UnprocessableEntityException('Salve primeiro o token da conta PagBank da Comandou');
    const app = await this.pay
      .client(cfg.environment)
      .createApplication(cfg.platformToken, {
        name: 'Comandou',
        redirectUri: this.pay.redirectUri(),
        site: origin,
      })
      .catch((e: Error) => {
        throw new HttpException(`PagBank: ${e.message}`, 502);
      });
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE platform_online_pay_settings SET client_id = $1, client_secret_enc = $2,
                receiver_account_id = COALESCE(receiver_account_id, $3), updated_at = now(), updated_by = $4`,
        [
          app.clientId,
          seal(key, app.clientSecret, 'online-pay:client-secret'),
          app.accountId && /^ACCO_[A-Za-z0-9-]{4,60}$/.test(app.accountId) ? app.accountId : null,
          actor.admin.id,
        ],
      );
      await platformAudit(c, {
        adminId: actor.admin.id,
        action: 'platform.online_pay.application_created',
        entity: 'online_pay',
        data: { clientId: app.clientId, environment: cfg.environment },
        ip: actor.ip,
      });
    });
    return this.overview();
  }

  async setTenantFee(tenantId: string, b: z.infer<typeof TenantFeeBody>, actor: Actor) {
    await this.db.tx(async (c) => {
      const t = await c.query(`SELECT 1 FROM tenants WHERE id = $1`, [tenantId]);
      if (!t.rowCount) throw new NotFoundException('Restaurante não encontrado');
      if (b.fee)
        await c.query(
          `INSERT INTO tenant_online_pay_fees (tenant_id, fee_percent, fee_fixed, note, updated_by)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id) DO UPDATE SET fee_percent = EXCLUDED.fee_percent,
                 fee_fixed = EXCLUDED.fee_fixed, note = EXCLUDED.note, updated_at = now(),
                 updated_by = EXCLUDED.updated_by`,
          [tenantId, b.fee.percent, b.fee.fixed, b.fee.note || null, actor.admin.id],
        );
      else await c.query(`DELETE FROM tenant_online_pay_fees WHERE tenant_id = $1`, [tenantId]);
      await platformAudit(c, {
        adminId: actor.admin.id,
        action: 'platform.online_pay.tenant_fee',
        entity: 'tenant',
        entityId: tenantId,
        tenantId,
        data: { fee: b.fee },
        ip: actor.ip,
      });
    });
    return this.overview();
  }
}
