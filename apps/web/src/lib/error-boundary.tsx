import { Component, type ErrorInfo, type ReactNode } from 'react';
import { freshReload } from './fresh-reload';

/** Última vez (ms) que esta aba recarregou sozinha por causa de um arquivo de tela que não veio. */
const AUTO_RELOAD_KEY = 'cm.chunkReloadAt';
/** Dentro deste intervalo não recarrega de novo sozinho (evita ficar recarregando sem parar). */
const AUTO_RELOAD_GAP_MS = 60_000;

/**
 * O arquivo de uma tela não chegou: saiu versão nova (os arquivos antigos não existem mais) ou a
 * internet caiu no meio do download. Cada navegador escreve a mensagem de um jeito.
 */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err ?? '');
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading (CSS )?chunk|Unable to preload CSS/i.test(
    msg,
  );
}

function shouldAutoReload(): boolean {
  try {
    const last = Number(sessionStorage.getItem(AUTO_RELOAD_KEY) ?? 0);
    if (Date.now() - last < AUTO_RELOAD_GAP_MS) return false;
    sessionStorage.setItem(AUTO_RELOAD_KEY, String(Date.now()));
    return navigator.onLine !== false;
  } catch {
    return false;
  }
}

export interface ErrorFallbackProps {
  error: unknown;
  /** Desenha a tela de novo (sem recarregar a página). */
  retry: () => void;
}

interface Props {
  children: ReactNode;
  /** Mudou (ex.: trocou de tela)? A tela com erro sai e a nova desenha normalmente. */
  resetKey?: unknown;
  fallback: (p: ErrorFallbackProps) => ReactNode;
}

interface State {
  error: unknown;
  key: unknown;
}

/**
 * Segura um erro de desenho para ele não apagar o app inteiro (tela branca). Sem isto, qualquer
 * falha numa tela, ou o arquivo dela que não chegou, deixa o PDV em branco no meio do serviço.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error ?? new Error('Erro desconhecido') };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.key) return { key: props.resetKey, error: null };
    return null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[comandou] erro na tela', error, info.componentStack);
    // Versão nova no ar e a aba ainda pedia os arquivos antigos: recarrega uma vez sozinho.
    if (isChunkLoadError(error) && shouldAutoReload()) void freshReload();
  }

  retry = () => this.setState({ error: null });

  render() {
    if (this.state.error)
      return this.props.fallback({ error: this.state.error, retry: this.retry });
    return this.props.children;
  }
}

/** Aviso de erro com as duas saídas: tentar de novo ou recarregar o app. */
export function ErrorFallback({ error, retry }: ErrorFallbackProps) {
  const chunk = isChunkLoadError(error);
  return (
    <div
      role="alert"
      style={{
        display: 'grid',
        placeItems: 'center',
        gap: 12,
        padding: '32px 16px',
        textAlign: 'center',
        minHeight: 200,
      }}
    >
      <div style={{ maxWidth: 380, display: 'grid', gap: 8 }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 17 }}>
          {chunk ? 'Não deu para abrir esta tela' : 'Algo deu errado nesta tela'}
        </p>
        <p style={{ margin: 0, opacity: 0.75 }}>
          {chunk
            ? 'A conexão falhou ou saiu uma versão nova do sistema. Recarregue para continuar.'
            : 'O que já foi confirmado continua salvo. Tente de novo ou recarregue o app.'}
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {!chunk && (
          <button type="button" className="cm-btn" onClick={retry}>
            Tentar de novo
          </button>
        )}
        <button type="button" className="cm-btn cm-btn--primary" onClick={() => void freshReload()}>
          Recarregar o app
        </button>
      </div>
    </div>
  );
}
