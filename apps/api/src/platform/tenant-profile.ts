import type { PoolClient } from 'pg';
import type { TenantProfileInput } from './platform.schemas';

/** Cadastro do cliente no painel (tabela tenant_profiles, só no banco central). */
export const PROFILE_COLS = `legal_name AS "legalName", document, contact_name AS "contactName", phone,
  billing_email AS "billingEmail", city, state, notes, updated_at AS "updatedAt"`;

export const EMPTY_PROFILE = {
  legalName: null,
  document: null,
  contactName: null,
  phone: null,
  billingEmail: null,
  city: null,
  state: null,
  notes: null,
  updatedAt: null,
};

const COLUMNS: [keyof TenantProfileInput, string][] = [
  ['legalName', 'legal_name'],
  ['document', 'document'],
  ['contactName', 'contact_name'],
  ['phone', 'phone'],
  ['billingEmail', 'billing_email'],
  ['city', 'city'],
  ['state', 'state'],
  ['notes', 'notes'],
];

/** Grava só os campos enviados (ausente = mantém; vazio = apaga). */
export async function saveProfile(c: PoolClient, tenantId: string, b: TenantProfileInput) {
  const sent = COLUMNS.filter(([k]) => b[k] !== undefined);
  await c.query(`INSERT INTO tenant_profiles (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`, [
    tenantId,
  ]);
  if (!sent.length) return;
  await c.query(
    `UPDATE tenant_profiles SET ${sent.map(([, col], i) => `${col} = $${i + 2}`).join(', ')}
      WHERE tenant_id = $1`,
    [tenantId, ...sent.map(([k]) => b[k] ?? null)],
  );
}
