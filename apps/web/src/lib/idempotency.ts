/**
 * Chave de idempotência para operações críticas. Gere UMA chave por intenção do usuário
 * (ex.: ao abrir o modal de pagamento) e reutilize-a nas novas tentativas da mesma operação:
 * se a rede cair depois do servidor gravar, o reenvio devolve o mesmo resultado sem duplicar.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
