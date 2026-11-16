/**
 * E-mail com o código para o cliente criar uma nova senha no cardápio online. Sai com o nome do
 * restaurante (o cliente conhece a loja, não o Comandou). HTML de e-mail: tabelas e estilo na
 * própria tag, para abrir igual no Gmail, Outlook e no celular.
 */
export interface ResetEmailInput {
  restaurant: string;
  customerName?: string | null;
  code: string;
  minutes: number;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
const INK = '#18181B';
const MUTED = '#5D5D65';
const LINE = '#E3E3E6';

export function resetEmail(i: ResetEmailInput): { subject: string; html: string; text: string } {
  const name = (i.customerName ?? '').trim().split(/\s+/)[0] ?? '';
  const subject = `${i.code} é o seu código para criar uma nova senha em ${i.restaurant}`;
  const preheader = `O código vale por ${i.minutes} minutos.`;
  const spaced = `${i.code.slice(0, 3)} ${i.code.slice(3)}`;

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#F6F6F7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F6F7;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">

<tr><td style="padding:0 4px 18px;font:700 18px/24px ${FONT};color:${INK};letter-spacing:-0.2px;">${esc(i.restaurant)}</td></tr>

<tr><td style="background:#FFFFFF;border:1px solid ${LINE};border-radius:16px;padding:32px 28px 28px;">
  <h1 style="margin:0 0 10px;font:700 22px/28px ${FONT};color:${INK};letter-spacing:-0.3px;">${name ? `${esc(name)}, aqui está` : 'Aqui está'} o seu código</h1>
  <p style="margin:0 0 22px;font:400 15px/23px ${FONT};color:${MUTED};">Digite este código na tela de nova senha do cardápio de ${esc(i.restaurant)}.</p>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px;background:#FAFAFA;">
    <tr><td align="center" style="padding:20px 16px;font:700 32px/40px ${MONO};color:${INK};letter-spacing:6px;">${esc(spaced)}</td></tr>
  </table>

  <p style="margin:22px 0 0;font:400 14px/21px ${FONT};color:${MUTED};">O código vale por <strong style="color:${INK};">${i.minutes} minutos</strong> e só funciona uma vez. Sua senha continua a mesma até você digitar o código e escolher a nova.</p>
</td></tr>

<tr><td style="padding:20px 8px 0;font:400 12px/18px ${FONT};color:#7D7D85;text-align:center;">
  Não pediu uma nova senha? É só ignorar este e-mail: nada muda na sua conta.
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    `${name ? `${name}, aqui está` : 'Aqui está'} o seu código para criar uma nova senha em ${i.restaurant}:`,
    '',
    spaced,
    '',
    `O código vale por ${i.minutes} minutos e só funciona uma vez.`,
    'Não pediu? É só ignorar este e-mail: nada muda na sua conta.',
  ].join('\n');

  return { subject, html, text };
}
