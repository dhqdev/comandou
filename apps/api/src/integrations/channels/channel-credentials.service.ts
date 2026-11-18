import { Global, Inject, Injectable, Module, UnprocessableEntityException } from '@nestjs/common';
import { CHANNEL_ID_RE } from '@comandou/shared';
import { z } from 'zod';
import { open, seal } from '../../common/secret-box';
import { ENV, Env } from '../../config/env';
import { PlatformDb, platformAudit } from '../../platform/platform-db.service';

/** Credencial do APLICATIVO do Comandou num canal (não é a da loja). */
export interface AppCredential {
  clientId: string;
  clientSecret: string;
  /** iFood: 'centralized' ou 'distributed'. */
  mode?: string;
  /** Segredo de assinatura dos webhooks, quando o canal usa um diferente do clientSecret. */
  webhookSecret?: string;
  /** De onde veio: Super Admin › Credenciais ou o .env do servidor (reserva). */
  source: 'panel' | 'env';
  last4: string;
}

export const ChannelCredentialBody = z.object({
  clientId: z.string().trim().min(4).max(200),
  clientSecret: z.string().trim().min(8).max(500),
  mode: z.enum(['centralized', 'distributed']).optional(),
  webhookSecret: z.string().trim().min(8).max(500).optional(),
});
export type ChannelCredentialInput = z.infer<typeof ChannelCredentialBody>;

const nameOf = (channel: string) => `channel_${channel.replace(/-/g, '_')}`;
const contextOf = (channel: string) => `platform-credential:${nameOf(channel)}`;

/**
 * Credenciais dos aplicativos de delivery em Super Admin › Credenciais (platform_credentials,
 * cifradas com a INTEGRATIONS_KEY). O iFood ainda aceita IFOOD_CLIENT_ID/SECRET do servidor como
 * reserva. Cache de 30 s: trocar no painel vale em seguida, sem reiniciar.
 */
@Injectable()
export class ChannelCredentials {
  private readonly cache = new Map<string, { at: number; value: AppCredential | null }>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly platform: PlatformDb,
  ) {}

  async get(channel: string): Promise<AppCredential | null> {
    const hit = this.cache.get(channel);
    if (hit && Date.now() - hit.at < 30_000) return hit.value;
    let value: AppCredential | null = null;
    const key = this.env.INTEGRATIONS_KEY;
    if (this.platform.enabled && key && CHANNEL_ID_RE.test(channel)) {
      const [row] = await this.platform
        .query<{ v: Buffer; last4: string }>(
          `SELECT value_enc AS v, last4 FROM platform_credentials WHERE name = $1`,
          [nameOf(channel)],
        )
        .catch(() => []);
      if (row) {
        try {
          const parsed = ChannelCredentialBody.parse(
            JSON.parse(open(key, row.v, contextOf(channel))),
          );
          value = { ...parsed, source: 'panel', last4: row.last4 };
        } catch {
          value = null;
        }
      }
    }
    value ??= this.fromEnv(channel);
    this.cache.set(channel, { at: Date.now(), value });
    return value;
  }

  /** Reserva: só o iFood tem variáveis no servidor (de antes do painel). */
  private fromEnv(channel: string): AppCredential | null {
    const e = this.env;
    if (channel === 'ifood' && e.IFOOD_CLIENT_ID && e.IFOOD_CLIENT_SECRET)
      return {
        clientId: e.IFOOD_CLIENT_ID,
        clientSecret: e.IFOOD_CLIENT_SECRET,
        mode: e.IFOOD_APP_MODE,
        source: 'env',
        last4: e.IFOOD_CLIENT_SECRET.slice(-4),
      };
    return null;
  }

  forget(channel?: string) {
    if (channel) this.cache.delete(channel);
    else this.cache.clear();
  }

  /** Situação de cada canal para a tela de Credenciais (nunca o valor). */
  async status(channels: readonly string[]) {
    const out: Record<
      string,
      { configured: boolean; source?: string; last4?: string; mode?: string }
    > = {};
    for (const c of channels) {
      this.forget(c);
      const v = await this.get(c);
      out[c] = v
        ? { configured: true, source: v.source, last4: v.last4, mode: v.mode }
        : { configured: false };
    }
    return out;
  }

  async save(
    channel: string,
    body: ChannelCredentialInput,
    actor: { adminId: string; ip?: string },
  ) {
    if (!CHANNEL_ID_RE.test(channel)) throw new UnprocessableEntityException('Canal inválido');
    const key = this.env.INTEGRATIONS_KEY;
    if (!key)
      throw new UnprocessableEntityException(
        'Servidor sem INTEGRATIONS_KEY: não é possível guardar a credencial com segurança',
      );
    const enc = seal(key, JSON.stringify(body), contextOf(channel));
    await this.platform.tx(async (c) => {
      await c.query(
        `INSERT INTO platform_credentials (name, value_enc, last4, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (name) DO UPDATE
           SET value_enc = EXCLUDED.value_enc, last4 = EXCLUDED.last4,
               updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [nameOf(channel), enc, body.clientSecret.slice(-4), actor.adminId],
      );
      await platformAudit(c, {
        adminId: actor.adminId,
        action: 'credentials.save',
        entity: 'credential',
        entityId: nameOf(channel),
        ip: actor.ip,
      });
    });
    this.forget(channel);
  }

  async remove(channel: string, actor: { adminId: string; ip?: string }) {
    if (!CHANNEL_ID_RE.test(channel)) throw new UnprocessableEntityException('Canal inválido');
    await this.platform.tx(async (c) => {
      await c.query(`DELETE FROM platform_credentials WHERE name = $1`, [nameOf(channel)]);
      await platformAudit(c, {
        adminId: actor.adminId,
        action: 'credentials.remove',
        entity: 'credential',
        entityId: nameOf(channel),
        ip: actor.ip,
      });
    });
    this.forget(channel);
  }
}

/** Global: o iFood (cardápio) e os canais leem daqui. */
@Global()
@Module({ providers: [ChannelCredentials], exports: [ChannelCredentials] })
export class ChannelCredentialsModule {}
