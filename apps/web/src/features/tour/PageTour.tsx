import { GraduationCap } from 'lucide-react';
import { useMemo, useSyncExternalStore } from 'react';
import { Button, type FrameItem } from '../../design-system';
import { GuidedTour, type TourEnds, type TourStop } from './GuidedTour';
import {
  FISCAL_STOPS,
  MENU_STOPS,
  STOCK_STOPS,
  fiscalEnds,
  itemEnds,
  itemTour,
  menuEnds,
  stockEnds,
} from './tours';

/**
 * Tutoriais de cada tela: o botão "Tutorial" no topo da tela abre o tour guiado daquela parte do
 * sistema. Um só lugar (PageTourHost, no AppShell) desenha o tour, com o menu da pessoa.
 */
export type PageTourId = 'cardapio' | 'item' | 'fiscal' | 'estoque';

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

function plan(r: NonNullable<Running>): { stops: TourStop[]; ends: TourEnds; label: string } {
  if (r.id === 'fiscal')
    return { stops: FISCAL_STOPS, ends: fiscalEnds, label: 'Tutorial da Nota fiscal' };
  if (r.id === 'estoque')
    return { stops: STOCK_STOPS, ends: stockEnds, label: 'Tutorial do Estoque' };
  if (r.id === 'item')
    return { stops: itemTour(r.path), ends: itemEnds, label: 'Tutorial do item' };
  return { stops: MENU_STOPS, ends: menuEnds, label: 'Tutorial do Cardápio' };
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
