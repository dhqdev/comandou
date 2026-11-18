import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { hashPassword } from '../auth/password';
import {
  cleanCode,
  newResetCode,
  newResetToken,
  RESET_CODE_ATTEMPTS,
  RESET_CODE_MINUTES,
  RESET_CODES_PER_HOUR,
  RESET_TOKEN_MINUTES,
  resetCodeHash,
  sameHash,
  TOO_MANY_CODES,
} from '../auth/reset-code';
import { hashToken } from '../auth/session.service';
import { ENV, Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { passwordChangedEmail, passwordCodeEmail } from '../mail/templates/emails';
import { adminUrlOf, siteUrlOf } from '../mail/templates/urls';
import { PlatformDb, platformAudit } from './platform-db.service';

const PLACE = 'Super Admin do Comandou';

/**
 * "Esqueci minha senha" do Super Admin: código por e-mail → senha nova. Trocar a senha não
 * dispensa o código do autenticador: depois da troca, o login pede a senha nova E o código, em
 * qualquer navegador (os confiáveis deixam de ser e todas as sessões saem).
 */
@Injectable()
export class PlatformPasswordResetService {
  private readonly logger = new Logger('NovaSenhaPainel');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
    private readonly mail: MailService,
  ) {}

  async request(email: string, ip?: string) {
    if (!(await this.mail.ready()))
      throw new ServiceUnavailableException(
        'O envio de e-mail não está ligado. Troque a senha pelo comando platform-admin-cli no servidor.',
      );
    const done = { minutes: RESET_CODE_MINUTES };
    const [a] = await this.db.query<{ id: string; name: string; email: string; recent: number }>(
      `SELECT a.id, a.name, a.email::text AS email,
              (SELECT count(*)::int FROM platform_password_resets r
                WHERE r.admin_id = a.id AND r.created_at > now() - interval '1 hour') AS recent
         FROM platform_admins a WHERE a.email = $1 AND a.disabled_at IS NULL`,
      [email],
    );
    if (!a)
      throw new NotFoundException(
        'Este e-mail não é de nenhum administrador do Comandou. Confira se digitou certo.',
      );
    if (a.recent >= RESET_CODES_PER_HOUR) throw new ThrottlerException(TOO_MANY_CODES);
    const code = newResetCode();
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE platform_password_resets SET used_at = now() WHERE admin_id = $1 AND used_at IS NULL`,
        [a.id],
      );
      await c.query(
        `INSERT INTO platform_password_resets (admin_id, code_hash, expires_at, ip)
         VALUES ($1, $2, now() + make_interval(mins => $3), $4)`,
        [a.id, resetCodeHash('platform', a.id, code), RESET_CODE_MINUTES, ip ?? null],
      );
      await platformAudit(c, {
        adminId: a.id,
        action: 'platform.password_reset_requested',
        entity: 'platform_admin',
        entityId: a.id,
        ip,
      });
    });
    const r = await this.mail.send({
      kind: 'platform.password_reset',
      to: [{ email: a.email, name: a.name }],
      ...passwordCodeEmail({
        name: a.name,
        code,
        minutes: RESET_CODE_MINUTES,
        place: PLACE,
        assets: siteUrlOf(this.env),
        ip,
      }),
      sensitive: true,
    });
    if (!r.ok && !r.queued) {
      this.logger.warn(`código de nova senha do painel não saiu: ${r.error}`);
      throw new ServiceUnavailableException(
        'Não conseguimos mandar o e-mail agora. Tente de novo em alguns minutos.',
      );
    }
    return done;
  }

  async verify(email: string, rawCode: string) {
    const code = cleanCode(rawCode);
    const token = newResetToken();
    const ok = await this.db.tx(async (c) => {
      const { rows } = await c.query<{
        id: string;
        admin_id: string;
        code_hash: Buffer;
        attempts: number;
      }>(
        `SELECT r.id, r.admin_id, r.code_hash, r.attempts
           FROM platform_password_resets r JOIN platform_admins a ON a.id = r.admin_id
          WHERE a.email = $1 AND a.disabled_at IS NULL AND r.used_at IS NULL
            AND r.verified_at IS NULL AND r.expires_at > now()
          ORDER BY r.created_at DESC LIMIT 1 FOR UPDATE OF r`,
        [email],
      );
      const r = rows[0];
      if (!r || r.attempts >= RESET_CODE_ATTEMPTS) return false;
      if (
        code.length !== 6 ||
        !sameHash(resetCodeHash('platform', r.admin_id, code), r.code_hash)
      ) {
        await c.query(`UPDATE platform_password_resets SET attempts = attempts + 1 WHERE id = $1`, [
          r.id,
        ]);
        return false;
      }
      await c.query(
        `UPDATE platform_password_resets SET verified_at = now(), token_hash = $2 WHERE id = $1`,
        [r.id, hashToken(token)],
      );
      return true;
    });
    if (!ok) throw new UnauthorizedException('Código inválido ou vencido. Peça um novo.');
    return { token };
  }

  /** Grava a senha nova e tira o admin de todos os navegadores (os confiáveis também). */
  async complete(token: string, password: string, ip?: string) {
    const hash = await hashPassword(password);
    const a = await this.db.tx(async (c) => {
      const { rows } = await c.query<{ admin_id: string }>(
        `UPDATE platform_password_resets SET used_at = now()
          WHERE token_hash = $1 AND used_at IS NULL AND verified_at IS NOT NULL
            AND verified_at > now() - make_interval(mins => $2)
        RETURNING admin_id`,
        [hashToken(token), RESET_TOKEN_MINUTES],
      );
      const id = rows[0]?.admin_id;
      if (!id) return null;
      const { rows: admins } = await c.query<{ id: string; name: string; email: string }>(
        `UPDATE platform_admins SET password_hash = $2 WHERE id = $1 AND disabled_at IS NULL
        RETURNING id, name, email::text AS email`,
        [id, hash],
      );
      if (!admins[0]) return null;
      await c.query(
        `UPDATE platform_sessions SET revoked_at = now() WHERE admin_id = $1 AND revoked_at IS NULL`,
        [id],
      );
      await c.query(
        `UPDATE platform_trusted_devices SET revoked_at = now()
          WHERE admin_id = $1 AND revoked_at IS NULL`,
        [id],
      );
      await platformAudit(c, {
        adminId: id,
        action: 'platform.password_reset',
        entity: 'platform_admin',
        entityId: id,
        // O e-mail (como o login recebe) zera o bloqueio por tentativas recusadas.
        data: { by: 'email_code', email: admins[0].email },
        ip,
      });
      return admins[0];
    });
    if (!a)
      throw new UnauthorizedException('O tempo para criar a senha acabou. Peça um código novo.');
    void this.mail
      .send({
        kind: 'platform.password_changed',
        to: [{ email: a.email, name: a.name }],
        ...passwordChangedEmail({
          name: a.name,
          place: PLACE,
          when: new Date(),
          ip,
          loginUrl: adminUrlOf(this.env),
          assets: siteUrlOf(this.env),
        }),
      })
      .catch(() => undefined);
    return { email: a.email };
  }
}
