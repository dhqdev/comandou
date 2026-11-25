import type { Options } from 'pino-http';

/**
 * Partes de URL que funcionam como senha (link público de rastreio, link do entregador) não vão
 * para os logs.
 * O resto da URL fica, para ainda dar para investigar uma requisição.
 */
export function maskSecretsInUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  return (
    url
      .replace(/(\/track\/)[^/?#]+/g, '$1[oculto]')
      .replace(/(\/courier-app\/)[^/?#]+/g, '$1[oculto]')
      .replace(/(entregador(?:\/|%2F))[A-Za-z0-9_-]+/gi, '$1[oculto]')
      // Acompanhamento do pedido, reserva, assinatura de contrato e teste grátis: o token do link é
      // a senha de quem abre (nome, endereço, telefone).
      .replace(
        /(\/(?:store\/orders|store\/reservations|platform\/sign|public\/site\/trials)\/)[^/?#]+/g,
        '$1[oculto]',
      )
      .replace(/([?&]token=)[^&#]+/g, '$1[oculto]')
  );
}

/**
 * Cabeçalhos que carregam segredo (sessão, token do Asaas, assinaturas de webhook) saem do log como
 * "[Redacted]".
 */
export const LOG_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["proxy-authorization"]',
  'req.headers["asaas-access-token"]',
  'req.headers["rappi-signature"]',
  'req.headers["x-app-signature"]',
  'res.headers["set-cookie"]',
];

interface LoggedRequest {
  id?: unknown;
  method?: string;
  url?: string;
  headers?: Record<string, unknown>;
  remoteAddress?: string;
  remotePort?: number;
}

/**
 * O que a requisição deixa no log: só campos conhecidos, com a URL mascarada. Sem `query` e
 * `params` (o `?token=` do Traefik e o `?start=/entregador/<token>` do manifesto iam em claro).
 */
export function logRequest(req: LoggedRequest) {
  return {
    id: req.id,
    method: req.method,
    url: maskSecretsInUrl(req.url),
    headers: req.headers,
    remoteAddress: req.remoteAddress,
    remotePort: req.remotePort,
  };
}

/** Configuração do log de requisições (pino-http), usada pelo AppModule e pelo teste. */
export function httpLogOptions(level: string): Options {
  return {
    level,
    // Nunca registrar cookies, tokens ou senhas.
    redact: LOG_REDACT_PATHS,
    serializers: { req: logRequest },
    customProps: (req) => ({ tenant: (req as { tenant?: { slug: string } }).tenant?.slug }),
    autoLogging: { ignore: (req) => (req.url ?? '').includes('/health/') },
  };
}
