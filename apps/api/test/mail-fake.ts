import type { INestApplication } from '@nestjs/common';
import { seal } from '../src/common/secret-box';
import { MAIL_SECRET, MailService } from '../src/mail/mail.service';
import { ownerQuery } from './fixtures';

/** Um e-mail que o sistema "mandou" pelo Resend falso dos testes. */
export interface SentMail {
  url: string;
  authorization: string;
  body: {
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    reply_to?: string;
    subject: string;
    html?: string;
    text?: string;
    headers?: Record<string, string>;
    attachments?: { filename: string; content: string; content_type: string }[];
  };
}

export const FAKE_RESEND_KEY = 're_teste_123';

/**
 * Liga o envio de e-mail do próprio Comandou pelo Resend, com a internet trocada por uma função:
 * cada e-mail entra em `sent`. `fail` faz o provedor recusar (status HTTP) enquanto estiver
 * definido. Devolve como desligar no fim do arquivo.
 */
export async function fakeMail(app: INestApplication, key: string, from = 'nao-responda@comandou.test') {
  const sent: SentMail[] = [];
  const state: { fail: number | null } = { fail: null };
  await ownerQuery(
    `UPDATE mail_settings SET provider = 'resend', from_address = $1, from_name = 'Comandou',
            resend_key_enc = $2`,
    [from, seal(key, FAKE_RESEND_KEY, MAIL_SECRET.resend)],
  );
  const mail = app.get(MailService);
  mail.fetcher = async (input, init) => {
    if (state.fail) return new Response(JSON.stringify({ message: 'recusado' }), { status: state.fail });
    const headers = new Headers(init?.headers);
    sent.push({
      url: String(input),
      authorization: headers.get('authorization') ?? '',
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify({ id: `fake-${sent.length}` }), { status: 200 });
  };
  return {
    sent,
    state,
    async off() {
      await ownerQuery(
        `UPDATE mail_settings SET provider = 'none', from_address = '', resend_key_enc = NULL`,
      );
    },
  };
}
