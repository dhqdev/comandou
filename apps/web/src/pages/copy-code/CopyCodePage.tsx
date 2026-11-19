import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Mascot } from '../../design-system';
import './copy-code.css';

/** Só aceita o código de 6 números que o e-mail manda (nada de texto solto do endereço). */
export function readCode(hash: string): string | null {
  const v = decodeURIComponent(hash.replace(/^#/, '')).trim();
  return /^\d{6}$/.test(v) ? v : null;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Navegador antigo ou sem permissão: o jeito velho, com um campo escondido.
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    el.remove();
    return ok;
  }
}

/**
 * /codigo#123456: aberta pelo botão "Copiar código" dos e-mails de nova senha (e-mail não roda
 * script). Mostra o código e copia com um toque; tenta copiar sozinha ao abrir (o navegador só
 * deixa quando o toque no link conta). O código fica depois do `#` (não vai ao servidor) e sai do
 * endereço assim que a página abre, para não ficar no histórico.
 */
export function CopyCodePage() {
  const [code] = useState(() => readCode(window.location.hash));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (window.location.hash)
      history.replaceState(null, '', window.location.pathname + window.location.search);
    document.title = 'Copiar código · Comandou';
    if (code) void copyText(code).then((ok) => ok && setCopied(true));
  }, [code]);

  async function copy() {
    if (code && (await copyText(code))) setCopied(true);
  }

  return (
    <main className="copy-code">
      <div className="copy-code__card">
        <Mascot size={56} mood={copied ? 'joy' : 'wink'} badge />
        {code ? (
          <>
            <h1>Seu código</h1>
            <button
              type="button"
              className="copy-code__value"
              onClick={copy}
              aria-label={`Código ${code.split('').join(' ')}. Toque para copiar.`}
            >
              {code}
            </button>
            <Button
              size="lg"
              block
              variant={copied ? 'secondary' : 'primary'}
              icon={copied ? <Check size={18} /> : <Copy size={18} />}
              onClick={copy}
            >
              {copied ? 'Código copiado' : 'Copiar código'}
            </Button>
            <p className="copy-code__hint" aria-live="polite">
              {copied
                ? 'Agora volte para a tela de nova senha e cole o código.'
                : 'Toque no botão para copiar e depois cole na tela de nova senha.'}
            </p>
          </>
        ) : (
          <>
            <h1>Código não encontrado</h1>
            <p className="copy-code__hint">
              Abra o link pelo botão do e-mail ou copie o código direto do e-mail.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
