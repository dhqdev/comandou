/**
 * E-mail de boas-vindas do teste criado pelo site: endereço do restaurante, login e senha.
 * HTML de e-mail (tabelas e estilo na própria tag): abre igual no Gmail, Outlook e no celular,
 * no claro e no escuro. Sai pelo envio do próprio Comandou (Super Admin › E-mail).
 */
export interface WelcomeEmailInput {
  restaurant: string;
  contactName: string;
  /** Endereço do restaurante novo (https://<slug>.<domínio>). */
  url: string;
  loginEmail: string;
  password: string;
  trialDays: number;
  trialEndsAt: Date;
  /** Site do Comandou (https://<domínio>), para o logo e o rodapé. */
  siteUrl: string;
  /** WhatsApp ou e-mail de vendas (Super Admin › Cobrança). */
  salesContact?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? '';

export function trialEndLabel(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
const ORANGE = '#D63400';
const INK = '#18181B';
const MUTED = '#5D5D65';
const LINE = '#E3E3E6';

function row(label: string, value: string, mono = false, last = false) {
  return `<tr>
  <td style="padding:14px 20px;${last ? '' : `border-bottom:1px solid ${LINE};`}">
    <div style="font:500 12px/16px ${FONT};color:${MUTED};">${label}</div>
    <div style="font:600 ${mono ? `17px/24px ${MONO}` : `16px/24px ${FONT}`};color:${INK};word-break:break-all;">${value}</div>
  </td>
</tr>`;
}

function step(n: number, title: string, text: string) {
  return `<tr>
  <td width="36" valign="top" style="padding:0 0 18px;">
    <div style="width:26px;height:26px;border-radius:13px;background:#FFF2EC;color:#B02A00;font:600 13px/26px ${FONT};text-align:center;">${n}</div>
  </td>
  <td valign="top" style="padding:0 0 18px;">
    <div style="font:600 15px/22px ${FONT};color:${INK};">${title}</div>
    <div style="font:400 14px/21px ${FONT};color:${MUTED};">${text}</div>
  </td>
</tr>`;
}

export function welcomeEmail(i: WelcomeEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const name = firstName(i.contactName);
  const host = i.url.replace(/^https?:\/\//, '');
  const ends = trialEndLabel(i.trialEndsAt);
  const subject = `${i.restaurant} já está no ar no Comandou`;
  const preheader = `Seu endereço, login e senha. O teste vale por ${i.trialDays} dias.`;
  const contact = i.salesContact?.trim();

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
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

<tr><td style="padding:0 4px 20px;">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="padding-right:10px;"><img src="${esc(i.siteUrl)}/icons/icon-192.png" width="36" height="36" alt="" style="display:block;border-radius:9px;"></td>
    <td style="font:700 18px/24px ${FONT};color:${INK};letter-spacing:-0.2px;">Comandou</td>
  </tr></table>
</td></tr>

<tr><td style="background:#FFFFFF;border:1px solid ${LINE};border-radius:16px;padding:36px 32px 32px;">
  <h1 style="margin:0 0 10px;font:700 26px/32px ${FONT};color:${INK};letter-spacing:-0.4px;">${name ? `${esc(name)}, o ` : 'O '}${esc(i.restaurant)} já está no ar.</h1>
  <p style="margin:0 0 26px;font:400 16px/25px ${FONT};color:${MUTED};">Criamos o seu restaurante no Comandou. Ele é seu por ${i.trialDays} dias para testar tudo: cardápio online, pedidos, salão, cozinha e caixa.</p>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px;background:#FAFAFA;">
    ${row('Endereço do seu restaurante', `<a href="${esc(i.url)}" style="color:${INK};text-decoration:none;">${esc(host)}</a>`)}
    ${row('Login', esc(i.loginEmail))}
    ${row('Senha', esc(i.password), true, true)}
  </table>

  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 8px;"><tr>
    <td style="background:${ORANGE};border-radius:10px;">
      <a href="${esc(i.url)}" style="display:inline-block;padding:14px 26px;font:600 16px/20px ${FONT};color:#FFFFFF;text-decoration:none;">Abrir meu restaurante</a>
    </td>
  </tr></table>
  <p style="margin:0 0 30px;font:400 13px/20px ${FONT};color:${MUTED};">Troque a senha quando quiser em Configurações.</p>

  <div style="border-top:1px solid ${LINE};padding-top:26px;">
    <div style="font:600 13px/18px ${FONT};color:${MUTED};margin-bottom:16px;">Para começar</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${step(1, 'Monte o cardápio em minutos', 'Mande o PDF, tire foto do cardápio ou cole o link. A gente lê os itens, os preços e as fotos para você conferir.')}
      ${step(2, 'Deixe com a sua cara', 'Logo, cores, horário e endereço. A prévia da loja aparece ao lado enquanto você ajusta.')}
      ${step(3, 'Faça um pedido de teste', 'Abra o cardápio no celular, peça e veja o pedido chegar na cozinha e no caixa.')}
    </table>
  </div>

  <div style="background:#FFF6E0;border-radius:10px;padding:14px 16px;margin-top:8px;">
    <div style="font:400 14px/21px ${FONT};color:#5C3A00;">O teste vai até <strong>${esc(ends)}</strong>. Gostou? ${contact ? `Fale com a gente (<strong>${esc(contact)}</strong>)` : 'Responda este e-mail'} e o restaurante continua no ar, com tudo o que você cadastrou.</div>
  </div>
</td></tr>

<tr><td style="padding:22px 8px 0;font:400 12px/18px ${FONT};color:#7D7D85;text-align:center;">
  Você recebeu este e-mail porque criou um teste em <a href="${esc(i.siteUrl)}" style="color:#7D7D85;">${esc(i.siteUrl.replace(/^https?:\/\//, ''))}</a>.<br>
  Não foi você? É só ignorar: o teste se encerra sozinho.
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    `${name ? `${name}, o ` : 'O '}${i.restaurant} já está no ar no Comandou.`,
    '',
    `Endereço: ${i.url}`,
    `Login: ${i.loginEmail}`,
    `Senha: ${i.password}`,
    '',
    `O teste vai até ${ends}.`,
    contact ? `Gostou? Fale com a gente: ${contact}` : 'Gostou? Responda este e-mail.',
  ].join('\n');

  return { subject, html, text };
}
