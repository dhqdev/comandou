// Atualização do aplicativo sem reinstalar na mão: confere a versão publicada na Release
// "impressora" (versao.json, gerado pelo workflow print-agent.yml), baixa o instalador novo,
// fecha o aplicativo e abre de novo já atualizado.
//   Windows: instalador NSIS em silêncio (/S) com --force-run (reabre sozinho no fim).
//   Linux: troca o próprio AppImage pelo novo e abre de novo.
//   macOS: sem assinatura da Apple não dá para trocar sozinho; abre o download do .dmg.
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isNewer, updateFile } from './pure.mjs';

export const RELEASE_BASE = 'https://github.com/dhqdev/comandou/releases/download/impressora';

export class Updater {
  /**
   * @param {object} o
   * @param {string} o.version     versão rodando agora
   * @param {() => void} o.onChange  a tela e a bandeja redesenham
   * @param {() => void} o.quit      fecha o aplicativo (sem ficar na bandeja)
   * @param {(url: string) => unknown} o.openExternal
   */
  constructor(o) {
    this.o = o;
    /** @type {{ checking: boolean, latest: string|null, available: boolean, progress: number|null,
     *   error: string|null, checkedAt: number|null, auto: boolean }} */
    this.state = {
      checking: false,
      latest: null,
      available: false,
      progress: null,
      error: null,
      checkedAt: null,
      // Linux só se atualiza sozinho rodando como AppImage; macOS abre o download.
      auto:
        process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE),
    };
  }

  set(s) {
    this.state = { ...this.state, ...s };
    this.o.onChange();
  }

  /** Confere se há versão nova. `quiet`: sem erro na tela (conferência automática). */
  async check(quiet = false) {
    if (this.state.checking || this.state.progress !== null) return this.state;
    this.set({ checking: true, error: null });
    try {
      const res = await fetch(`${RELEASE_BASE}/versao.json?t=${Date.now()}`, {
        signal: AbortSignal.timeout(15_000),
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (res.status === 404) throw new Error('nenhuma versão publicada ainda');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const latest = typeof data.version === 'string' ? data.version : null;
      this.set({
        checking: false,
        latest,
        available: !!latest && isNewer(latest, this.o.version),
        checkedAt: Date.now(),
      });
    } catch (e) {
      this.set({
        checking: false,
        error: quiet
          ? null
          : `Não consegui ver se há versão nova (${e.message}). Confira a internet.`,
      });
    }
    return this.state;
  }

  /** Baixa e instala a versão nova; o aplicativo fecha e abre de novo sozinho. */
  async install() {
    if (this.state.progress !== null) return;
    const file = updateFile(process.platform, process.arch);
    if (!file) throw new Error('Este sistema não tem atualização automática.');
    if (process.platform === 'darwin' || !this.state.auto) {
      await this.o.openExternal(`${RELEASE_BASE}/${file}`);
      return;
    }
    this.set({ progress: 0, error: null });
    const dir = await mkdtemp(join(tmpdir(), 'comandou-update-'));
    const dest = join(dir, file);
    try {
      await download(`${RELEASE_BASE}/${file}`, dest, (p) => this.set({ progress: p }));
      if (process.platform === 'win32') {
        // /S: sem perguntas; --force-run: abre o aplicativo de novo quando terminar.
        spawn(dest, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
      } else {
        const target = /** @type {string} */ (process.env.APPIMAGE);
        const next = join(dirname(target), `.${file}.novo`);
        await rename(dest, next).catch(async () => {
          // Outra partição (/tmp): copia pelo stream.
          await pipeline(createReadStream(dest), createWriteStream(next));
        });
        await chmod(next, 0o755);
        await rename(next, target);
        spawn(target, [], { detached: true, stdio: 'ignore' }).unref();
      }
      this.set({ progress: 1 });
      setTimeout(() => this.o.quit(), 300);
    } catch (e) {
      this.set({
        progress: null,
        error: `A atualização não terminou (${e.message}). Tente de novo.`,
      });
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** Baixa `url` em `dest`, avisando o progresso (0 a 1). */
async function download(url, dest, onProgress) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0;
  let last = 0;
  const count = new Transform({
    transform(chunk, _enc, cb) {
      got += chunk.length;
      const p = total ? Math.min(0.99, got / total) : 0;
      if (p - last >= 0.02) {
        last = p;
        onProgress(p);
      }
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), count, createWriteStream(dest));
  if (total && got < total) throw new Error('download incompleto');
}
