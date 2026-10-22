import { readFileSync } from 'node:fs';
import { HostAgent } from './agent';
import { agentServer } from './server';

/**
 * Agente do servidor (serviço comandou-agent): usa a mesma imagem da API com
 * `node dist/host-agent/main.js`. Lê o /proc e o disco do host (só leitura) e fala com o Docker
 * pelo socket. Fica só na rede interna; a API repassa as chamadas do painel Super Admin.
 */
const token = process.env.AGENT_TOKEN_FILE
  ? readFileSync(process.env.AGENT_TOKEN_FILE, 'utf8').trim()
  : (process.env.AGENT_TOKEN ?? '');
const port = Number(process.env.AGENT_PORT ?? 3200);

const agent = new HostAgent();
agent.start();
const server = agentServer(agent, token);
server.listen(port, () => console.log(`agente do servidor ouvindo na porta ${port}`));

for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.on(sig, () => {
    agent.stop();
    server.close(() => process.exit(0));
  });
