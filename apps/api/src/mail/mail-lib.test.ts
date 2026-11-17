import { describe, expect, it } from 'vitest';
import { formatAddress, normalizeMessageId, parseAddressList } from './address';
import { composeHtml, frameDocument, hasRemoteImages, htmlToText, textToHtml } from './html';
import {
  buildIcs,
  freeSlots,
  occurrences,
  parseIcsReply,
  zonedDate,
  zonedToUtc,
} from './ics';
import { firstMatch, inboundSignature, shouldAutoReply, verifyInbound } from './inbound';
import { MailSendError, sendThrough } from './providers';

describe('endereços', () => {
  it('lê a lista digitada, tira repetidos e o que não é e-mail', () => {
    expect(parseAddressList('a@x.com, Fulano <B@Y.com>; a@x.com, lixo, "Ana" <ana@z.io>')).toEqual([
      { email: 'a@x.com' },
      { email: 'b@y.com', name: 'Fulano' },
      { email: 'ana@z.io', name: 'Ana' },
    ]);
  });

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

describe('HTML', () => {
  it('texto vira HTML escapado com links', () => {
    const h = textToHtml('Oi <b>\nveja https://comandou.com/x.\n\nTchau');
    expect(h).toContain('Oi &lt;b&gt;<br>veja <a href="https://comandou.com/x">https://comandou.com/x</a>.');
    expect(h).toContain('<p style="margin:0 0 14px">Tchau</p>');
  });

  it('HTML vira texto para resumo e busca', () => {
    expect(htmlToText('<style>p{}</style><p>Olá&nbsp;<b>mundo</b></p><p>&#65;&amp;</p>')).toBe(
      'Olá mundo\nA&',
    );
  });

  it('a moldura bloqueia script e imagem de fora até pedir', () => {
    const doc = frameDocument('<script>alert(1)</script><img src="https://x.com/p.gif"><p>oi</p>', {
      remoteImages: false,
    });
    expect(doc).not.toContain('<script');
    expect(doc).toContain("default-src 'none'; img-src data:;");
    expect(frameDocument('<p>x</p>', { remoteImages: true })).toContain('img-src data: https:');
    expect(hasRemoteImages('<img src="https://x.com/p.gif">')).toBe(true);
    expect(hasRemoteImages('<img src="cid:logo">')).toBe(false);
  });

  it('imagem anexada (cid:) entra embutida', () => {
    const doc = frameDocument('<img src="cid:Logo@1">', {
      remoteImages: false,
      inline: new Map([['logo@1', 'data:image/png;base64,AAA']]),
    });
    expect(doc).toContain('src="data:image/png;base64,AAA"');
  });

  it('resposta cita a mensagem original sem trazer script', () => {
    const h = composeHtml('Obrigado', 'David', {
      header: 'Em 1 de jan, Ana escreveu:',
      html: '<html><body><p>Pedido</p><script>x()</script></body></html>',
      text: 'Pedido',
    });
    expect(h).toContain('<blockquote');
    expect(h).toContain('<p>Pedido</p>');
    expect(h).not.toContain('<script');
  });
});

describe('recebimento', () => {
  const secret = 'segredo-do-worker';
  const raw = Buffer.from('Subject: oi\r\n\r\ncorpo');
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = inboundSignature(secret, ts, 'a@x.com', 'contato@comandou.com', raw);

  it('aceita só a assinatura certa, recente e do mesmo corpo', () => {
    const h = { timestamp: ts, from: 'a@x.com', to: 'contato@comandou.com', signature: sig };
    expect(verifyInbound(secret, h, raw)).toBe(true);
    expect(verifyInbound('outro', h, raw)).toBe(false);
    expect(verifyInbound(secret, { ...h, to: 'outro@comandou.com' }, raw)).toBe(false);
    expect(verifyInbound(secret, h, Buffer.from('trocado'))).toBe(false);
    expect(verifyInbound(secret, h, raw, Date.now() + 10 * 60_000)).toBe(false);
    expect(verifyInbound('', h, raw)).toBe(false);
  });

  it('regras: a primeira que combina, da caixa ou geral', () => {
    const rules = [
      { mailbox_id: 'outra', field: 'from' as const, op: 'contains' as const, value: 'x.com', action: 'spam' as const },
      { mailbox_id: null, field: 'subject' as const, op: 'contains' as const, value: 'NOTA', action: 'archive' as const },
      { mailbox_id: null, field: 'from' as const, op: 'ends_with' as const, value: '@x.com', action: 'star' as const },
    ];
    expect(firstMatch(rules, 'minha', { from: 'a@x.com', to: [], subject: 'nota fiscal' })?.action).toBe(
      'archive',
    );
    expect(firstMatch(rules, 'minha', { from: 'a@x.com', to: [], subject: 'oi' })?.action).toBe('star');
    expect(firstMatch(rules, 'minha', { from: 'a@y.com', to: [], subject: 'oi' })).toBeNull();
  });

  it('resposta automática nunca para robôs, listas ou outra resposta automática', () => {
    const h = (o: Record<string, string>) => new Map(Object.entries(o));
    expect(shouldAutoReply(h({}), 'ana@x.com')).toBe(true);
    expect(shouldAutoReply(h({}), 'no-reply@x.com')).toBe(false);
    expect(shouldAutoReply(h({}), 'mailer-daemon@x.com')).toBe(false);
    expect(shouldAutoReply(h({ 'auto-submitted': 'auto-replied' }), 'ana@x.com')).toBe(false);
    expect(shouldAutoReply(h({ 'list-id': '<l.x.com>' }), 'ana@x.com')).toBe(false);
    expect(shouldAutoReply(h({ precedence: 'bulk' }), 'ana@x.com')).toBe(false);
  });
});

describe('agenda', () => {
  it('convite .ics com escape, dobra de linha e repetição', () => {
    const ics = buildIcs(
      {
        uid: 'u1@comandou',
        sequence: 2,
        title: 'Reunião; com, vírgula',
        description: 'linha 1\nlinha 2 ' + 'x'.repeat(120),
        location: '',
        start: new Date('2026-11-20T13:00:00Z'),
        end: new Date('2026-11-20T14:00:00Z'),
        allDay: false,
        repeat: 'weekly',
        repeatUntil: '2026-12-31',
        organizer: { email: 'org@comandou.com', name: 'Org; "x"' },
        attendees: [{ email: 'ana@x.com', name: 'Ana', status: 'needs-action' }],
      },
      'REQUEST',
      new Date('2026-11-17T00:00:00Z'),
    );
    expect(ics).toContain('METHOD:REQUEST\r\n');
    expect(ics).toContain('SUMMARY:Reunião\\; com\\, vírgula');
    expect(ics).toContain('DTSTART:20261120T130000Z');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z');
    expect(ics).toContain('ORGANIZER;CN=Org   x:mailto:org@comandou.com');
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });

  it('lê a resposta do convidado', () => {
    const reply = [
      'BEGIN:VCALENDAR',
      'METHOD:REPLY',
      'BEGIN:VEVENT',
      'UID:u1@comandou',
      'ATTENDEE;PARTSTAT=ACCEPTED;CN=Ana:mailto:Ana@X.com',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseIcsReply(reply)).toEqual({ uid: 'u1@comandou', email: 'ana@x.com', status: 'accepted' });
    expect(parseIcsReply(reply.replace('REPLY', 'REQUEST'))).toBeNull();
  });

  it('fuso de São Paulo e repetição mensal pulando mês sem o dia', () => {
    expect(zonedToUtc('2026-11-20', '14:30', 'America/Sao_Paulo').toISOString()).toBe(
      '2026-11-20T17:30:00.000Z',
    );
    expect(zonedDate(new Date('2026-11-20T02:00:00Z'), 'America/Sao_Paulo')).toEqual({
      date: '2026-11-19',
      weekday: 4,
      time: '23:00',
    });
    const months = occurrences(
      { start: new Date('2026-01-31T12:00:00Z'), repeat: 'monthly', repeatUntil: null },
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-06-01T00:00:00Z'),
    ).map((d) => d.toISOString().slice(0, 10));
    expect(months).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  });

  it('horários livres tiram o que está ocupado, a folga e o que está perto demais', () => {
    const slots = freeSlots({
      date: '2026-11-20',
      windows: [['09:00', '12:00']],
      timeZone: 'America/Sao_Paulo',
      durationMin: 30,
      bufferMin: 15,
      busy: [{ start: new Date('2026-11-20T13:00:00Z'), end: new Date('2026-11-20T13:30:00Z') }],
      earliest: new Date('2026-11-20T12:10:00Z'),
      latest: new Date('2026-12-20T00:00:00Z'),
    }).map((d) => zonedDate(d, 'America/Sao_Paulo').time);
    // 09:00 é cedo demais; 09:30 a 10:30 batem com 10:00–10:30 mais a folga de 15 min.
    expect(slots).toEqual(['11:00', '11:30']);
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

  it('Cloudflare: monta o pedido e devolve o Message-ID', async () => {
    let seen: { url: string; body: Record<string, unknown>; auth: string } | null = null;
    const r = await sendThrough(
      { provider: 'cloudflare', accountId: 'acc1', token: 'tok' },
      mail,
      async (url, init) => {
        seen = {
          url: String(url),
          body: JSON.parse(String(init!.body)),
          auth: new Headers(init!.headers).get('authorization')!,
        };
        return Response.json({ success: true, errors: [], result: { message_id: 'm1@cf' } });
      },
    );
    expect(seen!.url).toBe('https://api.cloudflare.com/client/v4/accounts/acc1/email/sending/send');
    expect(seen!.auth).toBe('Bearer tok');
    expect(seen!.body).toMatchObject({
      from: '"Comandou" <a@comandou.com>',
      to: ['b@x.com'],
      subject: 'Oi',
      headers: { 'In-Reply-To': '<1@x>' },
    });
    expect(r.rfcId).toBe('<m1@cf>');
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
