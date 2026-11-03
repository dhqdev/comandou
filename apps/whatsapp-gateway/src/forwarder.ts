import type { InboundMessage } from './inbound.js';

const QUEUE_MAX = 1000;
const RETRY_MS = [1000, 3000, 10_000, 30_000];

/**
 * Entrega as mensagens recebidas para a API (POST com o token interno), na ordem em que
 * chegaram. API fora do ar: tenta de novo algumas vezes (até ~45 s) e depois desiste daquela
 * mensagem, para uma API parada não segurar a fila para sempre.
 */
export class InboundForwarder {
  private readonly queue: InboundMessage[] = [];
  private running = false;
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly log: (msg: string) => void = () => undefined,
    private readonly retryMs: number[] = RETRY_MS,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  push(msg: InboundMessage) {
    if (this.closed) return;
    if (this.queue.length >= QUEUE_MAX) {
      this.queue.shift();
      this.log('fila de mensagens recebidas cheia: a mais antiga foi descartada');
    }
    this.queue.push(msg);
    if (!this.running) void this.drain();
  }

  get pending() {
    return this.queue.length;
  }

  private async drain() {
    this.running = true;
    try {
      while (!this.closed && this.queue.length) {
        const msg = this.queue[0];
        await this.deliver(msg);
        this.queue.shift();
      }
    } finally {
      this.running = false;
    }
  }

  private async deliver(msg: InboundMessage) {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.fetchFn(this.url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(msg),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return;
        // 4xx: a API recusou essa mensagem (não adianta repetir)
        if (res.status < 500 && res.status !== 429) {
          this.log(`API recusou a mensagem recebida (HTTP ${res.status})`);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        const wait = this.retryMs[attempt];
        if (wait === undefined || this.closed) {
          this.log(`mensagem recebida não entregue à API (${(e as Error).message})`);
          return;
        }
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  close() {
    this.closed = true;
  }
}
