import { useEffect, useState } from 'react';
import { Shirt, X } from 'lucide-react';
import { Button, Modal } from './components';
import { Mascot } from './mascot';
import {
  PANDA_ITEMS,
  PANDA_SLOTS,
  PandaBuddy,
  PandaItemIcon,
  usePandaHidden,
  usePandaOutfit,
  type PandaSlot,
} from './panda-buddy';
import type { PandaMood } from './panda-live';

/** Guarda-roupa do panda: abre pelo botão do canto ou por openPandaWardrobe(). */
export function PandaWardrobe({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [outfit, setOutfit] = usePandaOutfit();
  const [mood, setMood] = useState<PandaMood>('idle');

  const wear = (slot: PandaSlot, id: string | undefined) => {
    const next = { ...outfit };
    if (!id || next[slot] === id) {
      delete next[slot];
      setMood('idle');
    } else {
      next[slot] = id;
      setMood('joy');
    }
    setOutfit(next);
  };

  return (
    <Modal
      open={open}
      title="Roupinhas do panda"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => setOutfit({})}>
            Tirar tudo
          </Button>
          <Button onClick={onClose}>Pronto</Button>
        </>
      }
    >
      <div className="pb-ward__stage">
        <PandaBuddy size={170} mood={mood} outfit={outfit} wave />
      </div>
      {PANDA_SLOTS.map((s) => (
        <section key={s.id}>
          <div className="pb-ward__sec">{s.label}</div>
          <div className="pb-ward__grid">
            <button
              type="button"
              className={`pb-ward__tile ${outfit[s.id] ? '' : 'is-on'}`}
              onClick={() => wear(s.id, undefined)}
            >
              <span className="pb-ward__art pb-ward__none">∅</span>
              Nenhum
            </button>
            {PANDA_ITEMS.filter((i) => i.slot === s.id).map((i) => (
              <button
                key={i.id}
                type="button"
                className={`pb-ward__tile ${outfit[s.id] === i.id ? 'is-on' : ''}`}
                aria-pressed={outfit[s.id] === i.id}
                onClick={() => wear(s.id, i.id)}
              >
                <span className="pb-ward__art">
                  <PandaItemIcon id={i.id} slot={i.slot} size={s.id === 'eyes' ? 76 : 70} />
                </span>
                {i.label}
              </button>
            ))}
          </div>
        </section>
      ))}
    </Modal>
  );
}

/** Panda grande no canto da tela: acompanha o mouse, acena, e abre o guarda-roupa. */
export function PandaCorner() {
  const [hidden, setHidden] = usePandaHidden();
  const [open, setOpen] = useState(false);
  const [mood, setMood] = useState<PandaMood>('idle');

  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener('cm:panda-wardrobe', on);
    return () => window.removeEventListener('cm:panda-wardrobe', on);
  }, []);

  // Dá oi uma vez ao abrir o sistema.
  useEffect(() => {
    const t = setTimeout(() => setMood('happy'), 600);
    const t2 = setTimeout(() => setMood('idle'), 2600);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, []);

  return (
    <>
      {hidden ? (
        <button
          type="button"
          className="pb-corner__tab"
          aria-label="Mostrar o panda"
          title="Mostrar o panda"
          onClick={() => setHidden(false)}
        >
          <Mascot size={32} />
        </button>
      ) : (
        <div className="pb-corner">
          <PandaBuddy size={190} mood={mood} wave title="Panda do Comandou" />
          <div className="pb-corner__tools">
            <button
              type="button"
              className="pb-corner__btn"
              aria-label="Trocar de roupinha"
              title="Roupinhas"
              onClick={() => setOpen(true)}
            >
              <Shirt size={16} />
            </button>
            <button
              type="button"
              className="pb-corner__btn"
              aria-label="Esconder o panda"
              title="Esconder"
              onClick={() => setHidden(true)}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
      <PandaWardrobe open={open} onClose={() => setOpen(false)} />
    </>
  );
}
