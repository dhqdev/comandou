import { useEffect, useState } from 'react';
import {
  MASCOT_ITEMS,
  MASCOT_LOOKS,
  MASCOT_SLOTS,
  type MascotItemId,
  type MascotOutfit,
  type MascotSlot,
} from '@comandou/shared';
import { LivePanda, Modal, type PandaGesture, type PandaMood } from '../../design-system';
import { setOutfit, setStroll, useMascot, WARDROBE_EVENT } from './state';
import './mascot.css';

const same = (a: MascotOutfit, b: MascotOutfit) => a.head === b.head && a.neck === b.neck;

const EXPRESSIONS: { id: PandaMood; label: string }[] = [
  { id: 'idle', label: 'Normal' },
  { id: 'happy', label: 'Feliz' },
  { id: 'wink', label: 'Piscando' },
  { id: 'wow', label: 'Surpreso' },
  { id: 'talking', label: 'Falando' },
  { id: 'sleep', label: 'Dormindo' },
];

/** Guarda-roupa: montado uma vez no app, abre com openWardrobe(). */
export function WardrobeHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(WARDROBE_EVENT, on);
    return () => window.removeEventListener(WARDROBE_EVENT, on);
  }, []);
  return <Wardrobe open={open} onClose={() => setOpen(false)} />;
}

function Wardrobe({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { outfit, stroll } = useMascot();
  const [mood, setMood] = useState<PandaMood>('idle');
  const [cue, setCue] = useState<{ g: PandaGesture; n: number }>();

  const wear = (slot: MascotSlot, id: MascotItemId | undefined) => {
    const next: MascotOutfit = { ...outfit };
    if (!id || next[slot] === id) delete next[slot];
    else next[slot] = id;
    setOutfit(next);
  };
  const look = MASCOT_LOOKS.find((l) => same(l.outfit, outfit));
  const wearing = MASCOT_ITEMS.filter((i) => outfit[i.slot] === i.id).map((i) => i.label);

  return (
    <Modal open={open} onClose={onClose} title="Seu panda" size="lg">
      <div className="pw">
        <div className="pw-stage">
          <LivePanda size={168} mood={mood} outfit={outfit} cue={cue} title="Panda vestido" />
          <div className="pw-stage__name">
            {look?.label ?? (wearing.length ? 'Do seu jeito' : 'Sem roupa')}
          </div>
          <div className="pw-stage__hint">
            {wearing.length ? wearing.join(' · ') : 'o panda de sempre'}
          </div>
        </div>

        <div className="pw-panel">
          <div className="pw-section">Prontos</div>
          <div className="pw-grid">
            {MASCOT_LOOKS.map((l) => (
              <Tile
                key={l.id}
                label={l.label}
                active={same(l.outfit, outfit)}
                onClick={() => setOutfit(same(l.outfit, outfit) ? {} : l.outfit)}
              >
                <LivePanda size={58} still outfit={l.outfit} />
              </Tile>
            ))}
            <Tile
              label="Sem roupa"
              active={!outfit.head && !outfit.neck}
              onClick={() => setOutfit({})}
            >
              <LivePanda size={58} still />
            </Tile>
          </div>

          {MASCOT_SLOTS.map((slot) => (
            <div key={slot.id}>
              <div className="pw-section">{slot.label}</div>
              <div className="pw-grid">
                {MASCOT_ITEMS.filter((i) => i.slot === slot.id).map((item) => (
                  <Tile
                    key={item.id}
                    label={item.label}
                    active={outfit[slot.id] === item.id}
                    onClick={() => wear(slot.id, item.id)}
                  >
                    <LivePanda size={58} still outfit={{ ...outfit, [slot.id]: item.id }} />
                  </Tile>
                ))}
              </div>
            </div>
          ))}

          <div className="pw-section">Expressões e gestos</div>
          <div className="pw-chips">
            {EXPRESSIONS.map((e) => (
              <button
                key={e.id}
                type="button"
                className="pw-chip"
                aria-pressed={mood === e.id}
                onClick={() => setMood(e.id)}
              >
                {e.label}
              </button>
            ))}
          </div>
          <div className="pw-chips">
            {(
              [
                ['hop', 'Pular'],
                ['wave', 'Acenar'],
                ['sway', 'Balançar'],
                ['look', 'Olhar em volta'],
              ] as const
            ).map(([g, label]) => (
              <button
                key={g}
                type="button"
                className="pw-chip pw-chip--ghost"
                onClick={() => setCue((c) => ({ g, n: (c?.n ?? 0) + 1 }))}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="pw-toggle">
            <span>
              <strong>Passear pela tela</strong>
              <small>De vez em quando ele aparece no canto de baixo, acena e vai embora.</small>
            </span>
            <span className="switch">
              <input
                type="checkbox"
                checked={stroll}
                onChange={(e) => setStroll(e.target.checked)}
                aria-label="Passear pela tela"
              />
              <span className="switch__track" aria-hidden />
            </span>
          </label>
        </div>
      </div>
    </Modal>
  );
}

function Tile({
  children,
  label,
  active,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="pw-tile" aria-pressed={active} onClick={onClick} title={label}>
      <span className="pw-tile__art">{children}</span>
      <span className="pw-tile__label">{label}</span>
    </button>
  );
}
