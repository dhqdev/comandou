import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PIN_ONLY_EMAIL_DOMAIN } from '@comandou/shared';
import { ThrottlerException } from '@nestjs/throttler';
import { AuditService } from '../audit/audit.service';
import { one, q } from '../common/sql';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { MailService } from '../mail/mail.service';
import { passwordChangedEmail, passwordCodeEmail } from '../mail/templates/emails';
import { siteUrlOf, tenantUrlOf } from '../mail/templates/urls';
import type { ResolvedTenant } from '../tenancy/tenant.types';
import { hashPassword } from './password';
import {
  cleanCode,
  newResetCode,
  newResetToken,
  RESET_CODE_ATTEMPTS,
  RESET_CODE_MINUTES,
  RESET_CODES_PER_HOUR,
  resetCodeHash,
  sameHash,
  TOO_MANY_CODES,
} from './reset-code';
import { hashToken, SessionService } from './session.service';

export const MAIL_OFF_STAFF =
  'O envio de e-mail não está ligado. Peça ao administrador do restaurante para criar uma senha nova para você na tela Equipe.';

/** O e-mail digitado não é de ninguém da equipe deste restaurante (nem de quem entra só com PIN). */
export const STAFF_EMAIL_NOT_FOUND =
  'Este e-mail não é de nenhuma conta deste restaurante. Confira se digitou certo ou use o e-mail que você usa para entrar.';

/**
 * "Esqueci minha senha" da equipe do restaurante (painel, PDV, cozinha, entregas e o e-mail do
 * garçom): 1) pede o código pelo e-mail, 2) confere o código, 3) grava a senha nova e já entra.
 *
 * Manda um código, nunca uma senha: quem digita o e-mail de outra pessoa não troca a senha dela.
 * Confere o e-mail digitado: se não for de uma conta deste restaurante, a tela avisa na hora (em
 * vez de esperar um código que nunca chega). O limite de pedidos por IP do login segura quem tenta
 * adivinhar e-mails. O código vale 15 minutos, aceita 5 tentativas e cada conta recebe no máximo 5
 * por hora.
 */
@Injectable()
export class StaffPasswordResetService {
  private readonly logger = new Logger('NovaSenha');

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly sessions: SessionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async request(tenant: ResolvedTenant, email: string, ip?: string) {
    if (!(await this.mail.ready())) throw new ServiceUnavailableException(MAIL_OFF_STAFF);
    const done = { minutes: RESET_CODE_MINUTES };
    const notFound = () => new NotFoundException(STAFF_EMAIL_NOT_FOUND);
    if (email.endsWith(`@${PIN_ONLY_EMAIL_DOMAIN}`)) throw notFound();
    const [u] = await this.db.queryTenantDb<{ user_id: string; name: string }>(
      tenant.id,
      'SELECT user_id, name FROM app_find_login($1, $2)',
      [tenant.id, email],
    );
    if (!u) throw notFound();
    const code = newResetCode();
    const issued = await this.db.withTenant({ tenantId: tenant.id }, async (tx) => {
      const r = await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM staff_password_resets
          WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
        [u.user_id],
      );
      if ((r?.n ?? 0) >= RESET_CODES_PER_HOUR) return false;
      // Um código por vez: os anteriores deixam de valer.
      await q(
        tx,
        `UPDATE staff_password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
        [u.user_id],
      );
      await q(
        tx,
        `INSERT INTO staff_password_resets (tenant_id, user_id, code_hash, expires_at, ip)
         VALUES ($1, $2, $3, now() + make_interval(mins => $4), $5)`,
        [tenant.id, u.user_id, resetCodeHash('staff', u.user_id, code), RESET_CODE_MINUTES, ip],
      );
      await this.audit.record(tx, {
        tenantId: tenant.id,
        actorUserId: u.user_id,
        action: 'auth.password_reset_requested',
        entity: 'user',
        entityId: u.user_id,
        ip,
      });
      return true;
    });
    if (!issued) throw new ThrottlerException(TOO_MANY_CODES);
    const r = await this.mail.send({
      kind: 'auth.password_reset',
      tenantId: tenant.id,
      to: [{ email, name: u.name }],
      ...passwordCodeEmail({
        name: u.name,
        code,
        minutes: RESET_CODE_MINUTES,
        place: tenant.name,
        assets: siteUrlOf(this.env),
        ip,
      }),
      sensitive: true,
    });
    if (!r.ok && !r.queued) {
      this.logger.warn(`código de nova senha não saiu (${tenant.slug}): ${r.error}`);
      throw new ServiceUnavailableException(
        'Não conseguimos mandar o e-mail agora. Tente de novo em alguns minutos.',
      );
    }
    return done;
  }

  /** Confere o código. Certo: devolve o token da tela da senha nova (o código deixa de valer). */
  async verify(tenant: ResolvedTenant, email: string, rawCode: string) {
    const code = cleanCode(rawCode);
    const invalid = () => new UnauthorizedException('Código inválido ou vencido. Peça um novo.');
    const [u] = await this.db.queryTenantDb<{ user_id: string }>(
      tenant.id,
      'SELECT user_id FROM app_find_login($1, $2)',
      [tenant.id, email],
    );
    if (!u) throw invalid();
    const token = newResetToken();
    const ok = await this.db.withTenant({ tenantId: tenant.id }, async (tx) => {
      const r = await one<{ id: string; code_hash: Buffer; attempts: number }>(
        tx,
        `SELECT id, code_hash, attempts FROM staff_password_resets
          WHERE user_id = $1 AND used_at IS NULL AND verified_at IS NULL AND expires_at > now()
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [u.user_id],
      );
      if (!r || r.attempts >= RESET_CODE_ATTEMPTS) return false;
      if (code.length !== 6 || !sameHash(resetCodeHash('staff', u.user_id, code), r.code_hash)) {
        await q(tx, `UPDATE staff_password_resets SET attempts = attempts + 1 WHERE id = $1`, [
          r.id,
        ]);
        return false;
      }
      await q(
        tx,
        `UPDATE staff_password_resets SET verified_at = now(), token_hash = $2 WHERE id = $1`,
        [r.id, hashToken(token)],
      );
      return true;
    });
    if (!ok) throw invalid();
    return { token };
  }

  /**
   * Grava a senha nova, tira a conta dos outros aparelhos deste restaurante, zera o bloqueio por
   * senhas erradas e abre a sessão neste aparelho. Manda o aviso "sua senha foi trocada".
   */
  async complete(
    tenant: ResolvedTenant,
    token: string,
    password: string,
    meta: { ip?: string; userAgent?: string; remember?: boolean },
  ) {
    const hash = await hashPassword(password);
    const result = await this.db.withTenant({ tenantId: tenant.id }, async (tx) => {
      const u = await one<{ user_id: string; email: string; name: string }>(
        tx,
        `SELECT user_id, email, name FROM app_reset_password_with_token($1, $2, $3)`,
        [tenant.id, hashToken(token), hash],
      );
      if (!u) return null;
      await q(
        tx,
        `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
        [u.user_id],
      );
      await this.audit.record(tx, {
        tenantId: tenant.id,
        actorUserId: u.user_id,
        action: 'user.password_reset',
        entity: 'user',
        entityId: u.user_id,
        // O e-mail (como o login recebe) zera o bloqueio por senhas erradas desta conta.
        data: { by: 'email_code', email: u.email.toLowerCase() },
        ip: meta.ip,
      });
      const role = await one<{ role: string }>(
        tx,
        `SELECT role FROM memberships WHERE user_id = $1`,
        [u.user_id],
      );
      const s = await this.sessions.create(tx, tenant.id, u.user_id, {
        ip: meta.ip,
        userAgent: meta.userAgent,
        remember: meta.remember,
      });
      return { user: { id: u.user_id, name: u.name, role: role?.role ?? '' }, email: u.email, s };
    });
    if (!result)
      throw new UnauthorizedException('O tempo para criar a senha acabou. Peça um código novo.');
    void this.mail
      .send({
        kind: 'auth.password_changed',
        tenantId: tenant.id,
        to: [{ email: result.email, name: result.user.name }],
        ...passwordChangedEmail({
          name: result.user.name,
          place: tenant.name,
          when: new Date(),
          ip: meta.ip,
          loginUrl: tenantUrlOf(this.env, tenant.slug),
          assets: siteUrlOf(this.env),
        }),
      })
      .catch(() => undefined);
    return { user: result.user, session: result.s };
  }
}
