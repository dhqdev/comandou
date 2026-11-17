import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import { fromCents, statementKeys, toCents } from '@comandou/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { isoDate, uuid } from '../common/schemas';
import { one, q } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService, Tx } from '../database/database.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { proposeMatches, type MatchEntry, type MatchLine, type Proposal } from './bank-match';

const signedMoney = z
  .string()
  .regex(/^-?\d{1,12}(\.\d{1,2})?$/, 'valor com até 2 casas')
  .refine((v) => toCents(v) !== 0, 'valor não pode ser zero');
const note = z.string().trim().min(3).max(300);
const ids = z.array(uuid).max(500);

const Account = z.object({
  name: z.string().trim().min(1).max(60),
  bankId: z.string().trim().max(20).optional(),
  accountRef: z.string().trim().max(40).optional(),
});
const AccountPatch = z
  .object({ name: z.string().trim().min(1).max(60).optional(), active: z.boolean().optional() })
  .refine((b) => b.name !== undefined || b.active !== undefined, 'nada para salvar');
const Import = z.object({
  lines: z
    .array(
      z.object({
        date: isoDate,
        amount: signedMoney,
        description: z.string().trim().min(1).max(200),
        fitId: z.string().trim().max(120).nullable().optional(),
      }),
    )
    .min(1, 'o extrato não tem lançamentos')
    .max(3000, 'até 3.000 linhas por arquivo'),
});
const LinesQuery = z.object({
  accountId: uuid.optional(),
  status: z.enum(['open', 'done', 'all']).default('all'),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
const Reconcile = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('settlement'),
    lineIds: ids.min(1),
    settlementIds: ids.min(1),
    note: note.optional(),
  }),
  z.object({
    kind: z.literal('manual'),
    settlementIds: ids.min(1),
    day: isoDate,
    amount: signedMoney,
    note: note.optional(),
  }),
  z.object({ kind: z.literal('entry'), lineIds: ids.min(1), entryId: uuid }),
  z.object({
    kind: z.literal('create'),
    lineIds: ids.min(1),
    description: z.string().trim().min(1).max(200),
    category: z.string().trim().max(60).optional(),
    counterparty: z.string().trim().max(120).optional(),
  }),
  z.object({ kind: z.literal('transfer'), lineIds: ids.min(1), note: note.optional() }),
  z.object({ kind: z.literal('ignored'), lineIds: ids.min(1), note: note.optional() }),
]);
type ReconcileBody = z.infer<typeof Reconcile>;

const LINE_COLS = `l.id, l.account_id AS "accountId", a.name AS "accountName", l.posted_at::text AS date,
  l.amount::text, l.description, l.reconciliation_id AS "reconciliationId"`;

/**
 * Conciliação bancária: contas do banco, extrato importado (OFX), e a ligação de cada linha com o
 * que o Comandou esperava: os recebíveis dos caixas fechados (cartão, PIX, vale) e as contas a
 * pagar e a receber. O que bate exatamente concilia sozinho; o resto vira sugestão.
 *
 * Nada é apagado em silêncio: a conciliação pode ser desfeita (as linhas e os recebíveis voltam a
 * ficar pendentes), menos quando ela baixou ou criou uma conta, que segue a regra do financeiro.
 */
@Controller({ path: 'finance/bank', version: '1' })
export class BankController {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  @Get('accounts')
  @RequirePermission('finance:read')
  accounts(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant(ctxOf(t, u), (tx) => this.listAccounts(tx));
  }

  @Post('accounts')
  @RequirePermission('finance:write')
  createAccount(
    @Body(new ZodPipe(Account)) b: z.infer<typeof Account>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const r = await one<{ id: string }>(
        tx,
        `INSERT INTO bank_accounts (tenant_id, name, bank_id, account_ref, created_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id, name) DO NOTHING RETURNING id`,
        [t.id, b.name, b.bankId || null, b.accountRef || null, u.id],
      );
      if (!r) throw new ConflictException('Já existe uma conta com este nome');
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'finance.bank_account_created',
        entity: 'bank_account',
        entityId: r.id,
        data: { name: b.name },
        ip: req.ip,
      });
      return (await this.listAccounts(tx)).find((a) => a.id === r.id);
    });
  }

  @Patch('accounts/:id')
  @RequirePermission('finance:write')
  updateAccount(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(AccountPatch)) b: z.infer<typeof AccountPatch>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const r = await one<{ id: string }>(
        tx,
        `UPDATE bank_accounts SET name = COALESCE($2, name), active = COALESCE($3, active)
          WHERE id = $1 RETURNING id`,
        [id, b.name ?? null, b.active ?? null],
      ).catch((e: { code?: string }) => {
        if (e.code === '23505') throw new ConflictException('Já existe uma conta com este nome');
        throw e;
      });
      if (!r) throw new NotFoundException('Conta não encontrada');
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'finance.bank_account_updated',
        entity: 'bank_account',
        entityId: id,
        data: b,
        ip: req.ip,
      });
      return (await this.listAccounts(tx)).find((a) => a.id === id);
    });
  }

  /**
   * Importa as linhas do extrato (lidas do OFX na tela). Linha já importada não entra de novo.
   * Depois concilia sozinho o que bate exatamente.
   */
  @Post('accounts/:id/import')
  @RequirePermission('finance:write')
  import(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Import)) b: z.infer<typeof Import>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const acc = await one<{ active: boolean }>(
        tx,
        `SELECT active FROM bank_accounts WHERE id = $1`,
        [id],
      );
      if (!acc) throw new NotFoundException('Conta não encontrada');
      if (!acc.active) throw new ConflictException('Esta conta está desativada');
      const lines = b.lines.map((l) => ({ ...l, fitId: l.fitId ?? null }));
      const keys = statementKeys(lines);
      const inserted = await q<{ id: string }>(
        tx,
        `INSERT INTO bank_statement_lines (tenant_id, account_id, posted_at, amount, description, fit_key, created_by)
         SELECT $1, $2, x.d, x.a, x.t, x.k, $3
           FROM unnest($4::date[], $5::numeric[], $6::text[], $7::text[]) AS x(d, a, t, k)
         ON CONFLICT (tenant_id, account_id, fit_key) DO NOTHING RETURNING id`,
        [
          t.id,
          id,
          u.id,
          lines.map((l) => l.date),
          lines.map((l) => l.amount),
          lines.map((l) => l.description),
          keys,
        ],
      );
      const auto = await this.runAuto(tx, t.id, u.id, id);
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'finance.bank_imported',
        entity: 'bank_account',
        entityId: id,
        data: { lines: lines.length, imported: inserted.length, autoMatched: auto },
        ip: req.ip,
      });
      return {
        imported: inserted.length,
        duplicates: lines.length - inserted.length,
        autoMatched: auto,
      };
    });
  }

  @Get('lines')
  @RequirePermission('finance:read')
  lines(
    @Query(new ZodPipe(LinesQuery)) f: z.infer<typeof LinesQuery>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const rows = await q<{
        id: string;
        accountId: string;
        accountName: string;
        date: string;
        amount: string;
        description: string;
        reconciliationId: string | null;
      }>(
        tx,
        `SELECT ${LINE_COLS} FROM bank_statement_lines l JOIN bank_accounts a ON a.id = l.account_id
          WHERE ($1::uuid IS NULL OR l.account_id = $1)
            AND ($2::text = 'all' OR ($2::text = 'open') = (l.reconciliation_id IS NULL))
            AND ($3::date IS NULL OR l.posted_at >= $3) AND ($4::date IS NULL OR l.posted_at <= $4)
          ORDER BY l.posted_at DESC, l.amount DESC LIMIT 1500`,
        [f.accountId ?? null, f.status, f.from ?? null, f.to ?? null],
      );
      const recIds = [...new Set(rows.map((r) => r.reconciliationId).filter(Boolean))] as string[];
      const recs = recIds.length
        ? await q<{
            id: string;
            kind: string;
            day: string;
            difference: string;
            auto: boolean;
            note: string | null;
            entrySettled: boolean;
            entryDescription: string | null;
            entryCategory: string | null;
            settlements: { method: string; day: string; net: string }[] | null;
            createdByName: string | null;
          }>(
            tx,
            `SELECT r.id, r.kind, r.day::text, r.difference::text, r.auto, r.note,
                    r.entry_settled AS "entrySettled", e.description AS "entryDescription",
                    e.category AS "entryCategory", us.name AS "createdByName",
                    (SELECT json_agg(json_build_object('method', fs.method, 'day', fs.day, 'net', fs.net::text)
                                     ORDER BY fs.day, fs.method)
                       FROM finance_settlements fs WHERE fs.reconciliation_id = r.id) AS settlements
               FROM bank_reconciliations r LEFT JOIN finance_entries e ON e.id = r.entry_id
               LEFT JOIN users us ON us.id = r.created_by
              WHERE r.id = ANY($1::uuid[])`,
            [recIds],
          )
        : [];
      const recById = new Map(recs.map((r) => [r.id, r]));
      // Sugestões para as linhas em aberto que estão na tela.
      const open = rows.filter((r) => !r.reconciliationId);
      const suggestions = new Map<string, Proposal>();
      if (open.length) {
        const c = await this.candidates(
          tx,
          open.map((l) => l.date),
        );
        for (const p of proposeMatches(
          open.map((l) => ({
            id: l.id,
            date: l.date,
            cents: toCents(l.amount),
            description: l.description,
          })),
          c.settlements,
          c.entries,
        ))
          for (const id of p.lineIds) suggestions.set(id, p);
      }
      const summary = await one<{ open: number; openIn: string; openOut: string }>(
        tx,
        `SELECT count(*)::int AS open,
                COALESCE(sum(amount) FILTER (WHERE amount > 0), 0)::numeric(14,2)::text AS "openIn",
                COALESCE(-sum(amount) FILTER (WHERE amount < 0), 0)::numeric(14,2)::text AS "openOut"
           FROM bank_statement_lines WHERE reconciliation_id IS NULL AND ($1::uuid IS NULL OR account_id = $1)`,
        [f.accountId ?? null],
      );
      return {
        summary,
        lines: rows.map((r) => ({
          ...r,
          reconciliation: r.reconciliationId ? (recById.get(r.reconciliationId) ?? null) : null,
          suggestion: suggestions.get(r.id) ?? null,
        })),
      };
    });
  }

  /** O que pode casar com uma linha ou um recebível perto deste dia (para a conciliação à mão). */
  @Get('candidates')
  @RequirePermission('finance:read')
  candidatesFor(
    @Query(new ZodPipe(z.object({ day: isoDate }))) b: { day: string },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const settlements = await q(
        tx,
        `SELECT fs.id, fs.day::text, fs.method, fs.gross::text, fs.fee::text, fs.net::text,
                fs.expected_date::text AS "expectedDate", s.number AS "sessionNumber", cr.name AS "registerName"
           FROM finance_settlements fs JOIN cash_sessions s ON s.id = fs.cash_session_id
           JOIN cash_registers cr ON cr.id = s.register_id
          WHERE fs.reconciliation_id IS NULL AND fs.expected_date BETWEEN $1::date - 10 AND $1::date + 10
          ORDER BY abs(fs.expected_date - $1::date), fs.method LIMIT 200`,
        [b.day],
      );
      const lines = await q(
        tx,
        `SELECT ${LINE_COLS} FROM bank_statement_lines l JOIN bank_accounts a ON a.id = l.account_id
          WHERE l.reconciliation_id IS NULL AND l.posted_at BETWEEN $1::date - 10 AND $1::date + 10
          ORDER BY abs(l.posted_at - $1::date), l.amount DESC LIMIT 300`,
        [b.day],
      );
      const entries = await q(
        tx,
        `SELECT e.id, e.kind, e.description, e.category, e.counterparty, e.amount::text, e.status,
                e.due_date::text AS "dueDate", e.paid_at::text AS "paidAt"
           FROM finance_entries e
          WHERE ((e.status = 'open' AND e.due_date BETWEEN $1::date - 45 AND $1::date + 45)
              OR (e.status = 'paid' AND e.paid_method IS DISTINCT FROM 'cash'
                  AND e.paid_at BETWEEN $1::date - 15 AND $1::date + 15))
            AND NOT EXISTS (SELECT 1 FROM bank_reconciliations r WHERE r.entry_id = e.id)
          ORDER BY abs(COALESCE(e.paid_at, e.due_date) - $1::date) LIMIT 200`,
        [b.day],
      );
      return { settlements, lines, entries };
    });
  }

  @Delete('lines/:id')
  @RequirePermission('finance:write')
  deleteLine(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const l = await one<{ reconciliation_id: string | null; amount: string; posted_at: string }>(
        tx,
        `SELECT reconciliation_id, amount::text, posted_at::text FROM bank_statement_lines WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!l) throw new NotFoundException('Linha não encontrada');
      if (l.reconciliation_id)
        throw new ConflictException('Linha conciliada: desfaça a conciliação antes de excluir');
      await q(tx, `DELETE FROM bank_statement_lines WHERE id = $1`, [id]);
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'finance.bank_line_deleted',
        entity: 'bank_statement_line',
        entityId: id,
        data: { amount: l.amount, date: l.posted_at },
        ip: req.ip,
      });
      return { ok: true };
    });
  }

  /** Roda de novo a conciliação automática (útil depois de fechar caixas ou lançar contas). */
  @Post('auto')
  @RequirePermission('finance:write')
  auto(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => ({
      autoMatched: await this.runAuto(tx, t.id, u.id),
    }));
  }

  @Post('reconcile')
  @RequirePermission('finance:write')
  reconcile(
    @Body(new ZodPipe(Reconcile)) b: ReconcileBody,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const r = await this.apply(tx, t.id, u.id, b, false);
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'finance.bank_reconciled',
        entity: 'bank_reconciliation',
        entityId: r.id,
        data: { ...b, difference: r.difference },
        ip: req.ip,
      });
      return r;
    });
  }

  @Delete('reconciliations/:id')
  @RequirePermission('finance:write')
  undo(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const r = await one<{ kind: string; entry_settled: boolean; lines_total: string }>(
        tx,
        `SELECT kind, entry_settled, lines_total::text FROM bank_reconciliations WHERE id = $1`,
        [id],
      );
      if (!r) throw new NotFoundException('Conciliação não encontrada');
      if (r.entry_settled)
        throw new ConflictException(
          'Esta conciliação baixou uma conta do financeiro e não pode ser desfeita; lance um estorno',
        );
      await q(
        tx,
        `UPDATE bank_statement_lines SET reconciliation_id = NULL WHERE reconciliation_id = $1`,
        [id],
      );
      await q(
        tx,
        `UPDATE finance_settlements SET reconciliation_id = NULL WHERE reconciliation_id = $1`,
        [id],
      );
      // Sem FOR UPDATE (a conciliação não é editável): duas pessoas desfazendo juntas, a
      // segunda não apaga nada.
      const gone = await one(tx, `DELETE FROM bank_reconciliations WHERE id = $1 RETURNING id`, [
        id,
      ]);
      if (!gone) throw new NotFoundException('Conciliação não encontrada');
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'finance.bank_reconciliation_undone',
        entity: 'bank_reconciliation',
        entityId: id,
        data: { kind: r.kind, linesTotal: r.lines_total },
        ip: req.ip,
      });
      return { ok: true };
    });
  }

  // ------------------------------------------------------------------------------- internos

  private async listAccounts(tx: Tx) {
    return q<{ id: string }>(
      tx,
      `SELECT a.id, a.name, a.bank_id AS "bankId", a.account_ref AS "accountRef", a.active,
              count(l.id)::int AS lines, (count(l.id) FILTER (WHERE l.reconciliation_id IS NULL))::int AS "openLines",
              max(l.posted_at)::text AS "lastDate"
         FROM bank_accounts a LEFT JOIN bank_statement_lines l ON l.account_id = a.id
        GROUP BY a.id ORDER BY a.active DESC, a.name`,
    );
  }

  /** Recebíveis pendentes e contas candidatas perto das datas das linhas. */
  private async candidates(tx: Tx, dates: string[]) {
    const from = dates.reduce((a, d) => (d < a ? d : a));
    const to = dates.reduce((a, d) => (d > a ? d : a));
    const settlements = (
      await q<{ id: string; method: string; day: string; expectedDate: string; net: string }>(
        tx,
        `SELECT id, method, day::text, expected_date::text AS "expectedDate", net::text
           FROM finance_settlements
          WHERE reconciliation_id IS NULL AND method <> 'cash'
            AND expected_date BETWEEN $1::date - 5 AND $2::date + 5`,
        [from, to],
      )
    ).map((s) => ({ ...s, cents: toCents(s.net) }));
    const entries = (
      await q<{
        id: string;
        kind: 'payable' | 'receivable';
        amount: string;
        date: string;
        open: boolean;
      }>(
        tx,
        `SELECT e.id, e.kind, e.amount::text, COALESCE(e.paid_at, e.due_date)::text AS date,
                (e.status = 'open') AS open
           FROM finance_entries e
          WHERE ((e.status = 'open' AND e.due_date BETWEEN $1::date - 15 AND $2::date + 15)
              OR (e.status = 'paid' AND e.paid_method IS DISTINCT FROM 'cash'
                  AND e.paid_at BETWEEN $1::date - 10 AND $2::date + 10))
            AND NOT EXISTS (SELECT 1 FROM bank_reconciliations r WHERE r.entry_id = e.id)`,
        [from, to],
      )
    ).map<MatchEntry>((e) => ({ ...e, cents: toCents(e.amount) }));
    return { settlements, entries };
  }

  /** Aplica as conciliações automáticas (valor exato) nas linhas em aberto. */
  private async runAuto(tx: Tx, tenantId: string, userId: string, accountId?: string) {
    const open = await q<{ id: string; date: string; amount: string; description: string }>(
      tx,
      `SELECT id, posted_at::text AS date, amount::text, description FROM bank_statement_lines
        WHERE reconciliation_id IS NULL AND ($1::uuid IS NULL OR account_id = $1)
        ORDER BY posted_at LIMIT 3000`,
      [accountId ?? null],
    );
    if (!open.length) return 0;
    const lines: MatchLine[] = open.map((l) => ({
      id: l.id,
      date: l.date,
      cents: toCents(l.amount),
      description: l.description,
    }));
    const c = await this.candidates(
      tx,
      lines.map((l) => l.date),
    );
    let n = 0;
    for (const p of proposeMatches(lines, c.settlements, c.entries)) {
      if (!p.auto) continue;
      await this.apply(
        tx,
        tenantId,
        userId,
        p.kind === 'settlement'
          ? { kind: 'settlement', lineIds: p.lineIds, settlementIds: p.settlementIds }
          : { kind: 'entry', lineIds: p.lineIds, entryId: p.entryId },
        true,
      );
      n += p.lineIds.length;
    }
    return n;
  }

  private async apply(tx: Tx, tenantId: string, userId: string, b: ReconcileBody, auto: boolean) {
    const lineIds = 'lineIds' in b ? [...new Set(b.lineIds)] : [];
    const settlementIds = 'settlementIds' in b ? [...new Set(b.settlementIds)] : [];
    const lines = lineIds.length
      ? await q<{ id: string; date: string; amount: string; reconciliation_id: string | null }>(
          tx,
          `SELECT id, posted_at::text AS date, amount::text, reconciliation_id
             FROM bank_statement_lines WHERE id = ANY($1::uuid[]) FOR UPDATE`,
          [lineIds],
        )
      : [];
    if (lines.length !== lineIds.length)
      throw new NotFoundException('Linha do extrato não encontrada');
    if (lines.some((l) => l.reconciliation_id))
      throw new ConflictException('Linha do extrato já conciliada');
    const settlements = settlementIds.length
      ? await q<{ id: string; net: string; reconciliation_id: string | null }>(
          tx,
          `SELECT id, net::text, reconciliation_id FROM finance_settlements WHERE id = ANY($1::uuid[]) FOR UPDATE`,
          [settlementIds],
        )
      : [];
    if (settlements.length !== settlementIds.length)
      throw new NotFoundException('Recebível não encontrado');
    if (settlements.some((s) => s.reconciliation_id))
      throw new ConflictException('Recebível já conciliado');

    const linesTotal = lines.reduce((a, l) => a + toCents(l.amount), 0);
    const lastDay = lines.reduce((a, l) => (l.date > a ? l.date : a), '');
    let target = settlements.reduce((a, s) => a + toCents(s.net), 0);
    let kind: 'settlement' | 'entry' | 'transfer' | 'ignored' | 'manual';
    let entryId: string | null = null;
    let entrySettled = false;
    let day = lastDay;
    let total = linesTotal;
    let noteText: string | null = 'note' in b ? (b.note ?? null) : null;

    if (b.kind === 'settlement') kind = 'settlement';
    else if (b.kind === 'manual') {
      kind = 'manual';
      day = b.day;
      total = toCents(b.amount);
    } else if (b.kind === 'transfer' || b.kind === 'ignored') {
      kind = b.kind;
      target = linesTotal;
    } else if (b.kind === 'entry') {
      kind = 'entry';
      const e = await one<{ kind: string; amount: string; status: string; description: string }>(
        tx,
        `SELECT kind, amount::text, status, description FROM finance_entries WHERE id = $1 FOR UPDATE`,
        [b.entryId],
      );
      if (!e) throw new NotFoundException('Lançamento não encontrado');
      if (e.status === 'cancelled') throw new ConflictException('Lançamento cancelado');
      const linked = await one(tx, `SELECT 1 FROM bank_reconciliations WHERE entry_id = $1`, [
        b.entryId,
      ]);
      if (linked)
        throw new ConflictException('Este lançamento já está ligado a outra linha do extrato');
      const signed = e.kind === 'payable' ? -toCents(e.amount) : toCents(e.amount);
      if (signed !== linesTotal)
        throw new UnprocessableEntityException(
          `O valor do extrato (${fromCents(linesTotal)}) é diferente do lançamento (${fromCents(signed)}). Se houve juros ou desconto, crie um lançamento com o valor da linha.`,
        );
      target = signed;
      entryId = b.entryId;
      if (e.status === 'open') {
        await q(
          tx,
          `UPDATE finance_entries SET status = 'paid', paid_at = $2, paid_method = 'transfer', settled_by = $3 WHERE id = $1`,
          [b.entryId, day, userId],
        );
        entrySettled = true;
      }
    } else {
      // Criar o lançamento a partir da linha (tarifa, compra no débito, recebimento avulso).
      kind = 'entry';
      const e = await one<{ id: string }>(
        tx,
        `INSERT INTO finance_entries (tenant_id, kind, description, category, counterparty, amount, due_date,
                                      status, paid_at, paid_method, settled_by, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'paid',$7,'transfer',$8,$8) RETURNING id`,
        [
          tenantId,
          linesTotal < 0 ? 'payable' : 'receivable',
          b.description,
          b.category || null,
          b.counterparty || null,
          fromCents(Math.abs(linesTotal)),
          day,
          userId,
        ],
      );
      entryId = e!.id;
      entrySettled = true;
      target = linesTotal;
      noteText = null;
    }
    const diff = kind === 'transfer' || kind === 'ignored' ? 0 : total - target;
    const r = await one<{ id: string }>(
      tx,
      `INSERT INTO bank_reconciliations (tenant_id, kind, day, lines_total, target_total, difference, entry_id,
                                         entry_settled, auto, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        tenantId,
        kind,
        day,
        fromCents(total),
        fromCents(target),
        fromCents(diff),
        entryId,
        entrySettled,
        auto,
        noteText,
        userId,
      ],
    );
    if (lineIds.length)
      await q(
        tx,
        `UPDATE bank_statement_lines SET reconciliation_id = $2 WHERE id = ANY($1::uuid[])`,
        [lineIds, r!.id],
      );
    if (settlementIds.length)
      await q(
        tx,
        `UPDATE finance_settlements SET reconciliation_id = $2 WHERE id = ANY($1::uuid[])`,
        [settlementIds, r!.id],
      );
    return { id: r!.id, kind, day, difference: fromCents(diff), entryId, entrySettled };
  }
}
