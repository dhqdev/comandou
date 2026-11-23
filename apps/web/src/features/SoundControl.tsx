import { BellRing, Mic, Play, Square, Trash2, Upload, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Sheet } from '../design-system';
import {
  customClipUrl,
  deleteCustomClip,
  MAX_RECORD_SECONDS,
  playSound,
  recordFromMic,
  REPEAT_OPTIONS,
  REPEATING_KINDS,
  saveCustomClip,
  setSoundSettings,
  setSoundTone,
  snoozeAlarms,
  SOUND_INFO,
  TONE_INFO,
  toggleSoundKind,
  useAlarmRinging,
  useSoundSettings,
  type SoundKind,
  type SoundTone,
} from '../lib/sounds';
import '../app/home.css';
import './sound-control.css';

/**
 * Botão de som (barra da cozinha e do entregador): mostra se os avisos sonoros estão ligados (e
 * pisca quando um aviso está repetindo) e abre os ajustes. `only` limita a lista aos sons que
 * fazem sentido na tela. No painel do restaurante o botão saiu do topo: os ajustes moram na
 * tela Conta › Este aparelho.
 */
export function SoundControl({ only }: { only?: SoundKind[] }) {
  const s = useSoundSettings();
  const ringing = useAlarmRinging();
  const [open, setOpen] = useState(false);
  const label = ringing ? 'Aviso tocando' : s.enabled ? 'Sons ligados' : 'Sons desligados';
  return (
    <>
      <button
        type="button"
        className="cm-theme-toggle sound-btn"
        data-on={s.enabled || undefined}
        data-ringing={ringing || undefined}
        aria-label={`${label}. Ajustar sons`}
        title={label}
        onClick={() => setOpen(true)}
      >
        {ringing ? (
          <BellRing size={18} />
        ) : s.enabled ? (
          <Volume2 size={18} />
        ) : (
          <VolumeX size={18} />
        )}
      </button>
      <SoundSettings open={open} onClose={() => setOpen(false)} only={only} />
    </>
  );
}

/**
 * Ajustes dos sons de aviso deste aparelho (liga/desliga, volume, repetição, som gravado e o
 * timbre de cada aviso), numa folha. Aberta pelo botão de som (cozinha, entregador) e, no painel
 * do restaurante, pelo bloco Sons de aviso da tela Conta.
 */
export function SoundSettings({
  open,
  onClose,
  only,
}: {
  open: boolean;
  onClose: () => void;
  only?: SoundKind[];
}) {
  const s = useSoundSettings();
  const ringing = useAlarmRinging();
  const list = only ? SOUND_INFO.filter((i) => only.includes(i.kind)) : SOUND_INFO;
  const repeats = list.some((i) => REPEATING_KINDS.includes(i.kind));
  const tones = TONE_INFO.filter((t) => t.tone !== 'gravado' || s.recorded);
  return (
    <Sheet
      open={open}
      title="Sons de aviso"
      onClose={onClose}
      footer={
        <Button block onClick={onClose}>
          Pronto
        </Button>
      }
    >
      <div className="sound-panel">
        {ringing && (
          <div className="sound-panel__ringing" role="status">
            <BellRing size={18} aria-hidden />
            <span>Tem pedido esperando. O aviso repete até alguém atender.</span>
            <Button variant="secondary" onClick={() => snoozeAlarms(2)}>
              Silenciar 2 min
            </Button>
          </div>
        )}
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

        {repeats && (
          <div className="sound-panel__repeat" data-off={!s.enabled || undefined}>
            <label className="switch">
              <input
                type="checkbox"
                checked={s.repeat}
                disabled={!s.enabled}
                onChange={(e) => setSoundSettings({ repeat: e.target.checked })}
              />
              <span className="switch__track" />
              <span>
                <strong>Ficar apitando até atender</strong>
                <span className="cm-hint">
                  Novo pedido e pedido de cancelamento tocam de novo enquanto estiverem pendentes.
                </span>
              </span>
            </label>
            <select
              className="cm-input sound-panel__select"
              aria-label="Repetir a cada"
              value={s.repeatEvery}
              disabled={!s.enabled || !s.repeat}
              onChange={(e) => setSoundSettings({ repeatEvery: Number(e.target.value) })}
            >
              {REPEAT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  A cada {n < 60 ? `${n} s` : '1 min'}
                </option>
              ))}
            </select>
          </div>
        )}

        <CustomSound recorded={s.recorded} disabled={!s.enabled} />

        <ul className="sound-panel__list" data-off={!s.enabled || undefined}>
          {list.map((i) => {
            const tone = s.tones[i.kind] ?? 'padrao';
            return (
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
                <div className="sound-panel__row">
                  <select
                    className="cm-input sound-panel__select"
                    aria-label={`Som de ${i.label}`}
                    value={tone === 'gravado' && !s.recorded ? 'padrao' : tone}
                    disabled={!s.enabled || s.off.includes(i.kind)}
                    onChange={(e) => {
                      const t = e.target.value as SoundTone;
                      setSoundTone(i.kind, t);
                      playSound(i.kind, true, t);
                    }}
                  >
                    {tones.map((t) => (
                      <option key={t.tone} value={t.tone}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="ghost"
                    icon={<Play size={14} />}
                    aria-label={`Testar som: ${i.label}`}
                    onClick={() => playSound(i.kind, true)}
                  >
                    Testar
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Sheet>
  );
}

/** Gravar um som pelo microfone (ou escolher um arquivo) para usar nos avisos. */
function CustomSound({ recorded, disabled }: { recorded: boolean; disabled: boolean }) {
  const [state, setState] = useState<'idle' | 'recording' | 'saving'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state !== 'recording') return;
    const started = Date.now();
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => window.clearInterval(id);
  }, [state]);
  // Fechou a folha no meio da gravação: encerra o microfone.
  useEffect(() => () => stopRef.current?.(), []);

  async function save(blob: Blob | null, err?: string) {
    stopRef.current = null;
    if (!blob) {
      setError(err ?? 'Nada foi gravado.');
      setState('idle');
      return;
    }
    setState('saving');
    try {
      await saveCustomClip(blob);
      setError(null);
      playSound('order', true, 'gravado');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setState('idle');
    }
  }

  async function start() {
    setError(null);
    setSeconds(0);
    try {
      stopRef.current = await recordFromMic((b, e) => void save(b, e));
      setState('recording');
    } catch (e) {
      const name = (e as DOMException).name;
      setError(
        name === 'NotAllowedError'
          ? 'O navegador não liberou o microfone. Permita o microfone para este site e tente de novo.'
          : name === 'NotFoundError'
            ? 'Nenhum microfone encontrado neste aparelho.'
            : (e as Error).message,
      );
    }
  }

  async function preview() {
    const url = await customClipUrl();
    if (url) playSound('order', true, 'gravado');
  }

  return (
    <section className="sound-panel__custom" data-off={disabled || undefined}>
      <div>
        <strong>Seu próprio som</strong>
        <span className="cm-hint">
          Grave até {MAX_RECORD_SECONDS} segundos (uma voz, um sino, o nome da casa) e escolha
          &quot;Som gravado&quot; no aviso que quiser. Fica guardado só neste aparelho.
        </span>
      </div>
      <div className="sound-panel__custom-actions">
        {state === 'recording' ? (
          <Button variant="danger" icon={<Square size={14} />} onClick={() => stopRef.current?.()}>
            Parar ({seconds}s de {MAX_RECORD_SECONDS}s)
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              icon={<Mic size={14} />}
              disabled={disabled || state === 'saving'}
              onClick={() => void start()}
            >
              {recorded ? 'Gravar de novo' : 'Gravar'}
            </Button>
            <Button
              variant="ghost"
              icon={<Upload size={14} />}
              disabled={disabled || state === 'saving'}
              onClick={() => fileRef.current?.click()}
            >
              Arquivo
            </Button>
            {recorded && (
              <>
                <Button
                  variant="ghost"
                  icon={<Play size={14} />}
                  disabled={disabled}
                  onClick={() => void preview()}
                >
                  Ouvir
                </Button>
                <Button
                  variant="ghost"
                  icon={<Trash2 size={14} />}
                  aria-label="Apagar som gravado"
                  onClick={() => void deleteCustomClip()}
                />
              </>
            )}
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void save(f);
          }}
        />
      </div>
      {state === 'recording' && (
        <span className="sound-panel__rec" role="status">
          <span className="cm-dot cm-dot--pulse" /> Gravando…
        </span>
      )}
      {error && (
        <span className="cm-hint sound-panel__error" role="alert">
          {error}
        </span>
      )}
    </section>
  );
}
