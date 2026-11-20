import { Printer } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api';
import { useDebounced, useRealtime } from '../lib/realtime';
import type { PrintAgent } from '../lib/types';
import { printHealth, type PrintHealthState } from './print-agent';
import './print-status.css';

const LABEL: Record<Exclude<PrintHealthState, 'none'>, string> = {
  ok: 'Impressão conectada',
  'no-printer': 'Impressão: falta escolher a impressora no aplicativo',
  offline: 'Impressão desconectada: o computador da impressora está desligado ou sem internet',
};

/**
 * Impressora no topo: bolinha verde quando o aplicativo Comandou Impressão está conectado num
 * computador, amarela sem impressora escolhida, vermelha desconectado. Some para quem não usa.
 */
export function PrintStatus() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<PrintAgent[] | null>(null);
  const load = useCallback(async () => {
    try {
      setAgents(await api<PrintAgent[]>('/printing/agents'));
    } catch {
      /* sem permissão ou sem rede: fica como estava */
    }
  }, []);
  useEffect(() => {
    void load();
    // "Online" é o último sinal de até 2 minutos: confere de tempos em tempos.
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 60_000);
    return () => window.clearInterval(t);
  }, [load]);
  const reload = useDebounced(load);
  useRealtime((e) => {
    if (e.type === 'print.changed') reload();
  }, load);

  const { state } = printHealth(agents);
  if (state === 'none') return null;
  const label = LABEL[state];
  return (
    <button
      type="button"
      className="cm-theme-toggle print-status"
      data-state={state}
      title={label}
      aria-label={`${label}. Abrir Impressão`}
      onClick={() => navigate('/impressao')}
    >
      <Printer size={18} aria-hidden />
      <span className="print-status__dot" aria-hidden />
    </button>
  );
}
