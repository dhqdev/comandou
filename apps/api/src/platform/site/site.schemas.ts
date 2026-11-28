import { z } from 'zod';

const digits = (v: string) => v.replace(/\D/g, '');

const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((v) => v.toLowerCase())
  .nullable();
/** Foto do item: link de fora (o sistema baixa ao aplicar) ou a imagem anexada. */
const imageRef = z
  .string()
  .max(2048)
  .refine((v) => /^https?:\/\//i.test(v), 'Foto inválida')
  .nullable();
const money = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,2})?$/)
  .nullable();

/**
 * O que a pessoa combinou na conversa da criação pelo site (0.282): o cardápio conferido, a cara
 * da loja, como vende, contato, endereço e o tempo de preparo. Vai junto com a criação e o
 * sistema aplica sozinho no primeiro acesso, sem perguntar de novo.
 */
export const SetupBody = z.object({
  categories: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        items: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(120),
              description: z.string().trim().max(400).nullable(),
              price: money,
              /** Sem foto aqui: o servidor usa a do rascunho (pelo nome do item). */
              imageUrl: imageRef.optional(),
              stock: z
                .object({
                  qty: z.number().int().min(0).max(100_000),
                  min: z.number().int().min(0).max(100_000),
                })
                .nullable()
                .optional(),
            }),
          )
          .max(120),
      }),
    )
    .max(40)
    .refine((c) => c.reduce((n, x) => n + x.items.length, 0) <= 400, 'Até 400 itens'),
  store: z.object({
    brandColor: color,
    accentColor: color,
    /** Logo trocado na conversa (data URI pequeno) ou link; null = fica o que a IA achou. */
    logoUrl: z
      .string()
      .max(200_000)
      .refine(
        (v) =>
          /^https:\/\//i.test(v) || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v),
        'Logo inválido',
      )
      .nullable(),
    whatsapp: z
      .string()
      .transform(digits)
      .refine((v) => v === '' || (v.length >= 10 && v.length <= 13), 'WhatsApp com DDD')
      .transform((v) => v || null)
      .nullable(),
    address: z.string().trim().max(300).nullable(),
  }),
  sell: z.object({ delivery: z.boolean(), pickup: z.boolean(), tables: z.boolean() }),
  eta: z
    .object({ min: z.number().int().min(5).max(240), max: z.number().int().min(5).max(300) })
    .nullable(),
});
export type SetupInput = z.infer<typeof SetupBody>;

/** Cadastro do teste pelo site. */
export const TrialBody = z.object({
  restaurant: z.string().trim().min(2, 'Diga o nome do restaurante').max(80),
  name: z.string().trim().min(2, 'Diga o seu nome').max(120),
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(254),
  phone: z
    .string()
    .transform(digits)
    .refine((v) => v === '' || (v.length >= 10 && v.length <= 13), 'Telefone com DDD')
    .transform((v) => v || null)
    .nullable()
    .optional(),
  source: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('site'), value: z.string().trim().min(4).max(2000) }),
      z.object({ kind: z.literal('maps'), value: z.string().trim().min(8).max(2000) }),
      z.object({ kind: z.literal('text'), value: z.string().trim().min(10).max(6000) }),
      z.object({ kind: z.literal('compose'), value: z.string().trim().max(6000).default('') }),
      z.object({ kind: z.literal('none'), value: z.string().max(0).default('') }),
    ])
    .default({ kind: 'none', value: '' }),
  /** Token do site montado pela IA na página (o rascunho vai junto para o restaurante). */
  aiSite: z
    .string()
    .regex(/^[A-Za-z0-9_-]{32}$/)
    .optional(),
  /** Token do cardápio enviado na janela de criar (itens, preços e o estoque sugerido). */
  aiMenu: z
    .string()
    .regex(/^[A-Za-z0-9_-]{32}$/)
    .optional(),
  /** Sessão do visitante no site: junta no restaurante o que a IA fez antes do cadastro. */
  session: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,64}$/)
    .optional(),
  /** CNPJ ou CPF do restaurante (vai para o cadastro e para o contrato). */
  document: z
    .string()
    .transform(digits)
    .refine((v) => v === '' || v.length === 11 || v.length === 14, 'CPF (11) ou CNPJ (14 números)')
    .transform((v) => v || null)
    .nullable()
    .optional(),
  /** Razão social (ou o nome de quem assina, no CPF). */
  legalName: z
    .string()
    .trim()
    .max(160)
    .transform((v) => v || null)
    .nullable()
    .optional(),
  city: z.string().trim().max(80).nullable().optional(),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z]{2})?$/)
    .transform((v) => v || null)
    .nullable()
    .optional(),
  /** O que foi combinado na conversa da criação (aplicado sozinho no primeiro acesso). */
  setup: SetupBody.optional(),
  /** Campo escondido: gente não preenche, robô sim. */
  company: z.string().max(0).optional(),
});
export type TrialInput = z.infer<typeof TrialBody>;

export const PreviewBody = z.object({ url: z.string().trim().min(4).max(2000) });

export const SiteSettingsBody = z.object({
  signupEnabled: z.boolean(),
  /** Os dias de teste ficam no plano (Super Admin › Preço); o campo antigo é ignorado. */
  dailyLimit: z.number().int().min(1).max(1000),
});
export type SiteSettingsInput = z.infer<typeof SiteSettingsBody>;

export const TestEmailBody = z.object({ to: z.string().trim().toLowerCase().email().max(254) });

/** Uma mensagem do campo único da criação (texto e links). */
export const ComposeBody = z.object({
  text: z.string().trim().min(2, 'Escreva alguma coisa sobre o restaurante').max(6000),
  claim: z
    .string()
    .regex(/^[A-Za-z0-9_-]{32}$/)
    .optional(),
  session: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,64}$/)
    .optional(),
});
