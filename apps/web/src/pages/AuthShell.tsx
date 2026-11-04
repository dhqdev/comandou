import { Eye, EyeOff } from 'lucide-react';
import { InputHTMLAttributes, KeyboardEvent, ReactNode, useState } from 'react';
import { Logo, Mascot, TextField, ThemeToggle } from '../design-system';
import './login.css';

/**
 * Moldura de todas as telas de entrada (restaurante, garçom, cozinha, entregas e Super Admin),
 * no padrão do Planejai: no celular, sem cartão e sem enfeite, só título, campos grandes e o botão;
 * no notebook, o formulário à esquerda e um painel liso com o mascote à direita.
 */
export function AuthShell(props: {
  /** Linha pequena acima do título (nome do restaurante, "Super Admin"). */
  place?: ReactNode;
  title: string;
  sub?: ReactNode;
  /** Formulário. */
  children: ReactNode;
  /** Ajuda no pé da tela (esqueci a senha etc.). */
  help?: ReactNode;
  /** Frase do painel do notebook. */
  pitch?: ReactNode;
}) {
  return (
    <div className="login">
      <main className="login__panel">
        <header className="login__top">
          <Logo size={30} />
          <ThemeToggle />
        </header>

        <div className="login__body">
          {props.place && <span className="login__place">{props.place}</span>}
          <h1 className="login__title">{props.title}</h1>
          {props.sub && <p className="login__sub">{props.sub}</p>}
          {props.children}
        </div>

        <footer className="login__foot">
          {props.help && <p className="login__help">{props.help}</p>}
          <span className="login__version">Comandou v{__APP_VERSION__}</span>
        </footer>
      </main>

      <aside className="login__art" aria-hidden>
        <Mascot size={148} animated mood="joy" className="login__mascot" />
        <h2 className="login__pitch">
          {props.pitch ?? (
            <>
              Pedidos, salão, cozinha e caixa
              <span> no mesmo lugar.</span>
            </>
          )}
        </h2>
      </aside>
    </div>
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
