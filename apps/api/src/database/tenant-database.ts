import type { Pool } from 'pg';

export type TenantDatabaseLocation = 'shared' | 'dedicated';

/**
 * Ponto único que decide em qual banco ficam os dados de um restaurante (ADR 0011).
 * Toda transação de negócio (DatabaseService.withTenant) pede o pool por aqui.
 *
 * Hoje só existe o banco compartilhado (ADR 0003): todo restaurante vai para ele. Quando houver
 * cliente com banco dedicado, uma nova implementação consulta o registro de conexões e devolve o
 * pool daquele restaurante, sem mudar quem chama.
 */
export interface TenantDatabaseRouter {
  poolFor(tenantId: string): Pool;
  locationOf(tenantId: string): TenantDatabaseLocation;
}

export class SharedDatabaseRouter implements TenantDatabaseRouter {
  constructor(private readonly shared: Pool) {}

  poolFor(_tenantId: string): Pool {
    return this.shared;
  }

  locationOf(_tenantId: string): TenantDatabaseLocation {
    return 'shared';
  }
}
