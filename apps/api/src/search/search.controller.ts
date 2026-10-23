import { Controller, Get, Query } from '@nestjs/common';
import { type Permission, roleHas } from '@comandou/shared';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser } from '../common/decorators';
import { q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';

/** Tipos de resultado da busca global. O app decide para onde cada um leva. */
export type SearchKind =
  | 'order'
  | 'tab'
  | 'table'
  | 'customer'
  | 'product'
  | 'category'
  | 'option'
  | 'stock_item'
  | 'member'
  | 'courier'
  | 'finance_entry'
  | 'cash_register'
  | 'cash_session'
  | 'sector'
  | 'print_agent';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  /** Linha de apoio (cliente, categoria, papel…). */
  detail: string | null;
  /** Id relacionado (comanda aberta da mesa, categoria do produto, grupo do adicional…). */
  ref: string | null;
  amount: string | null;
  status: string | null;
  at: string | null;
}

// Busca sem acento e sem maiúscula, sem depender de extensão do PostgreSQL.
const ACCENTED = 'ÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäåéèêëíìîïóòôõöúùûüçñ';
const PLAIN = 'AAAAAAEEEEIIIIOOOOOUUUUCNaaaaaaeeeeiiiiooooouuuucn';
const fold = (expr: string) => `lower(translate(${expr}, '${ACCENTED}', '${PLAIN}'))`;

/** Mesmo tratamento do lado do Node: minúsculas, sem acento. */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

interface Term {
  /** Palavras (já sem acento), cada uma vira um LIKE que precisa bater. */
  words: string[];
  /** Só os dígitos da busca (telefone, número de pedido). */
  digits: string;
  /** A busca inteira é um número ("123" ou "#123"). */
  number: number | null;
}

export function parseTerm(raw: string): Term | null {
  const text = raw.trim().slice(0, 80);
  if (!text) return null;
  const words = foldText(text)
    .split(/\s+/)
    .map((w) => w.replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 5);
  if (!words.length) return null;
  const digits = text.replace(/\D/g, '');
  const n = /^#?\s*(\d{1,9})$/.exec(text);
  return { words, digits, number: n ? Number(n[1]) : null };
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Monta "todas as palavras aparecem no texto" com parâmetros a partir de $start.
 * O texto (haystack) é uma expressão SQL; nunca recebe valor vindo do usuário.
 */
function allWords(haystack: string, words: string[], start: number) {
  const params = words.map((w) => `%${likeEscape(w)}%`);
  const sql = words.map((_, i) => `${fold(haystack)} LIKE $${start + i}`).join(' AND ');
  return { sql: `(${sql})`, params };
}

/** Começa com a primeira palavra: sobe na ordenação. */
function startsWith(expr: string, word: string, idx: number) {
  return { sql: `(${fold(expr)} LIKE $${idx})`, param: `${likeEscape(word)}%` };
}

interface Section {
  perms: Permission[];
  run(tx: Tx, t: Term): Promise<SearchHit[]>;
}

const hit = (h: Partial<SearchHit> & Pick<SearchHit, 'kind' | 'id' | 'title'>): SearchHit => ({
  detail: null,
  ref: null,
  amount: null,
  status: null,
  at: null,
  ...h,
});

/**
 * Cada seção só roda se o papel tiver a permissão da tela correspondente, e tudo corre dentro
 * de withTenant (RLS): a busca nunca enxerga dados de outro restaurante.
 */
const SECTIONS: Section[] = [
  {
    perms: ['orders:read'],
    async run(tx, t) {
      const hay = `o.number::text || ' ' || coalesce(o.customer_name, '') || ' ' ||
        coalesce(o.customer_phone, '') || ' ' || coalesce(o.delivery_address, '') || ' ' ||
        coalesce(dt.label, '') || ' ' || coalesce(tb.number::text, '')`;
      const w = allWords(hay, t.words, 1);
      const params: unknown[] = [...w.params];
      const or = [w.sql];
      let exact = '';
      if (t.number !== null) {
        params.push(t.number);
        exact = `o.number = $${params.length}`;
        or.push(exact);
      }
      if (t.digits.length >= 4) {
        params.push(`%${t.digits}%`);
        or.push(
          `regexp_replace(coalesce(o.customer_phone, ''), '\\D', '', 'g') LIKE $${params.length}`,
        );
      }
      const rows = await q<{
        id: string;
        number: number;
        channel: string;
        status: string;
        total: string;
        createdAt: Date;
        customerName: string | null;
        tableLabel: string | null;
      }>(
        tx,
        `SELECT o.id, o.number, o.channel, o.status, o.total::text AS total,
                o.created_at AS "createdAt", o.customer_name AS "customerName",
                dt.label AS "tableLabel"
           FROM orders o
           LEFT JOIN tabs tb ON tb.id = o.tab_id
           LEFT JOIN dining_tables dt ON dt.id = tb.table_id
          WHERE ${or.join(' OR ')}
          ORDER BY ${exact ? `(${exact}) DESC,` : ''} o.created_at DESC
          LIMIT 6`,
        params,
      );
      return rows.map((r) =>
        hit({
          kind: 'order',
          id: r.id,
          title: `Pedido #${r.number}`,
          detail: r.tableLabel ? `Mesa ${r.tableLabel}` : r.customerName,
          ref: r.channel,
          amount: r.total,
          status: r.status,
          at: r.createdAt.toISOString(),
        }),
      );
    },
  },
  {
    perms: ['tables:operate', 'payments:create'],
    async run(tx, t) {
      const hay = `'comanda ' || tb.number::text || ' ' || coalesce(tb.customer_name, '') || ' ' ||
        coalesce('mesa ' || dt.label, '')`;
      const w = allWords(hay, t.words, 1);
      const params: unknown[] = [...w.params];
      let exact = '';
      if (t.number !== null) {
        params.push(t.number);
        exact = `tb.number = $${params.length}`;
      }
      const rows = await q<{
        id: string;
        number: number;
        status: string;
        customerName: string | null;
        tableLabel: string | null;
        openedAt: Date;
      }>(
        tx,
        `SELECT tb.id, tb.number, tb.status, tb.customer_name AS "customerName",
                dt.label AS "tableLabel", tb.opened_at AS "openedAt"
           FROM tabs tb LEFT JOIN dining_tables dt ON dt.id = tb.table_id
          WHERE ${w.sql}${exact ? ` OR ${exact}` : ''}
          ORDER BY ${exact ? `(${exact}) DESC,` : ''} (tb.status = 'open') DESC, tb.opened_at DESC
          LIMIT 5`,
        params,
      );
      return rows.map((r) =>
        hit({
          kind: 'tab',
          id: r.id,
          title: `Comanda ${r.number}`,
          detail:
            [r.tableLabel && `Mesa ${r.tableLabel}`, r.customerName].filter(Boolean).join(' · ') ||
            null,
          status: r.status,
          at: r.openedAt.toISOString(),
        }),
      );
    },
  },
  {
    perms: ['tables:operate', 'payments:create'],
    async run(tx, t) {
      const w = allWords(`'mesa ' || d.label || ' ' || coalesce(d.area, '')`, t.words, 1);
      const s = startsWith('d.label', t.words[t.words.length - 1]!, w.params.length + 1);
      const rows = await q<{
        id: string;
        label: string;
        area: string | null;
        seats: number;
        tabId: string | null;
      }>(
        tx,
        `SELECT d.id, d.label, d.area, d.seats,
                (SELECT tb.id FROM tabs tb WHERE tb.table_id = d.id AND tb.status = 'open' LIMIT 1) AS "tabId"
           FROM dining_tables d
          WHERE d.active AND ${w.sql}
          ORDER BY ${s.sql} DESC, d.position, d.label
          LIMIT 5`,
        [...w.params, s.param],
      );
      return rows.map((r) =>
        hit({
          kind: 'table',
          id: r.id,
          title: `Mesa ${r.label}`,
          detail: [r.area, `${r.seats} lugares`].filter(Boolean).join(' · '),
          ref: r.tabId,
          status: r.tabId ? 'busy' : 'free',
        }),
      );
    },
  },
  {
    perms: ['customers:read'],
    async run(tx, t) {
      const w = allWords(`c.name || ' ' || coalesce(c.email, '')`, t.words, 1);
      const params: unknown[] = [...w.params];
      const or = [w.sql];
      if (t.digits.length >= 4) {
        params.push(`%${t.digits}%`);
        or.push(`c.phone LIKE $${params.length}`);
      }
      const rows = await q<{
        id: string;
        name: string;
        phone: string;
        email: string | null;
        blocked: boolean;
      }>(
        tx,
        `SELECT c.id, c.name, c.phone, c.email, c.blocked_at IS NOT NULL AS blocked
           FROM customers c
          WHERE ${or.join(' OR ')}
          ORDER BY c.name
          LIMIT 5`,
        params,
      );
      return rows.map((r) =>
        hit({
          kind: 'customer',
          id: r.id,
          title: r.name,
          detail: [r.phone, r.email].filter(Boolean).join(' · '),
          status: r.blocked ? 'blocked' : null,
        }),
      );
    },
  },
  {
    perms: ['catalog:read'],
    async run(tx, t) {
      const w = allWords(
        `p.name || ' ' || coalesce(p.description, '') || ' ' || c.name`,
        t.words,
        1,
      );
      const s = startsWith('p.name', t.words[0]!, w.params.length + 1);
      const rows = await q<{
        id: string;
        name: string;
        price: string;
        categoryId: string;
        category: string;
        active: boolean;
        soldOut: boolean;
      }>(
        tx,
        `SELECT p.id, p.name, p.price::text AS price, p.category_id AS "categoryId",
                c.name AS category, p.active, p.sold_out AS "soldOut"
           FROM products p JOIN categories c ON c.id = p.category_id
          WHERE ${w.sql}
          ORDER BY ${s.sql} DESC, p.active DESC, p.name
          LIMIT 6`,
        [...w.params, s.param],
      );
      return rows.map((r) =>
        hit({
          kind: 'product',
          id: r.id,
          title: r.name,
          detail: r.category,
          ref: r.categoryId,
          amount: r.price,
          status: !r.active ? 'inactive' : r.soldOut ? 'sold_out' : null,
        }),
      );
    },
  },
  {
    perms: ['catalog:read'],
    async run(tx, t) {
      const w = allWords('c.name', t.words, 1);
      const rows = await q<{ id: string; name: string; active: boolean; products: number }>(
        tx,
        `SELECT c.id, c.name, c.active,
                (SELECT count(*)::int FROM products p WHERE p.category_id = c.id) AS products
           FROM categories c WHERE ${w.sql} ORDER BY c.position, c.name LIMIT 3`,
        w.params,
      );
      return rows.map((r) =>
        hit({
          kind: 'category',
          id: r.id,
          title: r.name,
          detail: `${r.products} ${r.products === 1 ? 'produto' : 'produtos'}`,
          status: r.active ? null : 'inactive',
        }),
      );
    },
  },
  {
    perms: ['catalog:read'],
    async run(tx, t) {
      // Grupos de adicionais e as opções dentro deles ("Bacon extra" leva ao grupo).
      const w = allWords(`g.name || ' ' || coalesce(o.name, '')`, t.words, 1);
      const rows = await q<{
        groupId: string;
        groupName: string;
        optionName: string | null;
        priceDelta: string | null;
      }>(
        tx,
        `SELECT DISTINCT ON (g.id) g.id AS "groupId", g.name AS "groupName",
                o.name AS "optionName", o.price_delta::text AS "priceDelta"
           FROM option_groups g LEFT JOIN options o ON o.group_id = g.id AND o.active
          WHERE ${w.sql}
          ORDER BY g.id, o.position
          LIMIT 4`,
        w.params,
      );
      const groupHit = (r: (typeof rows)[number]) =>
        t.words.every((x) => foldText(r.groupName).includes(x));
      return rows.map((r) =>
        groupHit(r)
          ? hit({
              kind: 'option',
              id: r.groupId,
              title: r.groupName,
              detail: 'Grupo de adicionais',
            })
          : hit({
              kind: 'option',
              id: r.groupId,
              title: r.optionName ?? r.groupName,
              detail: `Adicional em ${r.groupName}`,
              amount: r.priceDelta,
            }),
      );
    },
  },
  {
    perms: ['stock:read'],
    async run(tx, t) {
      const w = allWords('s.name', t.words, 1);
      const rows = await q<{
        id: string;
        name: string;
        unit: string;
        quantity: string;
        low: boolean;
        active: boolean;
      }>(
        tx,
        `SELECT s.id, s.name, s.unit, s.quantity::text AS quantity,
                s.quantity < s.min_quantity AS low, s.active
           FROM stock_items s WHERE ${w.sql} ORDER BY s.active DESC, s.name LIMIT 4`,
        w.params,
      );
      return rows.map((r) =>
        hit({
          kind: 'stock_item',
          id: r.id,
          title: r.name,
          detail: `Saldo ${Number(r.quantity).toLocaleString('pt-BR')} ${r.unit}`,
          status: !r.active ? 'inactive' : r.low ? 'low' : null,
        }),
      );
    },
  },
  {
    perms: ['users:manage'],
    async run(tx, t) {
      const w = allWords(`u.name || ' ' || u.email`, t.words, 1);
      const rows = await q<{
        id: string;
        name: string;
        email: string;
        role: string;
        status: string;
      }>(
        tx,
        `SELECT u.id, u.name, u.email, m.role, m.status
           FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE ${w.sql} ORDER BY m.status, u.name LIMIT 4`,
        w.params,
      );
      return rows.map((r) =>
        hit({
          kind: 'member',
          id: r.id,
          title: r.name,
          detail: r.email,
          ref: r.role,
          status: r.status,
        }),
      );
    },
  },
  {
    perms: ['delivery:manage'],
    async run(tx, t) {
      const w = allWords('c.name', t.words, 1);
      const params: unknown[] = [...w.params];
      const or = [w.sql];
      if (t.digits.length >= 4) {
        params.push(`%${t.digits}%`);
        or.push(`regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') LIKE $${params.length}`);
      }
      const rows = await q<{ id: string; name: string; phone: string | null; active: boolean }>(
        tx,
        `SELECT c.id, c.name, c.phone, c.active FROM couriers c
          WHERE ${or.join(' OR ')} ORDER BY c.active DESC, c.name LIMIT 3`,
        params,
      );
      return rows.map((r) =>
        hit({
          kind: 'courier',
          id: r.id,
          title: r.name,
          detail: ['Entregador', r.phone].filter(Boolean).join(' · '),
          status: r.active ? null : 'inactive',
        }),
      );
    },
  },
  {
    perms: ['finance:read'],
    async run(tx, t) {
      const w = allWords(
        `f.description || ' ' || coalesce(f.counterparty, '') || ' ' || coalesce(f.category, '')`,
        t.words,
        1,
      );
      const rows = await q<{
        id: string;
        kind: string;
        description: string;
        counterparty: string | null;
        amount: string;
        status: string;
        dueDate: string;
      }>(
        tx,
        `SELECT f.id, f.kind, f.description, f.counterparty, f.amount::text AS amount, f.status,
                f.due_date::text AS "dueDate"
           FROM finance_entries f WHERE ${w.sql}
          ORDER BY (f.status = 'open') DESC, f.due_date DESC LIMIT 4`,
        w.params,
      );
      return rows.map((r) =>
        hit({
          kind: 'finance_entry',
          id: r.id,
          title: r.description,
          detail: [r.kind === 'payable' ? 'A pagar' : 'A receber', r.counterparty]
            .filter(Boolean)
            .join(' · '),
          amount: r.amount,
          status: r.status,
          at: r.dueDate,
        }),
      );
    },
  },
  {
    perms: ['cash:operate', 'cash:close', 'reports:read'],
    async run(tx, t) {
      const w = allWords(`'caixa ' || r.name`, t.words, 1);
      const rows = await q<{ id: string; name: string; sessionId: string | null }>(
        tx,
        `SELECT r.id, r.name,
                (SELECT s.id FROM cash_sessions s WHERE s.register_id = r.id AND s.status = 'open') AS "sessionId"
           FROM cash_registers r WHERE r.active AND ${w.sql} ORDER BY r.name LIMIT 3`,
        w.params,
      );
      const hits = rows.map((r) =>
        hit({
          kind: 'cash_register',
          id: r.id,
          title: r.name,
          detail: 'Terminal de caixa',
          ref: r.sessionId,
          status: r.sessionId ? 'open' : 'closed',
        }),
      );
      if (t.number !== null) {
        const s = await q<{
          id: string;
          number: number;
          status: string;
          register: string;
          openedAt: Date;
        }>(
          tx,
          `SELECT s.id, s.number, s.status, r.name AS register, s.opened_at AS "openedAt"
             FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id
            WHERE s.number = $1`,
          [t.number],
        );
        for (const r of s) {
          hits.push(
            hit({
              kind: 'cash_session',
              id: r.id,
              title: `Sessão de caixa nº ${r.number}`,
              detail: r.register,
              status: r.status,
              at: r.openedAt.toISOString(),
            }),
          );
        }
      }
      return hits;
    },
  },
  {
    perms: ['settings:manage'],
    async run(tx, t) {
      const w = allWords('s.name', t.words, 1);
      const rows = await q<{ id: string; name: string }>(
        tx,
        `SELECT s.id, s.name FROM production_sectors s WHERE ${w.sql} ORDER BY s.name LIMIT 3`,
        w.params,
      );
      return rows.map((r) =>
        hit({ kind: 'sector', id: r.id, title: r.name, detail: 'Setor de produção' }),
      );
    },
  },
  {
    perms: ['printing:manage'],
    async run(tx, t) {
      const w = allWords('a.name', t.words, 1);
      const rows = await q<{ id: string; name: string; active: boolean }>(
        tx,
        `SELECT a.id, a.name, a.active FROM print_agents a WHERE ${w.sql} ORDER BY a.name LIMIT 3`,
        w.params,
      );
      return rows.map((r) =>
        hit({
          kind: 'print_agent',
          id: r.id,
          title: r.name,
          detail: 'Agente de impressão',
          status: r.active ? null : 'inactive',
        }),
      );
    },
  },
];

/**
 * Busca global do sistema do restaurante (barra do topo e Ctrl+K). Procura em tudo que o papel
 * do usuário pode ver; telas e atalhos são resolvidos no próprio app.
 */
@Controller({ version: '1' })
export class SearchController {
  constructor(private readonly db: DatabaseService) {}

  @Get('search')
  async search(
    @Query('q') raw: string | undefined,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ results: SearchHit[] }> {
    const term = parseTerm(typeof raw === 'string' ? raw : '');
    if (!term) return { results: [] };
    const allowed = SECTIONS.filter((s) => s.perms.some((p) => roleHas(user.role, p)));
    const results = await this.db.withTenant(ctxOf(tenant, user), async (tx) => {
      const out: SearchHit[] = [];
      // Uma conexão por requisição: as seções rodam em sequência na mesma transação.
      for (const s of allowed) out.push(...(await s.run(tx, term)));
      return out;
    });
    return { results };
  }
}
