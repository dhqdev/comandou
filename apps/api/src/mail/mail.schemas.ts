import { z } from 'zod';
import { isEmail } from './address';

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

export const MailSettingsBody = z.object({
  /** Ligado: os e-mails do sistema saem pelo Resend. Desligado: nenhum sai. */
  enabled: z.boolean(),
  fromAddress: optEmail,
  fromName: z.string().trim().max(80),
  replyTo: optEmail,
  /** Chave do Resend. Ausente: mantém; vazio: apaga; texto: troca. */
  resendKey: z.string().trim().max(500).optional(),
});
export type MailSettingsInput = z.infer<typeof MailSettingsBody>;

export const TestSendBody = z.object({ to: email });
