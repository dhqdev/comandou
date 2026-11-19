import { channelInfo, isCustomOd } from '@comandou/shared';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

/**
 * Nome dado no Super Admin a cada aplicativo Open Delivery cadastrado (`od-anotaai` → "Anota
 * AI"). Os conhecidos (iFood, 99Food...) têm nome fixo no shared; estes vêm da API uma vez e
 * valem por 10 minutos. Sem resposta (sem permissão, sem rede), fica o nome tirado do id.
 */
const TTL = 10 * 60_000;
let labels: Record<string, string> = {};
let loadedAt = 0;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load(): Promise<void> {
  if (Date.now() - loadedAt < TTL) return Promise.resolve();
  pending ??= api<{ labels: Record<string, string> }>('/channels/labels')
    .then(
      (r) => {
        labels = r.labels ?? {};
      },
      () => undefined,
    )
    .finally(() => {
      loadedAt = Date.now();
      pending = null;
      listeners.forEach((f) => f());
    });
  return pending;
}

/** Nome do aplicativo para mostrar (usa o nome cadastrado quando já carregou). */
export const appLabel = (channel: string) => channelInfo(channel, labels[channel]).label;

/** Nome cadastrado de um `od-<nome>` (ou nada); para passar ao `channelInfo`. */
export const customAppName = (channel: string): string | undefined => labels[channel];

/**
 * Carrega os nomes quando a tela precisa (`enabled`) e redesenha quando chegam. Devolve uma
 * versão que muda a cada carga, para entrar nas dependências de `useMemo`.
 */
export function useAppLabels(enabled = true): number {
  const [version, setVersion] = useState(loadedAt);
  useEffect(() => {
    if (!enabled) return;
    const f = () => setVersion(loadedAt);
    listeners.add(f);
    void load();
    return () => {
      listeners.delete(f);
    };
  }, [enabled]);
  return version;
}

/** Algum pedido da lista é de um aplicativo Open Delivery cadastrado? */
export const hasCustomApp = (channels: (string | null | undefined)[]) =>
  channels.some((c) => !!c && isCustomOd(c));
