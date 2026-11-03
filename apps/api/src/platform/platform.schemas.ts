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
  /** Lembrar este navegador por TRUSTED_DEVICE_DAYS (sem pedir o código de novo). */
  remember: z.boolean().default(false),
});

/** Fusos do Brasil que o painel oferece ao criar o restaurante. */
export const BR_TIMEZONES = [
  'America/Sao_Paulo',
  'America/Bahia',
  'America/Fortaleza',
  'America/Recife',
  'America/Belem',
  'America/Manaus',
  'America/Cuiaba',
  'America/Campo_Grande',
  'America/Porto_Velho',
  'America/Boa_Vista',
  'America/Rio_Branco',
  'America/Noronha',
] as const;

const digits = (v: string) => v.replace(/\D/g, '');
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();

/** Cadastro do cliente (contato e cobrança). Tudo opcional; vazio vira nulo. */
export const TenantProfileBody = z.object({
  legalName: optText(160),
  document: z
    .string()
    .transform(digits)
    .refine((v) => v === '' || v.length === 11 || v.length === 14, 'CPF (11) ou CNPJ (14 dígitos)')
    .transform((v) => v || null)
    .nullable()
    .optional(),
  contactName: optText(120),
  phone: z
    .string()
    .transform(digits)
    .refine((v) => v === '' || (v.length >= 10 && v.length <= 13), 'telefone com DDD')
    .transform((v) => v || null)
    .nullable()
    .optional(),
  billingEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine((v) => v === '' || z.string().email().safeParse(v).success, 'e-mail inválido')
    .transform((v) => v || null)
    .nullable()
    .optional(),
  city: optText(80),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === '' || /^[A-Z]{2}$/.test(v), 'UF com 2 letras')
    .transform((v) => v || null)
    .nullable()
    .optional(),
  notes: optText(1000),
});
export type TenantProfileInput = z.output<typeof TenantProfileBody>;

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
  timezone: z.enum(BR_TIMEZONES).default('America/Sao_Paulo'),
  profile: TenantProfileBody.optional(),
});
export type NewTenantInput = Omit<z.infer<typeof NewTenant>, 'timezone'> & {
  timezone?: (typeof BR_TIMEZONES)[number];
};

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

// ------------------------------------------------------------------ contratos
const blankEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => v === '' || z.string().email().safeParse(v).success, 'e-mail inválido');
const percent = (min: number, max: number) =>
  z.coerce
    .number()
    .min(min)
    .max(max)
    .transform((v) => v.toFixed(2));

/** Dados da contratada, regras padrão do contrato e o webhook do n8n. Segredo vazio = manter. */
export const ContractSettingsBody = z.object({
  providerName: z.string().trim().max(160),
  providerDocument: z
    .string()
    .transform(digits)
    .refine((v) => v === '' || v.length === 11 || v.length === 14, 'CPF (11) ou CNPJ (14 dígitos)'),
  providerAddress: z.string().trim().max(240),
  providerEmail: blankEmail,
  providerRepresentative: z.string().trim().max(120),
  providerRepresentativeDocument: z
    .string()
    .transform(digits)
    .refine((v) => v === '' || isCpf(v), 'CPF inválido')
    .default(''),
  forumCity: z.string().trim().max(80),
  dueDay: z.number().int().min(1).max(28),
  termMonths: z.number().int().min(1).max(12),
  slaPercent: percent(90, 100),
  readjustIndex: z.string().trim().min(2).max(40),
  lateFeePercent: percent(0, 2),
  lateInterestPercent: percent(0, 10),
  suspendAfterDays: z.number().int().min(1).max(90),
  supportHours: z.string().trim().min(3).max(160),
  webhookUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || /^https?:\/\/[^\s]+$/i.test(v), 'Endereço com http:// ou https://'),
  webhookSecret: z.string().trim().max(200).optional(),
  clearWebhookSecret: z.boolean().optional(),
  notifyEmail: blankEmail,
});
export type ContractSettingsInput = z.infer<typeof ContractSettingsBody>;

const money = z
  .string()
  .refine(isMoneyString, 'valor com até 2 casas, ex.: "99.90"')
  .refine((v) => !v.startsWith('-'), 'valor não pode ser negativo');

/** Gerar um contrato: tudo opcional (vem do plano, do cadastro e das regras padrão). */
export const NewContract = z.object({
  planName: z.string().trim().min(1).max(80).optional(),
  priceMonthly: money.optional(),
  setupFee: money.optional(),
  dueDay: z.number().int().min(1).max(28).optional(),
  termMonths: z.number().int().min(1).max(12).optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'data AAAA-MM-DD')
    .optional(),
  trialDays: z.number().int().min(0).max(90).optional(),
  specialConditions: z.string().trim().max(3000).optional(),
  signerEmail: blankEmail.optional(),
});
export type NewContractInput = z.infer<typeof NewContract>;

export const SendContract = z.object({
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  message: z.string().trim().max(1000).optional(),
});
export const CancelContract = z.object({ reason: z.string().trim().min(3).max(300) });

const signatureInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('drawn'),
    image: z
      .string()
      .max(200_000)
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'imagem PNG'),
  }),
  z.object({ kind: z.literal('typed'), text: z.string().trim().min(3).max(80) }),
]);
/** Localização que o navegador informou (só se a pessoa permitiu). */
const geoInput = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(1_000_000),
  })
  .optional();
const fullName = z
  .string()
  .trim()
  .min(5)
  .max(120)
  .refine((v) => v.split(/\s+/).length >= 2, 'nome completo');
const hex64 = z.string().regex(/^[0-9a-f]{64}$/);

/** Assinatura pelo link público (CONTRATANTE, sempre a primeira). */
export const SignContract = z.object({
  name: fullName,
  document: z.string().transform(digits).refine(isCpf, 'CPF inválido'),
  email: z.string().trim().toLowerCase().email().max(254),
  accept: z.literal(true),
  contentHash: hex64,
  signature: signatureInput,
  geo: geoInput,
});
/** Assinatura da CONTRATADA no painel, depois do cliente, com o código do autenticador. */
export const CountersignContract = z.object({
  name: fullName,
  document: z.string().transform(digits).refine(isCpf, 'CPF inválido'),
  accept: z.literal(true),
  contentHash: hex64,
  /** O registro da assinatura do cliente que o admin viu na tela (não pode ter mudado). */
  clientEvidenceSha256: hex64,
  code: z.string().regex(/^[0-9]{6}$/, 'código de 6 dígitos'),
  signature: signatureInput,
  geo: geoInput,
});
export type CountersignContractInput = z.infer<typeof CountersignContract>;
export type SignContractInput = z.infer<typeof SignContract>;

/** Dígitos verificadores do CPF. */
export function isCpf(v: string): boolean {
  if (!/^\d{11}$/.test(v) || /^(\d)\1{10}$/.test(v)) return false;
  const dv = (len: number) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(v[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(v[9]) && dv(10) === Number(v[10]);
}

/** Servidor Postgres extra (painel → Bancos). Usuário e senha são os do servidor principal. */
export const DbServerBody = z.object({
  name: z.string().trim().min(2).max(60),
  host: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]([a-z0-9._-]{0,251}[a-z0-9])?$/, 'endereço inválido'),
  port: z.coerce.number().int().min(1).max(65535).default(5432),
  ssl: z.enum(['disable', 'require']).default('disable'),
  acceptsNew: z.boolean().default(false),
  note: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => v || null),
});
export const DbServerUpdate = DbServerBody.partial().extend({
  status: z.enum(['active', 'retired']).optional(),
});

/** Para onde levar o banco: id do servidor ou "main" (servidor principal). */
const ServerRef = z.union([z.literal('main'), z.string().uuid()]);
export const TransferDatabase = z.object({ to: ServerRef });
export const TransferAll = z.object({ from: ServerRef, to: ServerRef });
