import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BillingService } from '../billing/billing.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { Actor } from './platform.service';
import { PlatformDb, platformAudit } from './platform-db.service';

/**
 * Super Admin › restaurante › Limpar cache. Apaga tudo que fica guardado daquele restaurante:
 *  - na API, em todas as réplicas: onde fica o banco dele e o bloqueio da assinatura;
 *  - em toda tela aberta (sistema, app instalado, cozinha, garçom, entregador, cliente na
 *    conversa do cardápio): arquivos do app, service worker e as leituras guardadas para usar sem
 *    internet. Depois a tela recarrega direto do servidor.
 * Aparelho fechado ou sem internet limpa quando conectar de novo (`tenants.cache_cleared_at`).
 * Fica de fora o que ainda não subiu (vendas feitas sem internet), o login e os ajustes do
 * aparelho (impressora, setor da cozinha, tema): apagar isso perderia trabalho ou pararia a loja.
 */
@Injectable()
export class PlatformCacheService {
  constructor(
    private readonly db: PlatformDb,
    private readonly realtime: RealtimeService,
    billing: BillingService,
  ) {
    realtime.onCacheClear((tenantId) => billing.forgetBlock(tenantId));
  }

  async clear(tenantId: string, a: Actor) {
    const at = await this.db.tx(async (c) => {
      const r = await c.query<{ status: string; at: Date }>(
        `UPDATE tenants SET cache_cleared_at = now() WHERE id = $1
          RETURNING status, cache_cleared_at AS at`,
        [tenantId],
      );
      const row = r.rows[0];
      if (!row) throw new NotFoundException('Restaurante não encontrado');
      if (row.status === 'deleting' || row.status === 'migrated')
        throw new ConflictException('Este restaurante não está mais neste servidor');
      const iso = new Date(row.at).toISOString();
      const screens = await this.realtime.connectedCount(tenantId);
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.tenant.cache_cleared',
        entity: 'tenant',
        entityId: tenantId,
        tenantId,
        data: { screens },
        ip: a.ip,
      });
      return { iso, screens };
    });
    // Só depois do COMMIT: a tela que reconectar já encontra a data nova no banco.
    this.realtime.clearTenantCaches(tenantId, at.iso);
    return { clearedAt: at.iso, screens: at.screens };
  }
}
