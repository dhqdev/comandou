import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Cabeçalhos de toda resposta da API (OWASP REST Security, ASVS 14.3 e 3.4):
 *
 * - `Cache-Control: no-store`: resposta traz dado pessoal (clientes, caixa, financeiro) e não pode
 *   ficar no cache do navegador nem de proxy. Rota que pode ser guardada (fotos, modelos 3D) põe o
 *   seu e substitui este.
 * - `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`: se alguém conseguir
 *   abrir uma resposta da API como página (JSON com HTML dentro, um erro), nada roda nela nem dá
 *   para pôr em moldura. Rota que devolve HTML de propósito (prévia do link) põe a sua. PDF fica
 *   sem, porque o leitor de PDF do navegador não abre com `default-src 'none'`.
 */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

export function apiHeaders(_req: IncomingMessage, res: ServerResponse, next: () => void) {
  res.setHeader('Cache-Control', 'no-store');
  const writeHead = res.writeHead;
  res.writeHead = function (this: ServerResponse, ...args: unknown[]) {
    const type = String(this.getHeader('content-type') ?? '');
    if (!this.hasHeader('content-security-policy') && !/^application\/pdf/i.test(type))
      this.setHeader('Content-Security-Policy', API_CSP);
    return (writeHead as (...a: unknown[]) => ServerResponse).apply(this, args);
  } as ServerResponse['writeHead'];
  next();
}
