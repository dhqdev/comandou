// Núcleo do agente: conversa com a API do restaurante, busca os trabalhos e manda imprimir.
// Usado pela linha de comando (agent.mjs) e pelo aplicativo de computador (desktop/).
import { EventEmitter } from 'node:events';

const CODE_PREFIX = 'CMD1-';

/**
 * Quanto o agente espera uma impressão terminar. Passou disso, desiste e avisa o Comandou que
 * pode ter saído (não volta sozinho para a fila). Fica bem abaixo do prazo do servidor
 * (PRINT_LEASE_SECONDS, 150 s), para o trabalho nunca ir para outro computador enquanto este
 * ainda imprime.
 */
export const PRINT_TIMEOUT = 60_000;
/** Trabalhos por volta do laço; pega um de cada vez (tirar da fila no painel vale na hora). */
const JOBS_PER_TICK = 5;

/** Erro de quem já mandou o texto para a impressora ou para a fila do sistema. */
export function sentError(err) {
  const e = err instanceof Error ? err : new Error(String(err));
  e.sent = true;
  return e;
}

/** Roda `p` com prazo; estourou, o erro diz que pode ter saído (sent). */
export function withTimeout(p, ms, message) {
  let timer;
  return Promise.race([
    p,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(sentError(new Error(message))), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Código de conexão gerado no painel (Impressão > Conectar computador): junta o endereço do
 * restaurante e o token do agente num texto só, para o usuário colar uma coisa.
 */
export function parseConnectionCode(raw) {
  let s = String(raw ?? '').trim();
  const link = /^comandou-impressao:\/\/[^?]*\?(.*)$/i.exec(s);
  if (link) s = new URLSearchParams(link[1]).get('codigo') ?? '';
  if (!s.startsWith(CODE_PREFIX)) throw new Error('Código inválido. Copie de novo no painel.');
  let data;
  try {
    data = JSON.parse(Buffer.from(s.slice(CODE_PREFIX.length), 'base64url').toString('utf8'));
  } catch {
    throw new Error('Código incompleto. Copie de novo no painel.');
  }
  const url = String(data.u ?? '').replace(/\/+$/, '');
  const token = String(data.t ?? '');
  if (!/^https?:\/\/[^/\s]+$/.test(url) || !/^pma_[A-Za-z0-9_-]{20,}$/.test(token))
    throw new Error('Código inválido. Copie de novo no painel.');
  return { url, token, name: typeof data.n === 'string' ? data.n.slice(0, 60) : undefined };
}

export function makeConnectionCode(url, token, name) {
  return (
    CODE_PREFIX + Buffer.from(JSON.stringify({ u: url, t: token, n: name })).toString('base64url')
  );
}

/**
 * Laço do agente. Eventos:
 *   status  { state: 'connecting'|'online'|'offline'|'unauthorized', restaurant?, agent?, targets?, error? }
 *   job     { id, kind, target, printer, ok, error?, cancelled?, at }
 */
export class PrintAgent extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.url            endereço do restaurante (https://...)
   * @param {string} o.token          token do agente (pma_...)
   * @param {string} o.version        versão enviada no heartbeat
   * @param {(target: string) => string} o.printerFor  destino → impressora
   * @param {(spec: string, text: string) => Promise<void>} o.print
   * @param {number} [o.pollMs]
   * @param {() => boolean} [o.canPrint]  false = só mantém a conexão; os trabalhos esperam na fila
   * @param {() => { target: string|null, label: string, kind: string }[]} [o.report]  impressoras
   *   escolhidas, para a tela Impressão do sistema mostrar
   * @param {(spec: string) => string} [o.label]  nome da impressora (vai com o resultado)
   * @param {() => Promise<unknown>} [o.purge]  apaga os documentos do Comandou da fila do sistema
   * @param {(targets: (string|null)[]) => Promise<unknown>} [o.removePrinters]  tira impressoras
   *   escolhidas (null = principal), a pedido da tela Impressão
   */
  constructor(o) {
    super();
    this.o = { pollMs: 3000, ...o, url: o.url.replace(/\/+$/, '') };
    this.state = { state: 'connecting' };
    this.running = false;
    this.lastBeat = 0;
    this.timer = undefined;
    this.wake = undefined;
    /** Confirmações para o próximo heartbeat (pedidos da tela Impressão já atendidos). */
    this.acks = {};
  }

  async api(path, body) {
    const res = await fetch(`${this.o.url}/api/v1/print-agent${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.o.token}`,
        'X-Comandou-Request': '1',
      },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      throw Object.assign(new Error(data.message ?? `HTTP ${res.status}`), { status: res.status });
    return data;
  }

  setState(s) {
    const prev = this.state;
    this.state = { ...prev, ...s };
    if (s.state !== 'offline') {
      delete this.state.error;
      delete this.state.retryIn;
    }
    if (JSON.stringify(prev) !== JSON.stringify(this.state)) this.emit('status', this.state);
  }

  async tick() {
    if (!this.lastBeat || Date.now() - this.lastBeat > 30_000) {
      const acks = this.acks;
      this.acks = {};
      const hb = await this.api('/heartbeat', {
        version: this.o.version,
        ...acks,
        ...(this.o.report ? { printers: this.o.report() } : {}),
      }).catch((e) => {
        this.acks = { ...acks, ...this.acks };
        throw e;
      });
      this.lastBeat = Date.now();
      await this.commands(hb);
      this.setState({
        state: 'online',
        restaurant: hb.restaurant,
        agent: hb.agent,
        targets: Array.isArray(hb.targets) ? hb.targets : this.state.targets,
        // Cores, tema e ícone do restaurante (o aplicativo se veste com a marca dele).
        brand: hb.brand && typeof hb.brand === 'object' ? hb.brand : this.state.brand,
      });
    }
    if (this.o.canPrint && !this.o.canPrint()) return this.setState({ state: 'online' });
    // Um trabalho por vez: o que for tirado da fila no painel enquanto este imprime não sai.
    for (let n = 0; n < JOBS_PER_TICK && this.running; n++) {
      const { jobs } = await this.api('/claim', { limit: 1 });
      this.setState({ state: 'online' });
      if (!jobs.length) return;
      for (const job of jobs) await this.printJob(job);
    }
  }

  /** Imprime um trabalho e conta ao Comandou como foi. */
  async printJob(job) {
    const printer = this.o.printerFor(job.target);
    const label = this.o.label ? String(this.o.label(printer)).slice(0, 80) : undefined;
    const ev = { id: job.id, kind: job.kind, target: job.target, printer, at: Date.now() };
    let outcome;
    try {
      await withTimeout(
        Promise.resolve().then(() => this.o.print(printer, job.payload)),
        this.o.printTimeout ?? PRINT_TIMEOUT,
        'A impressora demorou demais para responder. Confira se saiu antes de mandar de novo.',
      );
      outcome = { ok: true };
    } catch (err) {
      outcome = {
        ok: false,
        error: String(err?.message ?? err).slice(0, 300),
        // Pode ter saído: o Comandou não manda de novo sozinho (era o que repetia cópias).
        ...(err?.sent ? { sent: true } : {}),
      };
    }
    try {
      await this.api(`/jobs/${job.id}/result`, {
        ...outcome,
        ...(label ? { printer: label } : {}),
      });
      this.emit('job', { ...ev, ...outcome });
    } catch (err) {
      // 409: tirado da fila no painel enquanto imprimia.
      if (err.status === 409) this.emit('job', { ...ev, ...outcome, cancelled: true });
      else {
        this.emit('job', { ...ev, ...outcome });
        throw err;
      }
    }
  }

  /** Pedidos da tela Impressão que vêm no heartbeat. */
  async commands(hb) {
    if (hb.purge && this.o.purge) {
      try {
        await this.o.purge();
        this.acks.purgedAt = hb.purge;
      } catch {
        /* tenta de novo no próximo sinal */
      }
    }
    const remove = Array.isArray(hb.remove) ? hb.remove : [];
    if (remove.length && this.o.removePrinters) {
      await this.o.removePrinters(remove);
      this.acks.removed = remove;
    }
    // Confirma já na próxima volta.
    if (this.acks.purgedAt || this.acks.removed) this.lastBeat = 1;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastBeat = 0;
    this.setState({ state: 'connecting' });
    void this.loop();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.wake?.();
  }

  /** Força uma volta agora (ex.: computador saiu da suspensão, rede voltou). */
  poke() {
    this.lastBeat = 0;
    clearTimeout(this.timer);
    this.wake?.();
  }

  async loop() {
    let wait = this.o.pollMs;
    while (this.running) {
      try {
        await this.tick();
        wait = this.o.pollMs;
      } catch (err) {
        if (err.status === 401) {
          this.running = false;
          this.setState({ state: 'unauthorized' });
          return;
        }
        wait = Math.min(Math.max(wait * 2, 2000), 60_000);
        this.lastBeat = 0;
        this.setState({ state: 'offline', error: String(err.message ?? err), retryIn: wait });
      }
      if (!this.running) return;
      await new Promise((r) => {
        this.wake = r;
        this.timer = setTimeout(r, wait);
      });
    }
  }
}
