// Núcleo do agente: conversa com a API do restaurante, busca os trabalhos e manda imprimir.
// Usado pela linha de comando (agent.mjs) e pelo aplicativo de computador (desktop/).
import { EventEmitter } from 'node:events';

const CODE_PREFIX = 'CMD1-';

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
 *   job     { id, kind, target, printer, ok, error?, at }
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
   */
  constructor(o) {
    super();
    this.o = { pollMs: 3000, ...o, url: o.url.replace(/\/+$/, '') };
    this.state = { state: 'connecting' };
    this.running = false;
    this.lastBeat = 0;
    this.timer = undefined;
    this.wake = undefined;
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
      const hb = await this.api('/heartbeat', {
        version: this.o.version,
        ...(this.o.report ? { printers: this.o.report() } : {}),
      });
      this.lastBeat = Date.now();
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
    const { jobs } = await this.api('/claim', { limit: 5 });
    this.setState({ state: 'online' });
    for (const job of jobs) {
      if (!this.running) return;
      const printer = this.o.printerFor(job.target);
      const ev = { id: job.id, kind: job.kind, target: job.target, printer, at: Date.now() };
      try {
        await this.o.print(printer, job.payload);
        await this.api(`/jobs/${job.id}/result`, { ok: true });
        this.emit('job', { ...ev, ok: true });
      } catch (err) {
        const error = String(err.message ?? err).slice(0, 300);
        this.emit('job', { ...ev, ok: false, error });
        await this.api(`/jobs/${job.id}/result`, { ok: false, error }).catch(() => undefined);
      }
    }
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
