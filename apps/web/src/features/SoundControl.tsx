import { Play, Volume2, VolumeX } from 'lucide-react';
import { useState } from 'react';
import { Button, Sheet } from '../design-system';
import {
  playSound,
  setSoundSettings,
  SOUND_INFO,
  toggleSoundKind,
  useSoundSettings,
  type SoundKind,
} from '../lib/sounds';
import '../app/home.css';
import './sound-control.css';

/**
 * Botão de som da barra de cima: mostra se os avisos sonoros estão ligados e abre os ajustes
 * (liga/desliga geral, volume e cada som com botão de testar). `only` limita a lista aos sons
 * que fazem sentido na tela (ex.: link do entregador).
 */
export function SoundControl({ only }: { only?: SoundKind[] }) {
  const s = useSoundSettings();
  const [open, setOpen] = useState(false);
  const list = only ? SOUND_INFO.filter((i) => only.includes(i.kind)) : SOUND_INFO;
  const label = s.enabled ? 'Sons ligados' : 'Sons desligados';
  return (
    <>
      <button
        type="button"
        className="cm-theme-toggle sound-btn"
        data-on={s.enabled || undefined}
        aria-label={`${label}. Ajustar sons`}
        title={label}
        onClick={() => setOpen(true)}
      >
        {s.enabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
      </button>
      <Sheet
        open={open}
        title="Sons de aviso"
        onClose={() => setOpen(false)}
        footer={
          <Button block onClick={() => setOpen(false)}>
            Pronto
          </Button>
        }
      >
        <div className="sound-panel">
          <label className="switch sound-panel__master">
            <input
              type="checkbox"
              checked={s.enabled}
              onChange={(e) => setSoundSettings({ enabled: e.target.checked })}
            />
            <span className="switch__track" />
            <span>
              <strong>Tocar sons neste aparelho</strong>
              <span className="cm-hint">Cada tablet ou computador guarda a própria escolha.</span>
            </span>
          </label>
          <label className="sound-panel__volume" data-off={!s.enabled || undefined}>
            <VolumeX size={16} aria-hidden />
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(s.volume * 100)}
              disabled={!s.enabled}
              aria-label="Volume"
              onChange={(e) => setSoundSettings({ volume: Number(e.target.value) / 100 })}
              onPointerUp={() => playSound('ready', true)}
            />
            <Volume2 size={16} aria-hidden />
          </label>
          <ul className="sound-panel__list" data-off={!s.enabled || undefined}>
            {list.map((i) => (
              <li key={i.kind} data-kind={i.kind}>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={!s.off.includes(i.kind)}
                    disabled={!s.enabled}
                    onChange={(e) => toggleSoundKind(i.kind, e.target.checked)}
                  />
                  <span className="switch__track" />
                  <span>
                    <strong>{i.label}</strong>
                    <span className="cm-hint">{i.hint}</span>
                  </span>
                </label>
                <Button
                  variant="ghost"
                  icon={<Play size={14} />}
                  aria-label={`Testar som: ${i.label}`}
                  onClick={() => playSound(i.kind, true)}
                >
                  Testar
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </Sheet>
    </>
  );
}
