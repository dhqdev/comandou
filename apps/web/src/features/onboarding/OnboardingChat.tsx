import { ArrowUp, Check } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Button, Mascot } from '../../design-system';
import { api } from '../../lib/api';
import type { StoreSettings } from '../../lib/types';
import { maskPhone } from '../CustomerPicker';
import { MenuImport } from '../menu-import/MenuImport';
import './onboarding.css';

/**
 * Primeiros passos em forma de conversa: o mascote pergunta, a pessoa responde tocando ou
 * digitando, e cada resposta já grava no cadastro da loja (os mesmos campos de Ajustes e Loja
 * online). No meio, o cardápio entra por foto ou PDF, lido pela IA. Abre sozinho no primeiro
 * acesso de quem administra uma loja ainda sem itens; dá para rever em Conta.
 */

const key = (tenantId: string, userId: string) => `cm-tour:inicio:${tenantId}:${userId}`;

export function onboardingSeen(tenantId: string, userId: string) {
  try {
    return localStorage.getItem(key(tenantId, userId)) === 'done';
  } catch {
    return true;
  }
}
export function markOnboardingSeen(tenantId: string, userId: string) {
  try {
    localStorage.setItem(key(tenantId, userId), 'done');
  } catch {
    /* sem armazenamento */
  }
}

type Step = 'hello' | 'sell' | 'whats' | 'address' | 'eta' | 'menu' | 'end';
const ORDER: Step[] = ['hello', 'sell', 'whats', 'address', 'eta', 'menu', 'end'];
interface Msg {
  id: number;
  from: 'bot' | 'me';
  text: string;
}

const SELL = [
  { key: 'delivery', label: 'Entrega' },
  { key: 'pickup', label: 'Retirada no balcão' },
  { key: 'tables', label: 'Mesas no salão' },
] as const;
type SellKey = (typeof SELL)[number]['key'];

const ETAS: [number, number][] = [
  [15, 30],
  [30, 45],
  [45, 60],
  [60, 90],
];

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function OnboardingChat({
  open,
  onClose,
  onTour,
  userName,
  tenantName,
  canImport,
}: {
  open: boolean;
  onClose: () => void;
  /** "Conhecer as telas": fecha a conversa e abre a apresentação guiada. */
  onTour: () => void;
  userName: string;
  tenantName: string;
  /** Pode cadastrar itens (catalog:write): sem isso a conversa pula o cardápio. */
  canImport: boolean;
}) {
  const navigate = useNavigate();
  const [log, setLog] = useState<Msg[]>([]);
  const [step, setStep] = useState<Step>('hello');
  const [typing, setTyping] = useState(false);
  const [sell, setSell] = useState<Set<SellKey>>(new Set());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const first = userName.split(' ')[0] ?? userName;

  const push = useCallback((from: Msg['from'], t: string) => {
    setLog((cur) => [...cur, { id: ++seq.current, from, text: t }]);
  }, []);

  /** O mascote "digita" e fala as frases em sequência; depois libera a resposta do passo. */
  const say = useCallback(
    (lines: string[], next: Step) => {
      const gap = reduced() ? 0 : 520;
      setTyping(true);
      lines.forEach((line, i) => {
        timers.current.push(
          window.setTimeout(
            () => {
              push('bot', line);
              if (i === lines.length - 1) {
                setTyping(false);
                setStep(next);
              }
            },
            gap * (i + 1),
          ),
        );
      });
    },
    [push],
  );

  useEffect(() => {
    if (!open) return;
    setLog([]);
    setSell(new Set());
    setText('');
    seq.current = 0;
    say(
      [
        `Oi, ${first}! Eu sou o Comandou.`,
        `Vou deixar ${tenantName} pronto para vender. São só algumas perguntas rápidas.`,
      ],
      'hello',
    );
    const pending = timers.current;
    return () => {
      pending.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, [open, first, tenantName, say]);

  // Acompanha o fim da conversa, inclusive quando o cartão do cardápio cresce.
  useEffect(() => {
    const thread = end.current?.parentElement;
    if (!open || !thread) return;
    const toEnd = () =>
      end.current?.scrollIntoView({ block: 'end', behavior: reduced() ? 'auto' : 'smooth' });
    const ro = new ResizeObserver(toEnd);
    ro.observe(thread);
    return () => ro.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /** Grava a resposta no cadastro da loja. Se falhar, a conversa segue e avisa onde ajustar. */
  const savePatch = async (patch: Partial<StoreSettings>) => {
    setBusy(true);
    try {
      await api('/store/settings', { method: 'PATCH', json: patch });
      return true;
    } catch {
      push('bot', 'Não consegui salvar essa resposta agora. Depois você ajusta em Ajustes.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const askMenu = () =>
    canImport
      ? say(
          [
            'Agora o cardápio. Me mande a foto do cardápio, a foto de um prato ou o PDF.',
            'Eu leio e cadastro os itens. Você só confere antes de salvar.',
          ],
          'menu',
        )
      : finish();
  const finish = (lead?: string) =>
    say(
      [
        ...(lead ? [lead] : []),
        'Pronto! O básico está feito. O resto você ajusta quando quiser em Ajustes.',
      ],
      'end',
    );
  const askEta = () =>
    sell.has('delivery') || sell.has('pickup')
      ? say(['Quanto tempo leva, em média, para um pedido ficar pronto?'], 'eta')
      : askMenu();

  const answerSell = async () => {
    push(
      'me',
      SELL.filter((s) => sell.has(s.key))
        .map((s) => s.label)
        .join(', '),
    );
    await savePatch({ acceptsDelivery: sell.has('delivery'), acceptsPickup: sell.has('pickup') });
    say(['Qual é o WhatsApp da loja? Ele aparece para o cliente no cardápio.'], 'whats');
  };
  const answerWhats = async (skip?: boolean) => {
    const v = text.trim();
    setText('');
    push('me', skip || !v ? 'Depois eu coloco' : v);
    if (!skip && v) await savePatch({ whatsapp: v });
    say(['E o endereço da loja? Rua, número e bairro.'], 'address');
  };
  const answerAddress = async (skip?: boolean) => {
    const v = text.trim();
    setText('');
    push('me', skip || !v ? 'Depois eu coloco' : v);
    if (!skip && v) await savePatch({ address: v });
    askEta();
  };
  const answerEta = async ([min, max]: [number, number]) => {
    push('me', `${min} a ${max} minutos`);
    await savePatch({ etaMin: min, etaMax: max });
    askMenu();
  };

  if (!open) return null;

  const at = typing ? null : step;
  const input = (placeholder: string, send: (skip?: boolean) => void, tel?: boolean) => (
    <form
      className="onb-input"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <input
        autoFocus
        type={tel ? 'tel' : 'text'}
        inputMode={tel ? 'tel' : undefined}
        aria-label={placeholder}
        placeholder={placeholder}
        value={text}
        maxLength={tel ? 20 : 300}
        onChange={(e) => setText(tel ? maskPhone(e.target.value) : e.target.value)}
      />
      <button type="button" className="onb-skip" onClick={() => send(true)} disabled={busy}>
        Depois
      </button>
      <button
        type="submit"
        className="onb-send"
        aria-label="Enviar"
        disabled={busy || !text.trim()}
      >
        <ArrowUp size={16} aria-hidden />
      </button>
    </form>
  );

  let reply: ReactNode = null;
  if (at === 'hello')
    reply = (
      <div className="onb-choices">
        <Button
          onClick={() => {
            push('me', 'Vamos lá');
            say(['Como você vende? Pode marcar mais de um.'], 'sell');
          }}
        >
          Vamos lá
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Agora não
        </Button>
      </div>
    );
  else if (at === 'sell')
    reply = (
      <div className="onb-choices">
        {SELL.map((s) => (
          <button
            key={s.key}
            type="button"
            className="onb-chip"
            aria-pressed={sell.has(s.key)}
            onClick={() =>
              setSell((cur) => {
                const n = new Set(cur);
                if (!n.delete(s.key)) n.add(s.key);
                return n;
              })
            }
          >
            {sell.has(s.key) && <Check size={14} aria-hidden />}
            {s.label}
          </button>
        ))}
        <Button disabled={sell.size === 0 || busy} onClick={answerSell}>
          Continuar
        </Button>
      </div>
    );
  else if (at === 'whats') reply = input('(11) 99999-9999', answerWhats, true);
  else if (at === 'address') reply = input('Rua, número e bairro', answerAddress);
  else if (at === 'eta')
    reply = (
      <div className="onb-choices">
        {ETAS.map((e) => (
          <button
            key={e[0]}
            type="button"
            className="onb-chip"
            disabled={busy}
            onClick={() => answerEta(e)}
          >
            {e[0]} a {e[1]} min
          </button>
        ))}
      </div>
    );
  else if (at === 'menu')
    reply = (
      <div className="onb-choices">
        <Button
          variant="ghost"
          onClick={() => {
            push('me', 'Cadastro depois');
            finish('Sem problema. Quando quiser, é só abrir Cardápio › Itens › Importar com IA.');
          }}
        >
          Cadastrar depois
        </Button>
      </div>
    );
  else if (at === 'end')
    reply = (
      <div className="onb-choices">
        <Button onClick={onTour}>Conhecer as telas</Button>
        {canImport && (
          <Button
            variant="secondary"
            onClick={() => {
              onClose();
              navigate('/cardapio');
            }}
          >
            Abrir o cardápio
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          Concluir
        </Button>
      </div>
    );

  const progress = Math.round((ORDER.indexOf(step) / (ORDER.length - 1)) * 100);

  return (
    <div className="onb" role="dialog" aria-modal="true" aria-label="Primeiros passos">
      <header className="onb-head">
        <Mascot size={28} badge />
        <div className="onb-head__text">
          <strong>Comandou</strong>
          <span>Primeiros passos</span>
        </div>
        <button type="button" className="onb-skip" onClick={onClose}>
          Pular
        </button>
        <div className="onb-progress" aria-hidden>
          <i style={{ width: `${progress}%` }} />
        </div>
      </header>
      <div className="onb-scroll">
        <div className="onb-thread" aria-live="polite">
          {log.map((m, i) => (
            <div key={m.id} className={`onb-msg onb-msg--${m.from}`}>
              {m.from === 'bot' &&
                (log[i - 1]?.from === 'bot' ? (
                  <span className="onb-msg__gap" />
                ) : (
                  <Mascot size={28} badge className="onb-msg__avatar" />
                ))}
              <p>{m.text}</p>
            </div>
          ))}
          {at === 'menu' && (
            <div className="onb-card">
              <MenuImport
                onFinish={(n) => {
                  push(
                    'me',
                    n === 1 ? '1 item conferido e salvo' : `${n} itens conferidos e salvos`,
                  );
                  finish('Ficou ótimo. Seu cardápio já está no ar no PDV e na loja online.');
                }}
              />
            </div>
          )}
          {typing && (
            <div className="onb-msg onb-msg--bot" aria-label="Comandou está digitando">
              {log[log.length - 1]?.from === 'bot' ? (
                <span className="onb-msg__gap" />
              ) : (
                <Mascot size={28} badge className="onb-msg__avatar" />
              )}
              <p className="onb-typing">
                <i />
                <i />
                <i />
              </p>
            </div>
          )}
          <div ref={end} />
        </div>
      </div>
      <footer className="onb-reply">{reply}</footer>
    </div>
  );
}
