import { Injectable } from '@nestjs/common';
import { currentSupportAdmin } from '../common/request-context';
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
    // Acesso de suporte: o histórico mostra quem do Comandou agiu, não só a conta do dono.
    const support = currentSupportAdmin();
    const data = support && !e.data?.support ? { ...e.data, support } : e.data;
    await tx.insert(auditLog).values({
      tenantId: e.tenantId,
      actorUserId: e.actorUserId ?? null,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      data: data ?? {},
      ip: e.ip ?? null,
    });
  }
}
