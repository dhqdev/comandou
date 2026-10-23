import { isMoneyString, validateTenantSlug } from '@comandou/shared';
import { z } from 'zod';

export const LoginInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
  /** Vazio só vale em navegador confiável (já entrou com o código antes). */
  code: z
    .string()
    .trim()
    .regex(/^([0-9]{6})?$/, 'código de 6 dígitos')
    .default(''),
});

export const NewTenant = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .refine((s) => validateTenantSlug(s).ok, 'endereço inválido ou reservado'),
  name: z.string().trim().min(1).max(120),
  adminEmail: z.string().trim().toLowerCase().email().max(254),
  adminName: z.string().trim().min(1).max(120),
  adminPassword: z.string().min(10).max(200),
  planCode: z.string().trim().min(1).max(40).optional(),
});
export type NewTenantInput = z.infer<typeof NewTenant>;

export const DeleteTenant = z.object({
  confirm: z.string().trim().min(1).max(60),
  reason: z.string().trim().min(3).max(300),
});

export const StatusChange = z.object({
  status: z.enum(['suspended', 'provisioned']),
  reason: z.string().trim().min(3).max(300),
});
export type StatusInput = z.infer<typeof StatusChange>;

export const SubscriptionChange = z
  .object({
    planId: z.string().uuid().optional(),
    status: z.enum(['trialing', 'active', 'past_due', 'cancelled']),
    trialEndsAt: z.string().datetime({ offset: true }).optional(),
    currentPeriodEnd: z.string().datetime({ offset: true }).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.status === 'cancelled' || !!v.planId, {
    message: 'escolha o plano',
    path: ['planId'],
  });
export type SubscriptionInput = z.infer<typeof SubscriptionChange>;

const limit = z.number().int().positive().max(1_000_000).nullable().optional();
export const PlanBody = z.object({
  name: z.string().trim().min(1).max(80),
  priceMonthly: z
    .string()
    .refine(isMoneyString, 'valor com até 2 casas, ex.: "99.90"')
    .refine((v) => !v.startsWith('-'), 'valor não pode ser negativo'),
  maxUsers: limit,
  maxProducts: limit,
  maxOrdersMonth: limit,
  featureFiscal: z.boolean().default(false),
  featureWhatsapp: z.boolean().default(false),
  featureCustomDomain: z.boolean().default(false),
  trialDays: z.number().int().min(0).max(90).default(0),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type PlanInput = z.infer<typeof PlanBody>;
export const NewPlan = PlanBody.extend({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'código com letras minúsculas, números e hífen'),
});

export const SupportAccess = z.object({ userId: z.string().uuid().optional() });
export const RevokeSessions = z.object({ userId: z.string().uuid().optional() });
export const ResetPassword = z.object({
  userId: z.string().uuid(),
  password: z.string().min(10).max(200),
});
export const RenameTenant = z.object({ name: z.string().trim().min(1).max(120) });

export const ServerCleanup = z.object({
  targets: z
    .array(z.enum(['containers', 'images', 'unused-images', 'build-cache']))
    .min(1)
    .max(4),
});
export const ServiceName = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,120}$/);

export const SystemUpdate = z.object({ version: z.string().regex(/^v\d+\.\d+\.\d+$/) });

/** Backup no Backblaze B2 (ou outro S3). applicationKey vazia = manter a salva. */
export const BackupSettingsBody = z.object({
  enabled: z.boolean(),
  endpoint: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === '' || /^https?:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(v), {
      message: 'Endereço inválido. Ex.: https://s3.us-west-004.backblazeb2.com',
    }),
  region: z.string().trim().max(40).default(''),
  bucket: z
    .string()
    .trim()
    .max(63)
    .refine((v) => v === '' || /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/i.test(v), {
      message: 'Nome de bucket inválido',
    }),
  prefix: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/, 'Pasta com letras, números, ponto, hífen e /')
    .max(100)
    .default('comandou'),
  keyId: z.string().trim().max(200),
  applicationKey: z.string().trim().max(500).optional(),
  runAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário no formato HH:MM'),
  retentionDays: z.number().int().min(0).max(3650),
  restoreTestWeekday: z.number().int().min(0).max(7),
});
export type BackupSettingsInput = z.infer<typeof BackupSettingsBody>;
export const BackupRunRequest = z.object({ kind: z.enum(['backup', 'restore_test']) });
