import {
  boolean,
  customType,
  inet,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  jsonb,
  bigint,
  smallint,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull(),
  timezone: text('timezone').notNull(),
  currency: text('currency').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  isPlatformAdmin: boolean('is_platform_admin').notNull(),
  disabledAt: ts('disabled_at'),
});

export const memberships = pgTable(
  'memberships',
  {
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] })],
);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  tokenHash: bytea('token_hash').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  ip: inet('ip'),
  userAgent: text('user_agent'),
  supportAdminName: text('support_admin_name'),
});

export const auditLog = pgTable('audit_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid('tenant_id').notNull(),
  actorUserId: uuid('actor_user_id'),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  data: jsonb('data').notNull().default({}),
  ip: inet('ip'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
  active: boolean('active').notNull().default(true),
  /** Foto da categoria (tabela media). */
  imageId: uuid('image_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  categoryId: uuid('category_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  /** NUMERIC(14,2) — trafega como string para não perder precisão. */
  price: numeric('price', { precision: 14, scale: 2 }).notNull(),
  active: boolean('active').notNull().default(true),
  soldOut: boolean('sold_out').notNull().default(false),
  sectorId: uuid('sector_id'),
  position: integer('position').notNull().default(0),
  /** Foto do produto (tabela media). */
  imageId: uuid('image_id'),
  /** Dados fiscais (NFC-e). Vazios usam o padrão da configuração fiscal do restaurante. */
  ncm: text('ncm'),
  cfop: text('cfop'),
  fiscalCode: text('fiscal_code'),
  fiscalOrigin: smallint('fiscal_origin'),
  fiscalUnit: text('fiscal_unit'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const schema = { tenants, users, memberships, sessions, auditLog, categories, products };
