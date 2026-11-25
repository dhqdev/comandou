import { describe, expect, it } from 'vitest';
import { formatAddress, maskSubject, normalizeMessageId } from './address';
import { MailSendError, sendThrough } from './providers';

describe('endereços', () => {
  it('nome com quebra de linha ou aspas não vira cabeçalho novo', () => {
    expect(formatAddress({ email: 'a@x.com', name: 'Eu\r\nBcc: alvo@y.com "x"' })).toBe(
      '"Eu Bcc: alvo@y.com x" <a@x.com>',
    );
  });

  it('Message-ID sempre com < > e nada fora do formato', () => {
    expect(normalizeMessageId('abc@x.com')).toBe('<abc@x.com>');
    expect(normalizeMessageId('<abc@x.com>')).toBe('<abc@x.com>');
    expect(normalizeMessageId('a b@x')).toBeNull();
    expect(normalizeMessageId(undefined)).toBeNull();
  });
});

describe('assunto com código', () => {
  it('mascara o código e mantém o resto do assunto', () => {
    expect(maskSubject('482913 é o seu código do Comandou')).toBe(
      '•••• é o seu código do Comandou',
    );
    expect(maskSubject('Código AB12-CD34 para entrar')).toBe('Código •••• para entrar');
    expect(maskSubject('Pedido #12 saiu às 19h')).toBe('Pedido #12 saiu às 19h');
    expect(maskSubject('Bem-vindo ao Comandou')).toBe('Bem-vindo ao Comandou');
  });
});

describe('provedores', () => {
  const mail = {
    from: { email: 'a@comandou.com', name: 'Comandou' },
    to: [{ email: 'b@x.com' }],
    cc: [],
    bcc: [],
    subject: 'Oi',
    text: 'oi',
    headers: { 'In-Reply-To': '<1@x>' },
    attachments: [],
  };

  it('Resend: monta o pedido com o Message-ID e devolve o id do Resend', async () => {
    let seen: { url: string; body: Record<string, unknown>; auth: string } | null = null;
    const r = await sendThrough(
      { provider: 'resend', apiKey: 're_k' },
      { ...mail, rfcId: '<1@comandou.com>' },
      async (url, init) => {
        seen = {
          url: String(url),
          body: JSON.parse(String(init!.body)),
          auth: new Headers(init!.headers).get('authorization')!,
        };
        return Response.json({ id: 'rs_1' });
      },
    );
    expect(seen!.url).toBe('https://api.resend.com/emails');
    expect(seen!.auth).toBe('Bearer re_k');
    expect(seen!.body).toMatchObject({
      from: '"Comandou" <a@comandou.com>',
      to: ['b@x.com'],
      subject: 'Oi',
      headers: { 'In-Reply-To': '<1@x>', 'Message-ID': '<1@comandou.com>' },
    });
    expect(r).toEqual({ rfcId: '<1@comandou.com>', providerId: 'rs_1' });
  });

  it('erro do provedor: 5xx tenta de novo, 4xx desiste', async () => {
    const fail = (status: number) => () =>
      Promise.resolve(Response.json({ message: 'x' }, { status }));
    const cfg = { provider: 'resend' as const, apiKey: 'k' };
    await expect(sendThrough(cfg, mail, fail(503))).rejects.toMatchObject({ permanent: false });
    await expect(sendThrough(cfg, mail, fail(429))).rejects.toMatchObject({ permanent: false });
    await expect(sendThrough(cfg, mail, fail(422))).rejects.toMatchObject({ permanent: true });
    await expect(sendThrough(cfg, { ...mail, to: [] }, fail(200))).rejects.toBeInstanceOf(
      MailSendError,
    );
  });
});
