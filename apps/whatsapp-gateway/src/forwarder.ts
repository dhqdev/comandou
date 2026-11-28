import type { InboundMessage } from './inbound.js';

const RETRY_MS = [1000, 3000, 10_000, 30_000];

export interface ForwarderOptions {
  /** espera entre tentativas quando a API está fora (depois disso desiste da mensagem) */
  retryMs?: number[];
  /** conversas entregues ao mesmo tempo (as mensagens de uma conversa vão uma de cada vez) */
  concurrency?: number;
  /** mensagens esperando, no total */
  maxPending?: number;
  /** mensagens esperando de um mesmo restaurante (um restaurante inundado não afoga os outros) */
  maxPerTenant?: number;
  /**
   * conversas de um mesmo restaurante sendo entregues ao mesmo tempo: um restaurante com muitas
   * conversas abertas (e a IA demorando a responder) não ocupa todas as vagas dos outros
   */
  maxActivePerTenant?: number;
  /** quanto esperar a API responder (ela só responde depois de tratar a mensagem) */
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

/**
 * Entrega as mensagens recebidas para a API (POST com o token interno).
 *
 * Uma fila por conversa: as mensagens de um mesmo cliente vão uma de cada vez e na ordem (a API
 * só responde depois de tratar a mensagem, então a ordem vale mesmo com várias réplicas da API).
 * Conversas diferentes andam em paralelo, até `concurrency`: um restaurante com a API lenta (ou
 * uma mensagem que a API está demorando para aceitar) não segura o WhatsApp dos outros. Cada
 * restaurante usa no máximo `maxActivePerTenant` dessas vagas (no jantar, o restaurante com 50
 * conversas abertas não deixa os outros esperando na fila).
 *
 * API fora do ar: tenta de novo algumas vezes (até ~45 s) e depois desiste daquela mensagem.
 */
export class InboundForwarder {
  /** conversa → mensagens esperando (a primeira pode estar sendo entregue) */
  private readonly lanes = new Map<string, InboundMessage[]>();
  /** conversas com mensagem esperando e ninguém entregando */
  private readonly ready: string[] = [];
  private readonly perTenant = new Map<string, number>();
  /** conversas sendo entregues agora, por restaurante */
  private readonly activeByTenant = new Map<string, number>();
  private total = 0;
  private active = 0;
  private closed = false;
  private readonly o: Required<ForwarderOptions>;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly log: (msg: string) => void = () => undefined,
    opts: ForwarderOptions = {},
  ) {
    this.o = {
      retryMs: RETRY_MS,
      concurrency: 128,
      maxPending: 20_000,
      maxPerTenant: 1000,
      maxActivePerTenant: 12,
      timeoutMs: 60_000,
      fetchFn: fetch,
      ...opts,
    };
  }

  push(msg: InboundMessage) {
    if (this.closed) return;
    const n = this.perTenant.get(msg.tenantId) ?? 0;
    if (n >= this.o.maxPerTenant || this.total >= this.o.maxPending) {
      this.log(
        `restaurante ${msg.tenantId}: fila de mensagens recebidas cheia; mensagem descartada`,
      );
      return;
    }
    this.perTenant.set(msg.tenantId, n + 1);
    this.total++;
    const chat = `${msg.tenantId}:${msg.jid}`;
    const lane = this.lanes.get(chat);
    if (lane) {
      lane.push(msg); // já está na fila de prontas ou sendo entregue
      return;
    }
    this.lanes.set(chat, [msg]);
    this.ready.push(chat);
    this.pump();
  }

  /** mensagens esperando (inclui as que estão sendo entregues) */
  get pending() {
    return this.total;
  }

  /** conversas sendo entregues agora */
  get inFlight() {
    return this.active;
  }

  private pump() {
    while (!this.closed && this.active < this.o.concurrency && this.ready.length) {
      // A primeira conversa pronta cujo restaurante ainda tem vaga (a ordem de chegada vale
      // entre os restaurantes; as do restaurante cheio esperam a vez dele).
      const i = this.ready.findIndex(
        (c) => (this.activeByTenant.get(tenantOf(c)) ?? 0) < this.o.maxActivePerTenant,
      );
      if (i < 0) return;
      const chat = this.ready.splice(i, 1)[0]!;
      const tenant = tenantOf(chat);
      this.active++;
      this.activeByTenant.set(tenant, (this.activeByTenant.get(tenant) ?? 0) + 1);
      void this.runLane(chat).finally(() => {
        this.active--;
        const n = (this.activeByTenant.get(tenant) ?? 1) - 1;
        if (n > 0) this.activeByTenant.set(tenant, n);
        else this.activeByTenant.delete(tenant);
        this.pump();
      });
    }
  }

  private async runLane(chat: string) {
    const lane = this.lanes.get(chat);
    if (!lane) return;
    while (!this.closed && lane.length) {
      const msg = lane[0];
      await this.deliver(msg);
      lane.shift();
      this.total--;
      const n = (this.perTenant.get(msg.tenantId) ?? 1) - 1;
      if (n > 0) this.perTenant.set(msg.tenantId, n);
      else this.perTenant.delete(msg.tenantId);
      // Conversa movimentada não monopoliza a vaga: volta para o fim da fila de prontas.
      if (lane.length && this.ready.length) {
        this.ready.push(chat);
        return;
      }
    }
    if (!lane.length) this.lanes.delete(chat);
  }

  private async deliver(msg: InboundMessage) {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.o.fetchFn(this.url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(msg),
          signal: AbortSignal.timeout(this.o.timeoutMs),
        });
        if (res.ok) return;
        // 4xx: a API recusou essa mensagem (não adianta repetir)
        if (res.status < 500 && res.status !== 429) {
          this.log(`API recusou a mensagem recebida (HTTP ${res.status})`);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        const wait = this.o.retryMs[attempt];
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

/** "tenant:jid" → tenant (o id do restaurante é um uuid, sem ":"). */
const tenantOf = (chat: string) => chat.slice(0, chat.indexOf(':'));
