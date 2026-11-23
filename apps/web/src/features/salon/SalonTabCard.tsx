import {
  ArrowRightLeft,
  BadgeDollarSign,
  EllipsisVertical,
  ListChecks,
  Pencil,
  Printer,
} from 'lucide-react';
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Modal, TextField, useToast } from '../../design-system';
import { api } from '../../lib/api';
import type { Tab } from '../../lib/types';
import type { TabIntent } from './TabModal';

/** O que o cartão precisa saber da comanda (vem da mesa ocupada ou da lista de comandas). */
export interface SalonCardTab {
  id: string;
  number: number | null;
  tableLabel: string | null;
  customerName: string | null;
}

/** O que cada ação do cartão pede para a tela fazer. */
export type SalonCardAction = 'open' | 'print' | TabIntent;

/**
 * Cartão de comanda do salão no PDV (mesa ocupada ou comanda aberta): tocar abre a comanda;
 * do lado, imprimir a conta, fechar a conta e os três pontinhos com Ver pedidos, Renomear,
 * Transferir e Fechar conta. Mesa livre continua sendo o cartão simples.
 */
export function SalonTabCard({
  tab,
  state,
  label,
  title,
  children,
  canOperate,
  canPay,
  onAction,
  onRename,
  pix = false,
}: {
  tab: SalonCardTab;
  /** A mesa mandou o comprovante do Pix: o cartão fica em destaque e o $ confere o Pix. */
  pix?: boolean;
  state: string;
  label: string;
  title: ReactNode;
  children: ReactNode;
  canOperate: boolean;
  canPay: boolean;
  onAction(a: SalonCardAction): void;
  onRename(): void;
}) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const printBtn = useRef<HTMLButtonElement>(null);
  /** Cartão estreito (celular): a impressora sai de fora e entra no menu. */
  const [narrow, setNarrow] = useState(false);
  return (
    <div
      className="pdv-table pdv-tabcard"
      data-state={state}
      data-menu={menu || undefined}
      data-pix={pix || undefined}
    >
      <button className="pdv-tabcard__open" aria-label={label} onClick={() => onAction('open')}>
        <strong>{title}</strong>
        {children}
      </button>
      <div className="pdv-tabcard__actions">
        <button
          ref={printBtn}
          type="button"
          className="pdv-tabcard__btn pdv-tabcard__btn--wide"
          aria-label="Imprimir a conta"
          title="Imprimir a conta"
          onClick={() => onAction('print')}
        >
          <Printer size={16} />
        </button>
        {canPay && (
          <button
            type="button"
            className="pdv-tabcard__btn pdv-tabcard__btn--wide pdv-tabcard__btn--pay"
            aria-label={pix ? 'Conferir o Pix da conta' : 'Fechar a conta'}
            title={pix ? 'Conferir o Pix da conta' : 'Fechar a conta'}
            onClick={() => onAction('close')}
          >
            <BadgeDollarSign size={16} />
          </button>
        )}
        <button
          ref={more}
          type="button"
          className="pdv-tabcard__btn"
          aria-label="Mais ações da comanda"
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => {
            setNarrow(!printBtn.current?.offsetParent);
            setMenu((v) => !v);
          }}
        >
          <EllipsisVertical size={16} />
        </button>
      </div>
      {menu && (
        <TabMenu
          anchor={more}
          tab={tab}
          onClose={() => setMenu(false)}
          items={[
            { key: 'open', icon: <ListChecks size={18} />, text: 'Ver pedidos' },
            canOperate && { key: 'rename', icon: <Pencil size={18} />, text: 'Renomear' },
            canOperate && {
              key: 'transfer',
              icon: <ArrowRightLeft size={18} />,
              text: tab.tableLabel ? 'Transferir' : 'Levar para uma mesa',
            },
            narrow && { key: 'print', icon: <Printer size={18} />, text: 'Imprimir conta' },
            canPay && {
              key: 'close',
              icon: <BadgeDollarSign size={18} />,
              text: pix ? 'Conferir Pix' : 'Fechar conta',
              danger: !pix,
            },
          ]}
          onPick={(k) => {
            setMenu(false);
            if (k === 'rename') setRenaming(true);
            else onAction(k);
          }}
        />
      )}
      <RenameTab
        tab={renaming ? tab : null}
        onClose={() => setRenaming(false)}
        onDone={() => {
          setRenaming(false);
          onRename();
        }}
      />
    </div>
  );
}

type MenuItem = {
  key: SalonCardAction | 'rename';
  icon: ReactNode;
  text: string;
  danger?: boolean;
};

/** Menu dos três pontinhos: cabeçalho com a comanda e a mesa, ações e Fechar conta separado. */
function TabMenu({
  anchor,
  tab,
  items,
  onPick,
  onClose,
}: {
  anchor: React.RefObject<HTMLButtonElement | null>;
  tab: SalonCardTab;
  items: (MenuItem | false)[];
  onPick(k: MenuItem['key']): void;
  onClose(): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const list = items.filter((i): i is MenuItem => !!i);
  const main = list.filter((i) => !i.danger);
  const danger = list.filter((i) => i.danger);

  // O salão rola e corta o que passa da borda: o menu mora no <body>, preso ao botão.
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const b = box.current;
      if (!a || !b) return;
      const w = b.offsetWidth;
      const h = b.offsetHeight;
      let top = a.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - 6);
      const left = Math.min(Math.max(8, a.right - w), window.innerWidth - w - 8);
      setPos({ top: Math.round(top), left: Math.round(left) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);

  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({
      preventScroll: true,
    });
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        anchor.current?.focus();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const all = [
        ...(box.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
      ];
      if (!all.length) return;
      e.preventDefault();
      const i = all.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % all.length : (i - 1 + all.length) % all.length;
      all[next].focus();
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [anchor, onClose]);

  const row = (i: MenuItem) => (
    <button
      key={i.key}
      type="button"
      role="menuitem"
      className="pdv-tabmenu__item"
      data-danger={i.danger || undefined}
      onClick={() => onPick(i.key)}
    >
      {i.icon}
      {i.text}
    </button>
  );

  return createPortal(
    <div
      ref={box}
      className="pdv-tabmenu"
      role="menu"
      aria-label={`Comanda ${tab.number ?? ''}`}
      data-placed={pos ? true : undefined}
      style={pos ? { top: pos.top, left: pos.left } : undefined}
    >
      <div className="pdv-tabmenu__head">
        <span>Comanda</span>
        <strong>{tab.number ?? '—'}</strong>
        {(tab.tableLabel || tab.customerName) && (
          <small>
            {[tab.tableLabel && `Mesa ${tab.tableLabel}`, tab.customerName]
              .filter(Boolean)
              .join(' · ')}
          </small>
        )}
      </div>
      <div className="pdv-tabmenu__group">{main.map(row)}</div>
      {danger.length > 0 && <div className="pdv-tabmenu__group">{danger.map(row)}</div>}
    </div>,
    document.body,
  );
}

/** Janela curta para dar (ou tirar) o nome da comanda. */
function RenameTab({
  tab,
  onClose,
  onDone,
}: {
  tab: SalonCardTab | null;
  onClose(): void;
  onDone(): void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (tab) setName(tab.customerName ?? '');
  }, [tab]);

  async function save() {
    if (!tab) return;
    setBusy(true);
    try {
      await api<Tab>(`/tabs/${tab.id}/name`, {
        method: 'POST',
        json: { customerName: name.trim() || null },
      });
      toast(name.trim() ? 'Comanda renomeada' : 'Nome da comanda tirado', 'success');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!tab}
      onClose={onClose}
      title={`Renomear comanda ${tab?.number ?? ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField
          label="Nome da comanda"
          hint="O nome do cliente ou um apelido. Deixe vazio para tirar."
          value={name}
          maxLength={80}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </form>
    </Modal>
  );
}
