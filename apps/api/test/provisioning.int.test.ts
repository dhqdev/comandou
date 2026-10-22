import { describe, expect, it } from 'vitest';
import { provisionTenant } from '../src/provisioning/provision';
import { OWNER_URL } from './env';
import { ownerQuery } from './fixtures';

const input = {
  slug: 'prov-idem',
  name: 'Provisionamento',
  adminEmail: 'dono@prov-idem.test',
  adminName: 'Dono',
  adminPassword: 'senha-longa-123',
};

describe('Provisionamento', () => {
  it('é idempotente: reexecutar não duplica recursos', async () => {
    const r1 = await provisionTenant(OWNER_URL, input);
    expect(r1.status).toBe('provisioned');
    expect(r1.stepsRun).toEqual([
      'tenant',
      'admin_user',
      'admin_membership',
      'defaults',
      'subscription',
      'activate',
    ]);
    const r2 = await provisionTenant(OWNER_URL, input);
    expect(r2).toEqual({ tenantId: r1.tenantId, status: 'provisioned', stepsRun: [] });
    const counts = await ownerQuery<{ t: number; m: number; c: number }>(
      `SELECT (SELECT count(*)::int FROM tenants WHERE slug = $1) t,
              (SELECT count(*)::int FROM memberships WHERE tenant_id = $2) m,
              (SELECT count(*)::int FROM categories WHERE tenant_id = $2) c`,
      [input.slug, r1.tenantId],
    );
    expect(counts[0]).toEqual({ t: 1, m: 1, c: 1 });
  });

  it('retoma após falha sem duplicar e só ativa no final', async () => {
    // Simula falha: e-mail já usado por outro usuário cuja inserção conflita? Usamos slug novo e
    // forçamos falha na etapa admin_membership removendo o usuário entre as etapas não é trivial;
    // então marcamos manualmente o estado "failed" após a 1ª etapa.
    const slug = 'prov-retoma';
    await ownerQuery(`INSERT INTO tenants (slug, name, status) VALUES ($1, 'Retoma', 'failed')`, [
      slug,
    ]);
    const [t] = await ownerQuery<{ id: string }>(`SELECT id FROM tenants WHERE slug = $1`, [slug]);
    await ownerQuery(
      `INSERT INTO tenant_provisioning_steps (tenant_id, step, status, attempts, last_error)
       VALUES ($1, 'tenant', 'done', 1, NULL), ($1, 'admin_user', 'failed', 1, 'timeout simulado')`,
      [t.id],
    );
    const r = await provisionTenant(OWNER_URL, {
      ...input,
      slug,
      adminEmail: 'dono@prov-retoma.test',
    });
    expect(r.stepsRun).toEqual([
      'admin_user',
      'admin_membership',
      'defaults',
      'subscription',
      'activate',
    ]);
    const [s] = await ownerQuery<{ status: string }>(`SELECT status FROM tenants WHERE id = $1`, [
      t.id,
    ]);
    expect(s.status).toBe('provisioned');
    const [step] = await ownerQuery<{ attempts: number; last_error: string | null }>(
      `SELECT attempts, last_error FROM tenant_provisioning_steps WHERE tenant_id = $1 AND step = 'admin_user'`,
      [t.id],
    );
    expect(step).toEqual({ attempts: 2, last_error: null });
  });

  it('rejeita slug inválido e senha curta', async () => {
    await expect(provisionTenant(OWNER_URL, { ...input, slug: 'admin' })).rejects.toThrow(/slug/);
    await expect(
      provisionTenant(OWNER_URL, { ...input, slug: 'ok-slug', adminPassword: 'curta' }),
    ).rejects.toThrow(/senha/);
  });
});
