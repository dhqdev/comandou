import {
  BadGatewayException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ENV, Env } from '../config/env';

/** Cliente do agente do servidor (serviço comandou-agent, só na rede interna). */
@Injectable()
export class ServerAgentClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  get enabled() {
    return !!(this.env.HOST_AGENT_URL && this.env.HOST_AGENT_TOKEN);
  }

  async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 30_000) {
    if (!this.enabled) throw new ServiceUnavailableException('Agente do servidor não instalado');
    let res: Response;
    try {
      res = await fetch(new URL(path, this.env.HOST_AGENT_URL), {
        method,
        headers: {
          Authorization: `Bearer ${this.env.HOST_AGENT_TOKEN}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new BadGatewayException('Agente do servidor não respondeu');
    }
    const data = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (!res.ok) throw new BadGatewayException(data.message ?? `Agente respondeu ${res.status}`);
    return data;
  }
}
