import { Eye, EyeOff } from 'lucide-react';
import { InputHTMLAttributes, KeyboardEvent, ReactNode, useEffect, useState } from 'react';
import { BRAND_CACHED_EVENT, cachedBranding, Logo, TextField } from '../design-system';
import { LoginBackdrop } from './LoginBackdrop';
import './login.css';

/**
 * Moldura de todas as telas de entrada (restaurante, garçom, cozinha, entregas e Super Admin):
 * minimalista, uma coluna só no meio da tela, com a marca em cima e os campos logo abaixo. Sem
 * mascote, frase ou painel do lado. No restaurante a marca é a logo e o nome da loja. Atrás, o
 * fundo animado na cor da marca (LoginBackdrop).
 */
export function AuthShell(props: {
  /** Marca no topo; sem ela, o logo do Comandou. */
  brand?: ReactNode;
  /** Nome da tela, para leitor de tela (não aparece). */
  title: string;
  /** Linha pequena abaixo da marca (ex.: "Salão"). */
  sub?: ReactNode;
  /** Formulário. */
  children: ReactNode;
  /** Link pequeno abaixo do formulário (entrar com PIN etc.). */
  help?: ReactNode;
}) {
  return (
    <div className="login">
      <LoginBackdrop />
      <main className="login__body">
        <div className="login__brand">{props.brand ?? <Logo size={36} />}</div>
        <h1 className="cm-sr-only">{props.title}</h1>
        {props.sub && <p className="login__sub">{props.sub}</p>}
        {props.children}
        {props.help && <p className="login__help">{props.help}</p>}
      </main>
      <span className="login__version">v{__APP_VERSION__}</span>
    </div>
  );
}

/**
 * Logo e nome do restaurante no login. A logo vem da identidade guardada neste navegador (e
 * atualiza quando a loja responde); sem logo, a inicial do nome num quadrado da cor da marca.
 */
export function StoreLoginBrand({ name }: { name: string | null }) {
  const [logo, setLogo] = useState(() => cachedBranding()?.logoUrl ?? null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const sync = () => {
      setLogo(cachedBranding()?.logoUrl ?? null);
      setBroken(false);
    };
    window.addEventListener(BRAND_CACHED_EVENT, sync);
    return () => window.removeEventListener(BRAND_CACHED_EVENT, sync);
  }, []);
  // Nome ainda carregando e sem logo guardada: espaço reservado, sem piscar o panda.
  const initial = (name?.trim()[0] ?? '').toUpperCase();
  return (
    <span className="login__store">
      {logo && !broken ? (
        <img
          className="login__store-logo"
          src={logo}
          alt=""
          width={72}
          height={72}
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="login__store-logo login__store-logo--initial" aria-hidden>
          {initial}
        </span>
      )}
      <span className="login__store-name">{name ?? '\u00a0'}</span>
    </span>
  );
}

/** Foco automático só com mouse: no celular ele abria o teclado e empurrava a tela para cima. */
export const deskFocus = () =>
  typeof window !== 'undefined' && !window.matchMedia?.('(pointer: coarse)').matches;

/** Senha com o olho de mostrar/esconder e o aviso de Caps Lock. */
export function PasswordField(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label?: string },
) {
  const { label = 'Senha', ...rest } = props;
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) =>
    setCaps(e.getModifierState?.('CapsLock') ?? false);
  return (
    <div className="login__password">
      <TextField
        {...rest}
        label={label}
        type={show ? 'text' : 'password'}
        onKeyUp={onKey}
        onKeyDown={onKey}
        hint={caps ? 'Caps Lock está ligado.' : undefined}
      />
      <button
        type="button"
        className="login__reveal"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Esconder senha' : 'Mostrar senha'}
        title={show ? 'Esconder senha' : 'Mostrar senha'}
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}
