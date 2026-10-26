import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import {
  applyBranding,
  BRAND_EVENT,
  Branding,
  cacheBranding,
  cachedBranding,
  DEFAULT_BRANDING,
} from '../design-system';
import { api } from '../lib/api';

/** Mensagem da tela Loja online para a prévia (iframe): mostra as cores antes de salvar. */
export interface BrandPreviewMessage {
  type: 'cm-brand-preview';
  branding: Partial<Branding>;
}
/** A prévia avisa que está pronta para receber as cores (a página dela carrega depois do iframe). */
export const BRAND_PREVIEW_READY = 'cm-brand-preview-ready';

const isPreview = () => new URLSearchParams(window.location.search).get('previa') === '1';

/**
 * Veste o restaurante com a identidade dele: cores em todas as telas (no sistema da equipe só se
 * o lojista deixou ligado), fonte e cantos no cardápio e o ícone da aba. Busca de novo quando a
 * Loja online salva; na prévia, aceita as cores ainda não salvas.
 */
export function TenantBrand() {
  const { pathname } = useLocation();
  const [saved, setSaved] = useState<Branding>(() => cachedBranding() ?? DEFAULT_BRANDING);
  const [draft, setDraft] = useState<Partial<Branding> | null>(null);

  useEffect(() => {
    const load = () =>
      api<Branding>('/store/branding').then(
        (b) => {
          setSaved(b);
          if (!isPreview()) cacheBranding(b);
        },
        () => undefined, // sem rede: segue com a última identidade guardada
      );
    void load();
    const onChanged = (e: Event) => {
      const next = (e as CustomEvent<Branding | undefined>).detail;
      if (next) {
        setSaved(next);
        cacheBranding(next);
      } else void load();
    };
    window.addEventListener(BRAND_EVENT, onChanged);
    return () => window.removeEventListener(BRAND_EVENT, onChanged);
  }, []);

  // Prévia dentro da Loja online: só aceita mensagens da própria origem.
  useEffect(() => {
    if (!isPreview()) return;
    const onMessage = (e: MessageEvent<BrandPreviewMessage>) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'cm-brand-preview') return;
      setDraft(e.data.branding);
    };
    window.addEventListener('message', onMessage);
    window.parent?.postMessage({ type: BRAND_PREVIEW_READY }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    applyBranding({ ...saved, ...draft }, pathname);
  }, [saved, draft, pathname]);

  return null;
}
