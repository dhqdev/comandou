import { GraduationCap } from 'lucide-react';
import { useMemo, useSyncExternalStore } from 'react';
import { Button, type FrameItem } from '../../design-system';
import { GuidedTour, type TourEnds, type TourStop } from './GuidedTour';
import * as T from './tours';

/**
 * Tutoriais de cada tela: o botão "Tutorial" no topo da tela abre o tour guiado daquela parte do
 * sistema. Um só lugar (PageTourHost, no AppShell) desenha o tour, com o menu da pessoa.
 */
export type PageTourId =
  | 'cardapio'
  | 'item'
  | 'fiscal'
  | 'estoque'
  | 'impressao'
  | 'ajustes'
  | 'caixa'
  | 'salao'
  | 'loja'
  | 'entregas'
  | 'equipe';

type Running = { id: PageTourId; path: string } | null;

let running: Running = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function startPageTour(id: PageTourId) {
  running = { id, path: window.location.pathname };
  emit();
}

function stopPageTour() {
  running = null;
  emit();
}

function useRunning() {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    () => running,
    () => null,
  );
}

const PLANS: Record<
  Exclude<PageTourId, 'item'>,
  { stops: TourStop[]; ends: TourEnds; label: string }
> = {
  cardapio: { stops: T.MENU_STOPS, ends: T.menuEnds, label: 'Tutorial do Cardápio' },
  fiscal: { stops: T.FISCAL_STOPS, ends: T.fiscalEnds, label: 'Tutorial da Nota fiscal' },
  estoque: { stops: T.STOCK_STOPS, ends: T.stockEnds, label: 'Tutorial do Estoque' },
  impressao: { stops: T.PRINT_STOPS, ends: T.printEnds, label: 'Tutorial da Impressão' },
  ajustes: { stops: T.SETTINGS_STOPS, ends: T.settingsEnds, label: 'Tutorial dos Ajustes' },
  caixa: { stops: T.CASH_STOPS, ends: T.cashEnds, label: 'Tutorial do Caixa' },
  salao: { stops: T.SALON_STOPS, ends: T.salonEnds, label: 'Tutorial do Salão' },
  loja: { stops: T.STORE_STOPS, ends: T.storeEnds, label: 'Tutorial da Loja online' },
  entregas: { stops: T.DELIVERY_STOPS, ends: T.deliveryEnds, label: 'Tutorial das Entregas' },
  equipe: { stops: T.TEAM_STOPS, ends: T.teamEnds, label: 'Tutorial da Equipe' },
};

function plan(r: NonNullable<Running>): { stops: TourStop[]; ends: TourEnds; label: string } {
  if (r.id === 'item')
    return { stops: T.itemTour(r.path), ends: T.itemEnds, label: 'Tutorial do item' };
  return PLANS[r.id];
}

export function PageTourHost({ items, tabs }: { items: FrameItem[]; tabs: string[] }) {
  const r = useRunning();
  const p = useMemo(() => (r ? plan(r) : null), [r]);
  if (!r || !p) return null;
  return (
    <GuidedTour
      open
      onClose={stopPageTour}
      stops={p.stops}
      ends={p.ends}
      items={items}
      tabs={tabs}
      label={p.label}
    />
  );
}

/** Botão "Tutorial" do topo da tela. */
export function TourButton({ tour, label = 'Tutorial' }: { tour: PageTourId; label?: string }) {
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={<GraduationCap size={15} />}
      data-tour-button={tour}
      title="Passo a passo desta tela"
      aria-label={label}
      className="tour-btn"
      onClick={() => startPageTour(tour)}
    >
      <span className="tour-btn__text">{label}</span>
    </Button>
  );
}
