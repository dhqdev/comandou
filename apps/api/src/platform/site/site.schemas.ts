import { z } from 'zod';

const digits = (v: string) => v.replace(/\D/g, '');

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
      z.object({ kind: z.literal('none'), value: z.string().max(0).default('') }),
    ])
    .default({ kind: 'none', value: '' }),
  /** Token do site montado pela IA na página (o rascunho vai junto para o restaurante). */
  aiSite: z
    .string()
    .regex(/^[A-Za-z0-9_-]{32}$/)
    .optional(),
  /** Campo escondido: gente não preenche, robô sim. */
  company: z.string().max(0).optional(),
});
export type TrialInput = z.infer<typeof TrialBody>;

export const PreviewBody = z.object({ url: z.string().trim().min(4).max(2000) });

export const SiteSettingsBody = z.object({
  signupEnabled: z.boolean(),
  /** Os dias de teste ficam no plano (Super Admin › Preço); o campo antigo é ignorado. */
  dailyLimit: z.number().int().min(1).max(1000),
  emailWebhookUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'Endereço do webhook inválido'),
  /** Ausente: mantém; vazio: apaga; texto: troca. */
  emailToken: z.string().trim().max(200).optional(),
  /** Webhook dos e-mails para os clientes dos restaurantes (código de nova senha). Ausente: mantém. */
  customerEmailWebhookUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'Endereço do webhook inválido')
    .optional(),
  customerEmailToken: z.string().trim().max(200).optional(),
});
export type SiteSettingsInput = z.infer<typeof SiteSettingsBody>;

export const TestEmailBody = z.object({ to: z.string().trim().toLowerCase().email().max(254) });
