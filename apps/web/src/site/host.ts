import { useEffect, useState } from 'react';

/**
 * comandou.com e www.comandou.com mostram o site público; <restaurante>.comandou.com e os
 * domínios próprios mostram o restaurante. O navegador não sabe qual é o domínio base, então um
 * endereço "curto" (dois nomes, ou www) é só candidato: quem confirma é a API. A resposta fica
 * guardada neste navegador, para a próxima visita abrir direto.
 */
const KEY = 'cm:site-host';

export interface SiteConfig {
  site: boolean;
  signup: boolean;
  trialDays: number;
  demoUrl: string | null;
  salesContact: string;
  /** Super Admin › Sites com IA ligado (com chave e dentro do limite). */
  ai?: boolean;
}

export function siteCandidate(hostname = window.location.hostname): boolean {
  if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) return false;
  return hostname.startsWith('www.') || hostname.split('.').length === 2;
}

const cached = (): boolean | null => {
  try {
    const v = localStorage.getItem(KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
};

let request: Promise<SiteConfig | null> | null = null;
/** Configuração do site (uma chamada por página, dividida entre quem pedir). */
export function loadSiteConfig(): Promise<SiteConfig | null> {
  return (request ??= fetch('/api/v1/public/site', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? (r.json() as Promise<SiteConfig>) : null))
    .then((c) => {
      if (c)
        try {
          localStorage.setItem(KEY, c.site ? '1' : '0');
        } catch {
          /* navegação privada: pergunta de novo na próxima */
        }
      return c;
    })
    .catch(() => null));
}

/** 'site' | 'tenant' | 'pending' (primeira visita num endereço curto: espera a API responder). */
export function useSiteHost(): 'site' | 'tenant' | 'pending' {
  const candidate = siteCandidate();
  const [known, setKnown] = useState<boolean | null>(() => (candidate ? cached() : false));
  useEffect(() => {
    if (!candidate) return;
    // Sem resposta (API fora do ar): vale o que estava guardado; sem nada guardado, o site.
    void loadSiteConfig().then((c) => setKnown(c ? c.site : (cached() ?? true)));
  }, [candidate]);
  return known === null ? 'pending' : known ? 'site' : 'tenant';
}
