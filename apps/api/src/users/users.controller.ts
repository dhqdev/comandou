import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ROLES } from '@pedemais/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { hashPassword, verifyPassword } from '../auth/password';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { one, q } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService, Tx } from '../database/database.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';

const password = z.string().min(8, 'mínimo de 8 caracteres').max(200);
const NewMember = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(2).max(80),
  password,
  role: z.enum(ROLES),
});
const UpdateMember = z
  .object({ role: z.enum(ROLES).optional(), status: z.enum(['active', 'revoked']).optional() })
  .refine((b) => b.role || b.status, 'informe papel ou situação');
const ChangePassword = z.object({ current: z.string().min(1).max(200), next: password });

const MEMBER_SELECT = `
  SELECT u.id, u.name, u.email, m.role, m.status, m.created_at AS "createdAt",
         (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS "lastSeenAt"
    FROM memberships m JOIN users u ON u.id = m.user_id`;

/**
 * Equipe do restaurante. A conta (e-mail/senha) é global; o vínculo (papel, situação) é por
 * restaurante. Por isso aqui só se altera o vínculo: desativar alguém revoga o acesso a ESTE
 * restaurante e encerra as sessões dele aqui, sem afetar outros restaurantes.
 */
@Controller({ version: '1' })
export class UsersController {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  @Get('users')
  @RequirePermission('users:manage')
  list(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant(ctxOf(t, u), (tx) =>
      q(tx, `${MEMBER_SELECT} ORDER BY m.status, u.name`),
    );
  }

  @Post('users')
  @RequirePermission('users:manage')
  async create(
    @Body(new ZodPipe(NewMember)) b: z.infer<typeof NewMember>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    if (b.role === 'owner' && u.role !== 'owner')
      throw new ForbiddenException('Só um administrador pode criar outro administrador');
    const hash = await hashPassword(b.password);
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const r = await one<{ user_id: string; created: boolean }>(
        tx,
        `SELECT user_id, created FROM app_add_member($1, $2, $3, $4)`,
        [b.email, b.name, hash, b.role],
      ).catch((err: { code?: string }) => {
        if (err.code === '23505') throw new ConflictException('Este e-mail já faz parte da equipe');
        throw err;
      });
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'user.added',
        entity: 'user',
        entityId: r!.user_id,
        data: { role: b.role, existingAccount: !r!.created },
        ip: req.ip,
      });
      const member = await one(tx, `${MEMBER_SELECT} WHERE u.id = $1`, [r!.user_id]);
      // Conta já existente (de outro restaurante): a senha informada NÃO substitui a dela.
      return { ...member, existingAccount: !r!.created };
    });
  }

  @Patch('users/:id')
  @RequirePermission('users:manage')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(UpdateMember)) b: z.infer<typeof UpdateMember>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    if (id === u.id) throw new ConflictException('Você não pode alterar o seu próprio acesso');
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      // Trava todos os administradores ativos antes: duas alterações simultâneas não conseguem
      // deixar o restaurante sem nenhum administrador.
      const owners = await q<{ user_id: string }>(
        tx,
        `SELECT user_id FROM memberships WHERE role = 'owner' AND status = 'active' ORDER BY user_id FOR UPDATE`,
      );
      const m = await one<{ role: string; status: string }>(
        tx,
        `SELECT role, status FROM memberships WHERE user_id = $1 FOR UPDATE`,
        [id],
      );
      if (!m) throw new NotFoundException('Pessoa não encontrada na equipe');
      const role = b.role ?? m.role;
      const status = b.status ?? m.status;
      if ((m.role === 'owner' || role === 'owner') && u.role !== 'owner')
        throw new ForbiddenException('Só um administrador pode alterar administradores');
      const losesOwner =
        m.role === 'owner' && m.status === 'active' && (role !== 'owner' || status !== 'active');
      if (losesOwner && owners.filter((o) => o.user_id !== id).length === 0)
        throw new ConflictException('O restaurante precisa de ao menos um administrador ativo');
      await q(tx, `UPDATE memberships SET role = $2, status = $3 WHERE user_id = $1`, [
        id,
        role,
        status,
      ]);
      if (status === 'revoked' && m.status !== 'revoked') await this.revokeSessions(tx, id);
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'user.updated',
        entity: 'user',
        entityId: id,
        data: { from: m, to: { role, status } },
        ip: req.ip,
      });
      return one(tx, `${MEMBER_SELECT} WHERE u.id = $1`, [id]);
    });
  }

  /** Troca da própria senha. Exige a senha atual; encerra as outras sessões neste restaurante. */
  @Post('auth/password')
  @HttpCode(204)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async changePassword(
    @Body(new ZodPipe(ChangePassword)) b: z.infer<typeof ChangePassword>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const ctx = ctxOf(t, u);
    const row = await this.db.withTenant(ctx, (tx) =>
      one<{ hash: string | null }>(tx, `SELECT app_own_password_hash() AS hash`),
    );
    if (!row?.hash || !(await verifyPassword(b.current, row.hash)))
      throw new UnauthorizedException('Senha atual incorreta');
    if (b.current === b.next)
      throw new ConflictException('A nova senha deve ser diferente da atual');
    const hash = await hashPassword(b.next);
    await this.db.withTenant(ctx, async (tx) => {
      await q(tx, `SELECT app_set_own_password($1)`, [hash]);
      await q(
        tx,
        `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
        [u.id, u.sessionId],
      );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'auth.password_changed',
        entity: 'user',
        entityId: u.id,
        ip: req.ip,
      });
    });
  }

  private revokeSessions(tx: Tx, userId: string) {
    return q(
      tx,
      `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }
}
