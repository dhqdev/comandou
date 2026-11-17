import { z } from 'zod';
import { isEmail } from './address';
import { isTimeZone } from './ics';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => isEmail(v), 'E-mail inválido');
const optEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => v === '' || isEmail(v), 'E-mail inválido');
/** Chave ou senha. Ausente: mantém; vazio: apaga; texto: troca. */
const secret = z.string().trim().max(500).optional();

export const MailSettingsBody = z.object({
  provider: z.enum(['none', 'cloudflare', 'resend', 'smtp']),
  fromAddress: optEmail,
  fromName: z.string().trim().max(80),
  replyTo: optEmail,
  cfAccountId: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9]*$/, 'ID da conta inválido'),
  cfToken: secret,
  resendKey: secret,
  smtpHost: z
    .string()
    .trim()
    .max(255)
    .regex(/^[A-Za-z0-9.-]*$/, 'Servidor inválido'),
  smtpPort: z.number().int().min(1).max(65535),
  smtpSecure: z.boolean(),
  smtpUser: z.string().trim().max(255),
  smtpPass: secret,
});
export type MailSettingsInput = z.infer<typeof MailSettingsBody>;

export const TestSendBody = z.object({ to: email });

export const DomainBody = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .regex(
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/,
      'Domínio inválido (ex.: comandou.com)',
    ),
});

export const NewMailboxBody = z.object({
  domainId: z.string().uuid(),
  local: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/, 'Use letras, números, ponto, hífen ou sublinhado'),
  displayName: z.string().trim().max(80).default(''),
});

export const MailboxPatch = z
  .object({
    displayName: z.string().trim().max(80),
    signature: z.string().max(2000),
    catchAll: z.boolean(),
    autoReply: z.boolean(),
    autoReplySubject: z.string().trim().max(200),
    autoReplyBody: z.string().max(4000),
    forwardTo: optEmail,
    archived: z.boolean(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'nada para atualizar');
export type MailboxPatchInput = z.infer<typeof MailboxPatch>;

export const FOLDERS = ['inbox', 'sent', 'drafts', 'archive', 'spam', 'trash'] as const;
export type Folder = (typeof FOLDERS)[number];

export const DraftBody = z.object({
  mailboxId: z.string().uuid(),
  /** Destinatários como a pessoa digitou: "a@x.com, Fulano <b@y.com>". */
  to: z.string().max(4000).default(''),
  cc: z.string().max(4000).default(''),
  bcc: z.string().max(4000).default(''),
  subject: z.string().max(300).default(''),
  text: z.string().max(100_000).default(''),
  /** Mensagem respondida (encadeia a conversa) ou encaminhada (copia os anexos). */
  replyTo: z.string().uuid().optional(),
  forwardOf: z.string().uuid().optional(),
});
export type DraftInput = z.infer<typeof DraftBody>;

export const FlagsBody = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(200),
    /** Vale para a conversa inteira de cada mensagem informada. */
    thread: z.boolean().default(true),
    read: z.boolean().optional(),
    starred: z.boolean().optional(),
    folder: z.enum(['inbox', 'archive', 'spam', 'trash']).optional(),
  })
  .refine(
    (o) => o.read !== undefined || o.starred !== undefined || o.folder !== undefined,
    'nada para mudar',
  );
export type FlagsInput = z.infer<typeof FlagsBody>;

export const DeleteBody = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });

export const RuleBody = z.object({
  mailboxId: z.string().uuid().nullable().default(null),
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  field: z.enum(['from', 'to', 'subject']),
  op: z.enum(['contains', 'equals', 'ends_with']),
  value: z.string().trim().min(1).max(200),
  action: z.enum(['archive', 'spam', 'trash', 'star', 'read', 'reject']),
});
export type RuleInput = z.infer<typeof RuleBody>;

export const ContactBody = z.object({
  email,
  name: z.string().trim().max(120).default(''),
  company: z.string().trim().max(120).default(''),
  phone: z.string().trim().max(30).default(''),
  notes: z.string().trim().max(1000).default(''),
});
export type ContactInput = z.infer<typeof ContactBody>;

const timeZone = z
  .string()
  .max(64)
  .refine((v) => isTimeZone(v), 'Fuso inválido');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

export const EventBody = z
  .object({
    mailboxId: z.string().uuid().nullable().default(null),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).default(''),
    location: z.string().trim().max(300).default(''),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    allDay: z.boolean().default(false),
    timeZone: timeZone.default('America/Sao_Paulo'),
    color: z.enum(['brand', 'blue', 'green', 'purple', 'gray']).default('brand'),
    repeat: z.enum(['none', 'daily', 'weekly', 'monthly', 'yearly']).default('none'),
    repeatUntil: isoDate.nullable().default(null),
    attendees: z
      .array(z.object({ email, name: z.string().trim().max(120).default('') }))
      .max(40)
      .default([]),
    /** Manda (ou reenvia) o convite por e-mail aos convidados. */
    notify: z.boolean().default(true),
  })
  .refine((e) => new Date(e.endsAt) > new Date(e.startsAt), 'O fim precisa ser depois do começo');
export type EventInput = z.infer<typeof EventBody>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido');

export const BookingPageBody = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, 'Use letras minúsculas, números e hífen'),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(''),
  location: z.string().trim().max(300).default(''),
  durationMin: z.number().int().min(5).max(480),
  bufferMin: z.number().int().min(0).max(240).default(0),
  minNoticeHours: z.number().int().min(0).max(720).default(2),
  daysAhead: z.number().int().min(1).max(180).default(30),
  /** Dia da semana (0 = domingo) → janelas de atendimento. */
  availability: z.record(z.string().regex(/^[0-6]$/), z.array(z.tuple([hhmm, hhmm])).max(6)),
  timeZone: timeZone.default('America/Sao_Paulo'),
  mailboxId: z.string().uuid().nullable().default(null),
  enabled: z.boolean().default(true),
});
export type BookingPageInput = z.infer<typeof BookingPageBody>;

export const PublicBookingBody = z.object({
  start: z.string().datetime({ offset: true }),
  name: z.string().trim().min(2, 'Diga o seu nome').max(120),
  email,
  phone: z.string().trim().max(30).default(''),
  notes: z.string().trim().max(1000).default(''),
  /** Campo escondido: gente não preenche, robô sim. */
  company: z.string().max(0).optional(),
});
export type PublicBookingInput = z.infer<typeof PublicBookingBody>;
