import { useState } from 'react';
import { Button, Sheet } from '../design-system';
import { SignalLevel, testNow, useConnectionQuality } from '../lib/connection-quality';
import './connection-signal.css';

const TONE: Record<SignalLevel, 'good' | 'ok' | 'bad' | 'off'> = {
  4: 'good',
  3: 'good',
  2: 'ok',
  1: 'bad',
  0: 'off',
};

/** As quatro barrinhas do sinal, acesas até o nível. */
export function SignalBars({ level, size = 16 }: { level: SignalLevel; size?: number }) {
  return (
    <svg
      className="signal-bars"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden
      focusable="false"
    >
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={1 + i * 3.75}
          y={12 - i * 3.3}
          width={2.6}
          height={3 + i * 3.3}
          rx={1}
          data-on={i < level || undefined}
        />
      ))}
    </svg>
  );
}

/**
 * Sinal da conexão no topo: mede de 5 em 5 segundos quanto o servidor demora a responder pela
 * própria ligação do tempo real e mostra em barrinhas, como o Wi-Fi. Tocar abre o detalhe.
 */
export function ConnectionSignal() {
  const q = useConnectionQuality();
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const tone = TONE[q.level];
  const title = `Conexão: ${q.label}${q.rtt !== null ? ` (${q.rtt} ms)` : ''}`;
  const live = q.realtime === 'live' && q.online;

  async function retest() {
    setTesting(true);
    try {
      await testNow(3);
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="conn-signal"
        data-tone={tone}
        data-live={live || undefined}
        title={title}
        aria-label={`${title}. Ver detalhes da conexão`}
        onClick={() => setOpen(true)}
      >
        <SignalBars level={q.level} />
        <span className="conn-signal__text">{q.label}</span>
      </button>
      <Sheet
        open={open}
        title="Sua conexão"
        onClose={() => setOpen(false)}
        footer={
          <div className="conn-panel__actions">
            <Button variant="secondary" onClick={() => void retest()} loading={testing}>
              Testar agora
            </Button>
            <Button onClick={() => setOpen(false)}>Pronto</Button>
          </div>
        }
      >
        <div className="conn-panel" data-tone={tone}>
          <div className="conn-panel__head">
            <SignalBars level={q.level} size={40} />
            <div>
              <strong>{q.label}</strong>
              <p className="cm-hint">{q.hint}</p>
            </div>
          </div>
          <dl className="conn-panel__facts">
            <div>
              <dt>Tempo de resposta</dt>
              <dd>{q.rtt !== null ? `${q.rtt} ms` : '—'}</dd>
            </div>
            <div>
              <dt>Atualização automática</dt>
              <dd>{live ? 'Ligada' : 'Esperando a conexão'}</dd>
            </div>
            {q.network && (
              <div>
                <dt>Rede</dt>
                <dd>{q.network}</dd>
              </div>
            )}
          </dl>
          {q.samples.length > 0 && (
            <div className="conn-panel__history" aria-label="Últimas medições">
              {q.samples.map((v, i) => (
                <span
                  key={i}
                  data-tone={v === null ? 'bad' : v <= 350 ? 'good' : v <= 800 ? 'ok' : 'bad'}
                  style={{ height: `${v === null ? 100 : Math.max(12, Math.min(100, v / 10))}%` }}
                  title={v === null ? 'Sem resposta' : `${v} ms`}
                />
              ))}
            </div>
          )}
          <p className="cm-hint">
            Medimos a cada 5 segundos quanto o Comandou demora para responder a este aparelho. Até
            150 ms é excelente, até 350 ms é boa e acima de 800 ms fica ruim. Pedidos, mesas,
            cozinha, caixa e as outras telas se atualizam sozinhos enquanto a conexão estiver
            ligada.
          </p>
        </div>
      </Sheet>
    </>
  );
}
