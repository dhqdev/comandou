/**
 * Aviso de (re)conexão do tempo real, sem o socket.io: quem só quer saber "conectou de novo"
 * (o aviso de versão nova) importa daqui e não puxa a biblioteca da conexão para o arquivo
 * principal. Quem abre o cardápio do cliente nunca conecta, então nunca baixa o socket.io.
 */
const readyListeners = new Set<() => void>();

/**
 * Avisa a cada (re)conexão sem abrir conexão nova: só quem já usa o tempo real escuta. Um deploy
 * reinicia a API, então a reconexão é o primeiro sinal de que pode ter saído versão nova.
 */
export function onRealtimeReady(cb: () => void): () => void {
  readyListeners.add(cb);
  return () => {
    readyListeners.delete(cb);
  };
}

/** Chamado pela conexão (lib/realtime.ts) a cada `ready`. */
export function emitRealtimeReady() {
  readyListeners.forEach((l) => l());
}
