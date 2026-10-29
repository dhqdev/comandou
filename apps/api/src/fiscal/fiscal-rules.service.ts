import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { suggestedRules } from '@comandou/shared';
import { AuditService } from '../audit/audit.service';
import type { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';

/** Padrão fiscal: a regra de tributação de um item (ver migração 0032). */
export interface FiscalRule {
  id: string;
  code: string;
  name: string;
  scope: 'all' | 'nfce' | 'nfe';
  active: boolean;
  isDefault: boolean;
  cfop: string;
  cfopInterstate: string | null;
  icmsCst: string;
  icmsOrigin: number;
  icmsRate: string | null;
  icmsBaseReduction: string | null;
  pisCst: string;
  pisRate: string | null;
  cofinsCst: string;
  cofinsRate: string | null;
  ipiCst: string | null;
  ipiRate: string | null;
  ibsCbsCst: string | null;
  ibsCbsClass: string | null;
  cbsRate: string | null;
  ibsUfRate: string | null;
  ibsMunRate: string | null;
  benefitCode: string | null;
  approxTaxRate: string | null;
  notes: string | null;
}

export type FiscalRuleInput = Partial<Omit<FiscalRule, 'code'>> & { code?: string | null };

const COLS: [keyof FiscalRule, string][] = [
  ['id', 'id'],
  ['code', 'code'],
  ['name', 'name'],
  ['scope', 'scope'],
  ['active', 'active'],
  ['isDefault', 'is_default'],
  ['cfop', 'cfop'],
  ['cfopInterstate', 'cfop_interstate'],
  ['icmsCst', 'icms_cst'],
  ['icmsOrigin', 'icms_origin'],
  ['icmsRate', 'icms_rate'],
  ['icmsBaseReduction', 'icms_base_reduction'],
  ['pisCst', 'pis_cst'],
  ['pisRate', 'pis_rate'],
  ['cofinsCst', 'cofins_cst'],
  ['cofinsRate', 'cofins_rate'],
  ['ipiCst', 'ipi_cst'],
  ['ipiRate', 'ipi_rate'],
  ['ibsCbsCst', 'ibs_cbs_cst'],
  ['ibsCbsClass', 'ibs_cbs_class'],
  ['cbsRate', 'cbs_rate'],
  ['ibsUfRate', 'ibs_uf_rate'],
  ['ibsMunRate', 'ibs_mun_rate'],
  ['benefitCode', 'benefit_code'],
  ['approxTaxRate', 'approx_tax_rate'],
  ['notes', 'notes'],
];
const NUMERIC = new Set([
  'icms_rate',
  'icms_base_reduction',
  'pis_rate',
  'cofins_rate',
  'ipi_rate',
  'cbs_rate',
  'ibs_uf_rate',
  'ibs_mun_rate',
  'approx_tax_rate',
]);
export const RULE_SELECT = COLS.map(([k, c]) =>
  NUMERIC.has(c) ? `trim_scale(r.${c})::text AS "${k}"` : `r.${c} AS "${k}"`,
).join(', ');
const WRITABLE = COLS.filter(([k]) => k !== 'id');

/** Item como a regra é resolvida: padrão do produto, padrão do NCM, padrão da empresa. */
export interface RuleTarget {
  productId: string;
  ncm: string | null;
  ruleId: string | null;
}
export type RuleSource = 'product' | 'ncm' | 'default' | 'line';

/** Padrões fiscais do restaurante e as ligações por NCM. */
@Injectable()
export class FiscalRulesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: Ctx) {
    return this.db.withTenant(ctx, async (tx) => {
      const rules = await q<FiscalRule & { products: number; ncms: string[] }>(
        tx,
        `SELECT ${RULE_SELECT},
                (SELECT count(*)::int FROM products p WHERE p.fiscal_rule_id = r.id) AS products,
                coalesce((SELECT array_agg(n.ncm ORDER BY n.ncm) FROM fiscal_ncm_rules n WHERE n.rule_id = r.id), '{}') AS ncms
           FROM fiscal_rules r ORDER BY r.is_default DESC, r.active DESC, r.code`,
      );
      const links = await q<{ ncm: string; ruleId: string; products: number }>(
        tx,
        `SELECT n.ncm, n.rule_id AS "ruleId",
                (SELECT count(*)::int FROM products p WHERE p.ncm = n.ncm AND p.fiscal_rule_id IS NULL) AS products
           FROM fiscal_ncm_rules n ORDER BY n.ncm`,
      );
      // Produtos que hoje ficariam sem padrão nenhum (nem próprio, nem NCM, nem padrão da empresa).
      const hasDefault = rules.some((r) => r.isDefault && r.active);
      const uncovered = hasDefault
        ? []
        : await q<{ id: string; name: string; code: string | null; ncm: string | null }>(
            tx,
            `SELECT p.id, p.name, p.code, p.ncm FROM products p
              WHERE p.active AND p.fiscal_rule_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM fiscal_ncm_rules n WHERE n.ncm = p.ncm)
              ORDER BY p.name LIMIT 200`,
          );
      return { rules, links, uncovered };
    });
  }

  private async getRow(tx: Tx, id: string) {
    const r = await one<FiscalRule>(
      tx,
      `SELECT ${RULE_SELECT} FROM fiscal_rules r WHERE r.id = $1`,
      [id],
    );
    if (!r) throw new NotFoundException('Padrão fiscal não encontrado');
    return r;
  }

  private async write(tx: Tx, ctx: Ctx, id: string | null, b: FiscalRuleInput) {
    if (b.isDefault)
      await tx.$client.query(
        `UPDATE fiscal_rules SET is_default = false WHERE is_default AND id IS DISTINCT FROM $1`,
        [id],
      );
    const fields = WRITABLE.filter(([k]) => b[k] !== undefined);
    if (id) {
      if (fields.length) {
        const sets = fields.map(([, c], i) => `${c} = $${i + 2}`).join(', ');
        const r = await one(tx, `UPDATE fiscal_rules SET ${sets} WHERE id = $1 RETURNING id`, [
          id,
          ...fields.map(([k]) => b[k]),
        ]);
        if (!r) throw new NotFoundException('Padrão fiscal não encontrado');
      }
    } else {
      const cols = ['tenant_id', ...fields.map(([, c]) => c)];
      const r = await one<{ id: string }>(
        tx,
        `INSERT INTO fiscal_rules (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        [ctx.tenantId, ...fields.map(([k]) => b[k] ?? null)],
      );
      id = r!.id;
    }
    await this.audit.record(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'fiscal.rule_saved',
      entity: 'fiscal_rule',
      entityId: id,
      data: b as Record<string, unknown>,
      ip: ctx.ip,
    });
    return this.getRow(tx, id);
  }

  async save(ctx: Ctx, id: string | null, b: FiscalRuleInput) {
    try {
      return await this.db.withTenant(ctx, (tx) => this.write(tx, ctx, id, b));
    } catch (err) {
      if ((err as { code?: string }).code === '23505')
        throw new ConflictException('Já existe um padrão fiscal com este código');
      throw err;
    }
  }

  remove(ctx: Ctx, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const r = await one(tx, `DELETE FROM fiscal_rules WHERE id = $1 RETURNING id`, [id]);
      if (!r) throw new NotFoundException('Padrão fiscal não encontrado');
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'fiscal.rule_deleted',
        entity: 'fiscal_rule',
        entityId: id,
        data: {},
        ip: ctx.ip,
      });
      return { ok: true };
    });
  }

  /** Cria os padrões sugeridos para o regime (só os nomes que ainda não existem). */
  createSuggested(ctx: Ctx, regime: number | null) {
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await q<{ name: string; isDefault: boolean }>(
        tx,
        `SELECT name, is_default AS "isDefault" FROM fiscal_rules`,
      );
      const names = new Set(existing.map((e) => e.name.toLowerCase()));
      const hasDefault = existing.some((e) => e.isDefault);
      let created = 0;
      for (const s of suggestedRules(regime)) {
        if (names.has(s.name.toLowerCase())) continue;
        await this.write(tx, ctx, null, {
          name: s.name,
          scope: s.scope,
          cfop: s.cfop,
          icmsCst: s.icmsCst,
          pisCst: s.pisCst,
          cofinsCst: s.cofinsCst,
          isDefault: !!s.isDefault && !hasDefault,
          notes: s.notes,
        });
        created++;
      }
      return { created };
    });
  }

  /** Liga (ou desliga, com ruleId null) um NCM a um padrão fiscal. */
  setNcm(ctx: Ctx, ncm: string, ruleId: string | null) {
    return this.db.withTenant(ctx, async (tx) => {
      if (ruleId === null)
        await tx.$client.query(`DELETE FROM fiscal_ncm_rules WHERE ncm = $1`, [ncm]);
      else {
        await this.getRow(tx, ruleId);
        await tx.$client.query(
          `INSERT INTO fiscal_ncm_rules (tenant_id, ncm, rule_id) VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, ncm) DO UPDATE SET rule_id = EXCLUDED.rule_id`,
          [ctx.tenantId, ncm, ruleId],
        );
      }
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'fiscal.ncm_rule_set',
        entity: 'fiscal_rule',
        entityId: ruleId,
        data: { ncm },
        ip: ctx.ip,
      });
      return { ncm, ruleId };
    });
  }

  /** Padrões ativos que valem para o tipo de nota, por id. */
  async activeRules(tx: Tx, kind: 'nfce' | 'nfe') {
    const rules = await q<FiscalRule>(
      tx,
      `SELECT ${RULE_SELECT} FROM fiscal_rules r WHERE r.active AND r.scope IN ('all', $1)`,
      [kind],
    );
    return new Map(rules.map((r) => [r.id, r]));
  }

  /**
   * Resolve o padrão de cada item: o do produto, o do NCM ou o padrão da empresa.
   * Devolve null para o item sem padrão nenhum.
   */
  async resolve(tx: Tx, kind: 'nfce' | 'nfe', items: RuleTarget[]) {
    const rules = await this.activeRules(tx, kind);
    const ncm = new Map(
      (
        await q<{ ncm: string; ruleId: string }>(
          tx,
          `SELECT ncm, rule_id AS "ruleId" FROM fiscal_ncm_rules`,
        )
      ).map((n) => [n.ncm, n.ruleId]),
    );
    const def = [...rules.values()].find((r) => r.isDefault) ?? null;
    return {
      rules,
      items: items.map((i) => {
        const own = i.ruleId ? rules.get(i.ruleId) : undefined;
        if (own) return { rule: own, source: 'product' as RuleSource };
        const byNcm = i.ncm ? rules.get(ncm.get(i.ncm) ?? '') : undefined;
        if (byNcm) return { rule: byNcm, source: 'ncm' as RuleSource };
        if (def) return { rule: def, source: 'default' as RuleSource };
        return { rule: null, source: null };
      }),
    };
  }
}
