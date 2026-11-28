import { Smartphone, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Mascot } from '../../design-system';
import {
  STORE_PREVIEW_MSG,
  STORE_PREVIEW_READY,
  STORE_PREVIEW_URL,
  type StorePreviewData,
} from '../../lib/store-preview';

/**
 * O cardápio de verdade ao lado da conversa (0.282): uma moldura com o cardápio online do sistema
 * (o mesmo que o cliente vai usar), alimentada pelo que a conversa já sabe. No computador fica
 * fixo à direita, num celular; no celular vira um botão "Ver minha loja" que abre em tela cheia.
 */

function useFrame(data: StorePreviewData | null) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      if ((e.data as { source?: string } | null)?.source === STORE_PREVIEW_READY) setReady(true);
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, []);
  // Manda os dados (com um respiro enquanto a pessoa digita o preço).
  useEffect(() => {
    if (!ready || !data) return;
    const t = window.setTimeout(
      () =>
        frame.current?.contentWindow?.postMessage(
          { source: STORE_PREVIEW_MSG, store: data },
          window.location.origin,
        ),
      250,
    );
    return () => window.clearTimeout(t);
  }, [ready, data]);
  return { frame, ready };
}

/** Tela larga (computador): a prévia fica ao lado; estreita: abre por cima, no botão. */
function useWide() {
  const q = '(min-width: 961px)';
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

function Frame({ data, label }: { data: StorePreviewData; label: string }) {
  const { frame, ready } = useFrame(data);
  return (
    <div className="stc-phone">
      <span className="stc-phone__notch" aria-hidden />
      {!ready && (
        <span className="stc-phone__wait" aria-hidden>
          <Mascot size={44} />
        </span>
      )}
      <iframe
        ref={frame}
        src={STORE_PREVIEW_URL}
        title={label}
        className="stc-phone__screen"
        data-ready={ready || undefined}
      />
    </div>
  );
}

export function StorePreview({
  data,
  hint,
}: {
  /** null = ainda não há o que mostrar (antes da primeira resposta). */
  data: StorePreviewData | null;
  hint: string;
}) {
  const [sheet, setSheet] = useState(false);
  const wide = useWide();
  const items = data?.categories.reduce((n, c) => n + c.items.length, 0) ?? 0;
  useEffect(() => {
    if (!sheet) return;
    const on = (e: KeyboardEvent) => e.key === 'Escape' && setSheet(false);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [sheet]);
  return (
    <>
      {wide && (
        <aside className="stc-side" aria-label="Prévia da sua loja">
          {data ? (
            <>
              <p className="stc-side__label">
                <span className="stc-live" aria-hidden /> Assim o cliente vê
              </p>
              <Frame data={data} label="Prévia do cardápio da sua loja" />
              <p className="stc-side__hint">{hint}</p>
            </>
          ) : (
            <div className="stc-side__empty">
              <Mascot size={72} />
              <strong>Sua loja aparece aqui</strong>
              <span>
                Mande o cardápio, o link ou o logo na conversa e eu monto o cardápio de verdade, do
                jeito que o cliente vai ver.
              </span>
            </div>
          )}
        </aside>
      )}
      {data && !wide && (
        <button type="button" className="stc-peek" onClick={() => setSheet(true)}>
          <Smartphone size={18} aria-hidden />
          Ver minha loja{items ? ` (${items})` : ''}
        </button>
      )}
      {data && sheet && !wide && (
        <div className="stc-sheet" role="dialog" aria-modal="true" aria-label="Prévia da sua loja">
          <div className="stc-sheet__bar">
            <strong>Assim o cliente vê</strong>
            <button
              type="button"
              className="stc-sheet__x"
              aria-label="Fechar a prévia"
              onClick={() => setSheet(false)}
            >
              <X size={20} aria-hidden />
            </button>
          </div>
          <Frame data={data} label="Prévia do cardápio da sua loja" />
        </div>
      )}
    </>
  );
}
