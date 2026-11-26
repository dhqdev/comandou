import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { normalizePhone, phoneOk } from './customers.service';

/** Quem é o titular: a conta do cardápio e/ou o telefone de quem pediu sem conta. */
export interface Subject {
  customerId?: string | null;
  phone?: string | null;
}
/** Quem atendeu: o próprio cliente (cardápio) ou alguém da equipe. */
export interface Requester {
  by: 'customer' | 'staff';
  userId?: string | null;
  ip?: string;
}

/** Motivos que travam o apagar, em palavras simples (a tela mostra este texto). */
export const ERASE_BLOCKED: Record<string, string> = {
  open_order: 'Há um pedido em andamento. Espere ele terminar e tente de novo.',
  owes: 'Há um valor em aberto (fiado ou a receber). Acerte com a loja antes de apagar.',
  refund: 'Há um pagamento ou devolução de Pix esperando. Espere terminar e tente de novo.',
  reservation: 'Há uma reserva marcada. Cancele a reserva antes de apagar.',
};

export interface EraseResult {
  status: 'ok';
  account: boolean;
  orders: number;
  tabs: number;
  reservations: number;
  chats: number;
  messages: number;
  charges: number;
}

/**
 * Pedidos de titular da LGPD (docs/operations.md › Retenção): exportar tudo o que o restaurante
 * guarda de uma pessoa e apagar os dados dela. Apagar é a função `app_privacy_erase` (migração
 * 0122): a conta sai inteira e o que precisa ficar (pedidos, pagamentos, notas) fica sem nome,
 * telefone, endereço e CPF (este só fica quando saiu nota autorizada com ele).
 */
@Injectable()
export class PrivacyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Telefone vindo da equipe: só dígitos, DDD + número. */
  static phoneOf(raw: string | null | undefined) {
    if (!raw) return null;
    const p = normalizePhone(raw);
    if (!phoneOk(p)) throw new UnprocessableEntityException('Telefone inválido (DDD + número)');
    return p;
  }

  /** Tudo o que o restaurante guarda do titular, num objeto só (vira o arquivo JSON). */
  export(tenantId: string, s: Subject, who: Requester) {
    return this.db.withTenant({ tenantId, userId: who.userId ?? null }, async (tx) => {
      const cid = s.customerId ?? null;
      const account = cid
        ? await one(
            tx,
            `SELECT name, phone, email, document AS cpf, marketing_opt_in AS "aceitaPromocoes",
                    created_at AS "criadaEm", last_login_at AS "ultimoAcesso",
                    phone_verified_at AS "telefoneConfirmadoEm", photo IS NOT NULL AS "temFoto",
                    avatar, staff_notes AS "anotacaoDaLoja", blocked_at AS "bloqueadaEm",
                    CASE WHEN birth_day IS NULL THEN NULL
                         ELSE lpad(birth_day::text, 2, '0') || '/' || lpad(birth_month::text, 2, '0')
                              || COALESCE('/' || birth_year, '') END AS aniversario,
                    NOT birthday_opt_out AS "aceitaParabens"
               FROM customers WHERE id = $1`,
            [cid],
          )
        : null;
      if (cid && !account) throw new NotFoundException('Cliente não encontrado');
      const phone = (account?.phone as string | undefined) ?? s.phone ?? null;
      if (!cid && !phone) throw new UnprocessableEntityException('Informe o telefone');
      // Mesmo critério do apagar: a conta ou o telefone (DDD + 8 últimos dígitos).
      const key = `app_phone_key($2::text)`;
      const p = [cid, phone];

      const [
        addresses,
        sessions,
        orders,
        reservations,
        loyalty,
        reviews,
        storeChat,
        whatsapp,
        coupons,
        member,
        birthdays,
      ] = await Promise.all([
        cid
          ? q(
              tx,
              `SELECT label AS nome, street AS rua, number AS numero, district AS bairro,
                      complement AS complemento, reference AS referencia, cep, city AS cidade,
                      state AS uf, lat::text, lng::text, is_default AS principal
                 FROM customer_addresses WHERE customer_id = $1 ORDER BY created_at`,
              [cid],
            )
          : [],
        cid
          ? q(
              tx,
              `SELECT created_at AS "entrouEm", last_seen_at AS "ultimoUso", expires_at AS "valeAte",
                      revoked_at AS "encerradaEm", user_agent AS navegador
                 FROM customer_sessions WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 200`,
              [cid],
            )
          : [],
        q(
          tx,
          `SELECT o.number AS numero, o.created_at AS "feitoEm", o.status AS situacao,
                  o.channel AS canal, o.total::text, o.customer_name AS nome,
                  o.customer_phone AS telefone, o.delivery_address AS "enderecoDeEntrega",
                  o.tax_document AS "cpfNaNota", o.notes AS observacao,
                  o.fiado_name AS "fiadoNome", o.fiado_phone AS "fiadoTelefone",
                  COALESCE((SELECT json_agg(json_build_object('item', i.name, 'quantidade', i.quantity::float8,
                              'unidade', i.unit, 'total', i.total::text, 'observacao', i.notes)
                              ORDER BY i.created_at)
                              FROM order_items i WHERE i.order_id = o.id), '[]') AS itens,
                  COALESCE((SELECT json_agg(json_build_object('forma', pm.method,
                              'valor', (pm.amount - pm.refunded_amount)::text, 'em', pm.created_at)
                              ORDER BY pm.created_at)
                              FROM payments pm WHERE pm.order_id = o.id), '[]') AS pagamentos
             FROM orders o
            WHERE ($1::uuid IS NOT NULL AND o.customer_id = $1)
               OR app_phone_key(o.customer_phone) = ${key}
               OR app_phone_key(o.fiado_phone) = ${key}
            ORDER BY o.created_at DESC LIMIT 5000`,
          p,
        ),
        q(
          tx,
          `SELECT code AS codigo, starts_at AS "dataHora", party_size AS pessoas, status AS situacao,
                  name AS nome, phone AS telefone, email, occasion AS ocasiao, notes AS recado,
                  created_at AS "feitaEm"
             FROM reservations
            WHERE ($1::uuid IS NOT NULL AND customer_id = $1) OR app_phone_key(phone) = ${key}
            ORDER BY starts_at DESC LIMIT 2000`,
          p,
        ),
        cid
          ? q(
              tx,
              `SELECT kind AS tipo, points AS pontos, discount::text AS desconto, note AS nota,
                      created_at AS em
                 FROM loyalty_entries WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 5000`,
              [cid],
            )
          : [],
        cid
          ? q(
              tx,
              `SELECT pr.name AS item, r.rating AS nota, r.comment AS comentario, r.created_at AS em
                 FROM product_reviews r JOIN products pr ON pr.id = r.product_id
                WHERE r.customer_id = $1 ORDER BY r.created_at DESC`,
              [cid],
            )
          : [],
        q(
          tx,
          `SELECT m.sender AS quem, m.body AS texto, m.file_kind AS arquivo, m.created_at AS em
             FROM store_chat_messages m JOIN store_chats c ON c.id = m.chat_id
            WHERE (($1::uuid IS NOT NULL AND c.customer_id = $1) OR app_phone_key(c.phone) = ${key})
              AND m.deleted_at IS NULL
            ORDER BY m.created_at LIMIT 5000`,
          p,
        ),
        phone
          ? q(
              tx,
              `SELECT m.role AS quem, m.content AS texto, m.created_at AS em
                 FROM ai_customer_messages m
                WHERE app_phone_key(m.phone) = app_phone_key($1)
                ORDER BY m.created_at LIMIT 5000`,
              [phone],
            )
          : [],
        cid
          ? q(
              tx,
              `SELECT c.code AS cupom, c.title AS nome, r.discount::text AS desconto,
                      r.channel AS onde, r.refunded_at AS "devolvidoEm", r.created_at AS em
                 FROM coupon_redemptions r JOIN coupons c ON c.id = r.coupon_id
                WHERE r.customer_id = $1 ORDER BY r.created_at DESC LIMIT 2000`,
              [cid],
            )
          : [],
        cid
          ? one(
              tx,
              `SELECT referral_code AS "codigoDeConvite", (referred_by IS NOT NULL) AS "veioPorConvite",
                      created_at AS "desde"
                 FROM loyalty_members WHERE customer_id = $1`,
              [cid],
            )
          : null,
        cid
          ? q(
              tx,
              `SELECT year AS ano, status AS situacao, gift_kind AS presente, gift_points AS pontos,
                      gift_text AS "presenteEscrito", sent_at AS "enviadoEm"
                 FROM birthday_greetings WHERE customer_id = $1 ORDER BY year DESC`,
              [cid],
            )
          : [],
      ]);

      await this.log(tx, tenantId, 'export', who, {
        orders: orders.length,
        reservations: reservations.length,
      });
      return {
        sobre:
          'Dados pessoais que este restaurante guarda de você no Comandou, como pede a LGPD (art. 18). ' +
          'Pedidos, pagamentos e notas fiscais ficam guardados pelo prazo da lei fiscal mesmo se você apagar a conta.',
        geradoEm: new Date().toISOString(),
        conta: account,
        enderecos: addresses,
        acessos: sessions,
        pedidos: orders,
        reservas: reservations,
        fidelidade: loyalty,
        programa: member ?? null,
        cupons: coupons,
        avaliacoes: reviews,
        conversaComALoja: storeChat,
        conversaNoWhatsApp: whatsapp,
        parabensDeAniversario: birthdays,
      };
    });
  }

  /** Apaga os dados do titular (ou explica o que trava). */
  async erase(tenantId: string, s: Subject, who: Requester): Promise<EraseResult> {
    return this.db.withTenant({ tenantId, userId: who.userId ?? null }, async (tx) => {
      const r = await one<{
        r: Omit<Partial<EraseResult>, 'status'> & { status: string; reason?: string };
      }>(tx, `SELECT app_privacy_erase($1, $2) AS r`, [
        s.customerId ?? null,
        s.customerId ? null : (s.phone ?? null),
      ]);
      const out = r!.r;
      if (out.status === 'not_found') throw new NotFoundException('Cliente não encontrado');
      if (out.status === 'bad_phone') throw new UnprocessableEntityException('Telefone inválido');
      if (out.status === 'blocked')
        throw new ConflictException({
          message: ERASE_BLOCKED[out.reason ?? ''] ?? 'Não deu para apagar agora',
          reason: out.reason,
        });
      const res = out as EraseResult;
      const { status: _s, ...summary } = res;
      await this.log(tx, tenantId, 'erase', who, summary);
      return res;
    });
  }

  /** Conta do cardápio com este telefone (mesma chave do apagar), se houver. */
  async customerByPhone(tenantId: string, userId: string, phone: string) {
    const r = await this.db.withTenant({ tenantId, userId }, (tx) =>
      one<{ id: string }>(
        tx,
        `SELECT id FROM customers WHERE app_phone_key(phone) = app_phone_key($1)
          ORDER BY (phone = $1) DESC, created_at LIMIT 1`,
        [phone],
      ),
    );
    return r?.id ?? null;
  }

  /** O que já foi atendido (para a equipe ver), sem dado pessoal. */
  history(ctx: { tenantId: string; userId?: string | null }) {
    return this.db.withTenant(ctx, (tx) =>
      q(
        tx,
        `SELECT r.id, r.kind, r.requested_by AS "requestedBy", r.summary, r.created_at AS "createdAt",
                u.name AS "actorName"
           FROM privacy_requests r LEFT JOIN users u ON u.id = r.actor_user_id
          ORDER BY r.created_at DESC LIMIT 100`,
      ),
    );
  }

  private async log(
    tx: Tx,
    tenantId: string,
    kind: 'export' | 'erase',
    who: Requester,
    summary: Record<string, unknown>,
  ) {
    await q(
      tx,
      `INSERT INTO privacy_requests (tenant_id, kind, requested_by, actor_user_id, summary)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [tenantId, kind, who.by, who.userId ?? null, JSON.stringify(summary)],
    );
    await this.audit.record(tx, {
      tenantId,
      actorUserId: who.userId ?? null,
      action: kind === 'export' ? 'customer.data_exported' : 'customer.data_erased',
      entity: 'privacy_request',
      data: { by: who.by, ...summary },
      ip: who.ip,
    });
  }
}
