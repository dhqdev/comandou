import { Injectable } from '@nestjs/common';
import { auditLog } from '../database/schema';
import type { Tx } from '../database/database.service';

export interface AuditEntry {
  tenantId: string;
  actorUserId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  data?: Record<string, unknown>;
  ip?: string | null;
}

/** Grava auditoria NA MESMA transação da operação auditada. Nunca registre segredos em `data`. */
@Injectable()
export class AuditService {
  async record(tx: Tx, e: AuditEntry): Promise<void> {
    await tx.insert(auditLog).values({
      tenantId: e.tenantId,
      actorUserId: e.actorUserId ?? null,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      data: e.data ?? {},
      ip: e.ip ?? null,
    });
  }
}
