import { MailCheck } from 'lucide-react';
import {
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Alert, Button, TextField } from '../design-system';
import { api, ApiError } from '../lib/api';
import { AuthShell, deskFocus, PasswordField } from './AuthShell';

type Step = 'email' | 'code' | 'password';

/** Espera para pedir outro código (o e-mail costuma chegar em segundos). */
const RESEND_SECONDS = 45;

/**
 * "Esqueci minha senha" de qualquer tela de entrada (painel, PDV, cozinha, entregas, garçom com
 * e-mail e Super Admin), em três passos: 1) e-mail, 2) o código de 6 números que chegou (o código
 * vem no assunto do e-mail: dá para copiar da notificação; colar ou o preenchimento automático
 * do celular completam as 6 caixas), 3) a senha nova. Restaurante: já entra. Super Admin: volta
 * para o login, que continua pedindo o código do autenticador.
 */
export function ForgotPassword(props: {
  /** Rota da API: /auth/password-reset ou /platform/auth/password-reset. */
  base: string;
  brand?: ReactNode;
  sub?: ReactNode;
  initialEmail?: string;
  /** Tamanho mínimo da senha nova (painel do restaurante 8, Super Admin 10). */
  minPassword?: number;
  /** Texto do botão final. */
  finishLabel?: string;
  onBack(): void;
  /** Senha gravada (a resposta da API vem junto). */
  onDone(email: string, body: unknown): void | Promise<void>;
}) {
  const min = props.minPassword ?? 8;
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState(props.initialEmail ?? '');
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const [desk] = useState(deskFocus);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.status === 429)
      setError(err.message || 'Muitas tentativas. Aguarde um minuto e tente de novo.');
    else setError((err as Error).message);
  };

  async function send(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api(`${props.base}/request`, { method: 'POST', json: { email: email.trim() } });
      setCode('');
      setStep('code');
      setWait(RESEND_SECONDS);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function verify(value = code) {
    if (value.length !== 6 || busy) return;
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ token: string }>(`${props.base}/verify`, {
        method: 'POST',
        json: { email: email.trim(), code: value },
      });
      setToken(r.token);
      setStep('password');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401)
        setError('Código errado ou vencido. Confira o último e-mail ou peça outro.');
      else fail(err);
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < min) return setError(`A senha precisa de pelo menos ${min} caracteres.`);
    if (password !== repeat) return setError('As duas senhas estão diferentes.');
    setBusy(true);
    try {
      const body = await api(`${props.base}/complete`, {
        method: 'POST',
        json: { token, password },
      });
      await props.onDone(email.trim(), body);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('O tempo para criar a senha acabou. Peça um código novo.');
        setStep('email');
      } else fail(err);
    } finally {
      setBusy(false);
    }
  }

  const n = step === 'email' ? 1 : step === 'code' ? 2 : 3;
  const back = (
    <button
      type="button"
      className="login__link"
      onClick={() => {
        setError(null);
        if (step === 'code') setStep('email');
        else props.onBack();
      }}
    >
      {step === 'code' ? 'Trocar o e-mail' : 'Voltar para entrar'}
    </button>
  );

  return (
    <AuthShell brand={props.brand} title="Criar uma nova senha" sub={props.sub} help={back}>
      <div className="forgot" key={step}>
        <div className="forgot__steps" aria-label={`Passo ${n} de 3`}>
          {[1, 2, 3].map((i) => (
            <span key={i} className={i <= n ? 'is-on' : undefined} />
          ))}
        </div>

        {step === 'email' && (
          <form onSubmit={send} className="login__form forgot__form" noValidate>
            <div className="forgot__head">
              <h2>Esqueceu a senha?</h2>
              <p>
                Digite o e-mail da sua conta. Vamos mandar um código de 6 números para criar uma
                senha nova.
              </p>
            </div>
            <TextField
              label="E-mail"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus={desk}
              required
            />
            {error && <Alert tone="danger">{error}</Alert>}
            <Button
              type="submit"
              size="lg"
              block
              loading={busy}
              disabled={!/.+@.+\..+/.test(email)}
            >
              Enviar código
            </Button>
          </form>
        )}

        {step === 'code' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
            className="login__form forgot__form"
            noValidate
          >
            <div className="forgot__head">
              <span className="forgot__icon" aria-hidden>
                <MailCheck size={22} />
              </span>
              <h2>Confira seu e-mail</h2>
              <p>
                Se <strong>{email.trim()}</strong> tiver conta, o código chega em instantes. Ele
                aparece no assunto do e-mail: dá para copiar direto da notificação.
              </p>
            </div>
            <CodeInput
              value={code}
              onChange={(v) => {
                setCode(v);
                if (v.length === 6) void verify(v);
              }}
              disabled={busy}
              invalid={!!error}
              autoFocus={desk}
            />
            {error && <Alert tone="danger">{error}</Alert>}
            <Button type="submit" size="lg" block loading={busy} disabled={code.length !== 6}>
              Confirmar código
            </Button>
            <p className="login__note forgot__resend">
              Não chegou? Olhe o spam ou{' '}
              {wait > 0 ? (
                <span>peça outro em {wait}s</span>
              ) : (
                <button type="button" className="login__link" onClick={() => void send()}>
                  mande outro código
                </button>
              )}
              .
            </p>
          </form>
        )}

        {step === 'password' && (
          <form onSubmit={save} className="login__form forgot__form" noValidate>
            <div className="forgot__head">
              <h2>Crie a senha nova</h2>
              <p>Código confirmado. Escolha uma senha com pelo menos {min} caracteres.</p>
            </div>
            <input type="email" autoComplete="username" value={email} readOnly hidden />
            <PasswordField
              label="Senha nova"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus={desk}
              required
            />
            <PasswordField
              label="Repita a senha nova"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              required
            />
            <Meter value={password} min={min} />
            {error && <Alert tone="danger">{error}</Alert>}
            <Button
              type="submit"
              size="lg"
              block
              loading={busy}
              disabled={password.length < min || !repeat}
            >
              {props.finishLabel ?? 'Salvar e entrar'}
            </Button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}

/** Força da senha em três níveis (só um empurrãozinho, não bloqueia além do mínimo). */
function Meter({ value, min }: { value: string; min: number }) {
  if (!value) return null;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(value)).length;
  const level = value.length < min ? 0 : value.length >= min + 4 && kinds >= 3 ? 2 : 1;
  const label = ['Curta demais', 'Boa', 'Forte'][level];
  return (
    <div className={`forgot__meter forgot__meter--${level}`} aria-live="polite">
      <span />
      <span />
      <span />
      <em>{label}</em>
    </div>
  );
}

/**
 * Seis caixas para o código. A primeira tem `one-time-code` (o iPhone e o Android oferecem o
 * código que chegou); colar em qualquer caixa, ou o preenchimento automático, espalha os números.
 */
export function CodeInput(props: {
  value: string;
  onChange(v: string): void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => props.value[i] ?? '');

  const put = (from: number, raw: string) => {
    const typed = raw.replace(/\D/g, '');
    if (!typed) return;
    const next = (props.value.slice(0, from) + typed).slice(0, 6);
    props.onChange(next);
    refs.current[Math.min(next.length, 5)]?.focus();
  };

  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const cut = digits[i] ? i : Math.max(0, i - 1);
      props.onChange(props.value.slice(0, cut));
      refs.current[cut]?.focus();
    } else if (e.key === 'ArrowLeft') refs.current[Math.max(0, i - 1)]?.focus();
    else if (e.key === 'ArrowRight') refs.current[Math.min(5, i + 1)]?.focus();
  };

  const onPaste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    put(i, e.clipboardData.getData('text'));
  };

  return (
    <div
      className={`otp${props.invalid ? ' is-wrong' : ''}`}
      role="group"
      aria-label="Código de 6 números"
    >
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className={d ? 'is-filled' : undefined}
          value={d}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Número ${i + 1}`}
          maxLength={6}
          disabled={props.disabled}
          autoFocus={props.autoFocus && i === 0}
          onFocus={(e) => {
            // Sempre continua de onde parou (não deixa buraco no meio).
            if (i > props.value.length) refs.current[props.value.length]?.focus();
            else e.target.select();
          }}
          onChange={(e) => {
            const raw = e.target.value;
            put(i, d && raw.length > 1 && raw.startsWith(d) ? raw.slice(1) : raw);
          }}
          onKeyDown={(e) => onKey(i, e)}
          onPaste={(e) => onPaste(i, e)}
        />
      ))}
    </div>
  );
}

/** Link "Esqueci minha senha" embaixo do campo da senha. */
export function ForgotLink({ onClick }: { onClick(): void }) {
  return (
    <p className="forgot__link">
      <button type="button" className="login__link" onClick={onClick}>
        Esqueci minha senha
      </button>
    </p>
  );
}
