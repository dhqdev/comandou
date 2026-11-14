import { writeFileSync } from 'node:fs';

/**
 * Marca o contêiner como tarefa de uma vez só (migração, demonstração). O serviço migrate usa a
 * mesma imagem da API, e o HEALTHCHECK da imagem procura a API na porta 3000: sem esta marca o
 * Swarm dava o contêiner como "unhealthy" depois de ~65 s e matava a migração no meio (código 137).
 * Atualizar pelo painel só troca a imagem, então a correção precisa estar nela, não na stack.
 */
export const ONE_SHOT_MARK = '/tmp/comandou-oneshot';

try {
  writeFileSync(ONE_SHOT_MARK, `${process.pid}\n`);
} catch {
  // Sem /tmp gravável (testes, outro ambiente): nada a fazer.
}
