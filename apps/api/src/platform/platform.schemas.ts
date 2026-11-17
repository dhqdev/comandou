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
  /** Manda o endereço, o login e a senha para o e-mail do dono (padrão: sim). */
  sendAccessEmail: z.boolean().default(true),
});
export type NewTenantInput = Omit<z.infer<typeof NewTenant>, 'timezone' | 'sendAccessEmail'> & {
  timezone?: (typeof BR_TIMEZONES)[number];
  sendAccessEmail?: boolean;
};

/** Excluir restaurante: basta confirmar no painel. Backup final só se pedido. */
export const DeleteTenant = z.object({
  confirm: z.string().trim().max(60).optional(),
  reason: z.string().trim().max(300).optional(),
  backup: z.boolean().optional(),
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
  // Página pública /precos (e cartões da tela Assinatura do restaurante).
  tagline: z.string().trim().max(160).default(''),
  highlights: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
  featured: z.boolean().default(false),
  showPublic: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
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

/** Pedido ao ajudante da VM (scripts/vm.sh). Reiniciar exige digitar REINICIAR no painel. */
export const VmAction = z
  .object({
    action: z.enum(['check', 'upgrade', 'upgrade-security', 'clean', 'restart-docker', 'reboot']),
    targets: z
      .array(z.enum(['apt', 'journal', 'logs', 'ram']))
      .max(4)
      .optional(),
    confirm: z.string().max(20).optional(),
  })
  .refine((b) => b.action !== 'clean' || (b.targets?.length ?? 0) > 0, {
    message: 'escolha o que limpar',
  })
  .refine((b) => !['reboot', 'restart-docker'].includes(b.action) || b.confirm === 'REINICIAR', {
    message: 'digite REINICIAR para confirmar',
  });
export const VmJobId = z.string().regex(/^[a-z0-9-]{8,40}$/);

export const SystemUpdate = z.object({ version: z.string().regex(/^v\d+\.\d+\.\d+$/) });

/** Atualização agendada de um restaurante (null cancela). */
export const TenantUpdateSchedule = z.object({
  at: z.string().datetime({ offset: true }).nullable(),
});

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

/** Dados da contratada e regras padrão do contrato (o e-mail sai por Super Admin › E-mail). */
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

// ------------------------------------------------------------------ orçamento
/** Preço por nota com até 3 casas ("0.055"). */
const unitPrice = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,3})?$/, 'valor com até 3 casas, ex.: "0.055"');

/** Valores padrão do orçamento e do custo da nota fiscal (vão também para o contrato). */
export const QuoteSettingsBody = z.object({
  fiscal: z.object({
    mode: z.enum(['passthrough', 'included']),
    monthly: money.refine((v) => Number(v) <= 10_000, 'até R$ 10.000'),
    nfceIncluded: z.number().int().min(0).max(1_000_000),
    nfeIncluded: z.number().int().min(0).max(1_000_000),
    nfceExtra: unitPrice,
    nfeExtra: unitPrice,
  }),
  setupFee: money.refine((v) => Number(v) <= 100_000, 'até R$ 100.000'),
  validityDays: z.number().int().min(1).max(90),
  extraCosts: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(80),
        value: z.string().trim().min(1).max(300),
      }),
    )
    .max(12),
  notes: z.string().trim().max(2000),
});
export type QuoteSettingsInput = z.infer<typeof QuoteSettingsBody>;

/** Gerar um orçamento: só o nome do cliente é obrigatório; o resto vem dos valores padrão. */
export const NewQuote = z.object({
  clientName: z.string().trim().min(1).max(160),
  clientDocument: z
    .string()
    .transform(digits)
    .refine((v) => v === '' || v.length === 11 || v.length === 14, 'CPF (11) ou CNPJ (14 dígitos)')
    .optional(),
  contactName: z.string().trim().max(120).optional(),
  email: blankEmail.optional(),
  phone: z.string().trim().max(30).optional(),
  city: z.string().trim().max(80).optional(),
  priceMonthly: money.optional(),
  setupFee: money.optional(),
  fiscal: z.boolean().default(true),
  nfcePerMonth: z.number().int().min(0).max(1_000_000).default(0),
  nfePerMonth: z.number().int().min(0).max(1_000_000).default(0),
  validityDays: z.number().int().min(1).max(90).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type NewQuoteInput = z.infer<typeof NewQuote>;

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

/** Migrar cliente: outra instalação do Comandou (stack de destino). */
export const StackBody = z.object({
  name: z.string().trim().min(2).max(60),
  url: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^https?:\/\/[a-z0-9.-]+(:[0-9]{1,5})?\/?$/,
      'endereço do painel, ex.: https://admin.dominio.com.br',
    )
    .transform((v) => v.replace(/\/$/, '')),
  /** Token gerado no painel de lá (Infraestrutura → Migrações → Receber). Vazio = mantém. */
  token: z.string().trim().max(200).optional(),
  note: z
    .string()
    .trim()
    .max(300)
    .transform((v) => v || null)
    .nullable()
    .default(null),
});

export const NewMigration = z.object({
  tenantId: z.string().uuid(),
  stackId: z.string().uuid(),
  mode: z.enum(['move', 'copy']).default('move'),
  /** Endereço no destino; vazio = o mesmo de hoje. */
  targetSlug: z
    .string()
    .trim()
    .toLowerCase()
    .max(40)
    .transform((v) => v || null)
    .nullable()
    .default(null)
    .refine((v) => v === null || validateTenantSlug(v).ok, 'endereço inválido'),
  backupBefore: z.boolean().default(true),
  keepSuspended: z.boolean().default(false),
  dropAtOrigin: z.boolean().default(false),
  /** Segue mesmo com a INTEGRATIONS_KEY diferente (tokens de integrações precisam ser refeitos). */
  ignoreKeyMismatch: z.boolean().default(false),
});

export const ReceiverBody = z.object({ enabled: z.boolean() });
