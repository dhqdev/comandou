/**
 * Comandou: Worker de recebimento de e-mail (Cloudflare Email Routing).
 *
 * O MX do domínio fica na Cloudflare. Cada e-mail que chega para um endereço roteado para este
 * Worker é entregue ao Comandou em POST <COMANDOU_URL>/api/v1/platform/mail/inbound, assinado
 * com HMAC-SHA256 (o segredo é criado em Super Admin › E-mail › Recebimento). O Comandou responde
 * o que fazer: guardar, recusar (o remetente recebe a devolução) ou guardar e encaminhar uma cópia.
 *
 * Se o Comandou estiver fora do ar, o Worker lança erro: a Cloudflare devolve "falha temporária"
 * ao servidor de quem mandou, que tenta de novo mais tarde. Nada se perde.
 */
export interface Env {
  /** Endereço do painel, ex.: https://admin.comandou.com */
  COMANDOU_URL: string;
  /** Segredo mostrado em Super Admin › E-mail › Recebimento (wrangler secret put INBOUND_SECRET). */
  INBOUND_SECRET: string;
}

interface Decision {
  action: 'store' | 'reject';
  reason?: string;
  forwardTo?: string;
}

/** O mesmo limite do Email Routing (e do Comandou). */
const MAX_BYTES = 25 * 1024 * 1024;

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** HMAC de `v1\n<timestamp>\n<de>\n<para>\n<sha256 do corpo>`: igual a apps/api/src/mail/inbound.ts. */
async function sign(secret: string, ts: string, from: string, to: string, raw: ArrayBuffer) {
  const bodyHash = hex(await crypto.subtle.digest('SHA-256', raw));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const data = new TextEncoder().encode(`v1\n${ts}\n${from}\n${to}\n${bodyHash}`);
  return hex(await crypto.subtle.sign('HMAC', key, data));
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    if (message.rawSize > MAX_BYTES) {
      message.setReject('Mensagem maior que 25 MB. Mande um link para o arquivo.');
      return;
    }
    const raw = await new Response(message.raw).arrayBuffer();
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await fetch(`${env.COMANDOU_URL.replace(/\/+$/, '')}/api/v1/platform/mail/inbound`, {
      method: 'POST',
      headers: {
        'Content-Type': 'message/rfc822',
        'X-Comandou-Timestamp': ts,
        'X-Comandou-From': message.from,
        'X-Comandou-To': message.to,
        'X-Comandou-Signature': await sign(env.INBOUND_SECRET, ts, message.from, message.to, raw),
      },
      body: raw,
    });
    if (res.status === 413) {
      message.setReject('Mensagem grande demais para esta caixa.');
      return;
    }
    // Erro: falha temporária, o servidor de quem mandou tenta de novo.
    if (!res.ok) throw new Error(`Comandou respondeu ${res.status}`);
    const d = (await res.json()) as Decision;
    if (d.action === 'reject') {
      message.setReject(d.reason || 'Endereço não encontrado');
      return;
    }
    if (d.forwardTo) {
      try {
        await message.forward(d.forwardTo);
      } catch (e) {
        // Destino não verificado na Cloudflare: a mensagem já está guardada no Comandou.
        console.error(`encaminhar para ${d.forwardTo} falhou`, e);
      }
    }
  },
} satisfies ExportedHandler<Env>;
