import { Fragment, type ReactNode } from 'react';

/**
 * Texto com a formatação do WhatsApp, como o cliente vê: *negrito*, _itálico_, ~riscado~,
 * ```monoespaçado```, `código` e linhas de citação com "> ". Usado nas prévias das mensagens
 * (Assistente de IA, avisos do WhatsApp).
 */
const TOKEN = /(```[^`]+```|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;

function inline(text: string, key: string): ReactNode[] {
  return text.split(TOKEN).map((part, i) => {
    const k = `${key}-${i}`;
    if (!part) return null;
    if (part.startsWith('```') && part.endsWith('```') && part.length > 6)
      return (
        <code key={k} className="wa-mono">
          {part.slice(3, -3)}
        </code>
      );
    if (part.length > 2 && part[0] === part[part.length - 1]) {
      const body = part.slice(1, -1);
      if (part[0] === '*') return <strong key={k}>{inline(body, k)}</strong>;
      if (part[0] === '_') return <em key={k}>{inline(body, k)}</em>;
      if (part[0] === '~') return <s key={k}>{inline(body, k)}</s>;
      if (part[0] === '`')
        return (
          <code key={k} className="wa-code">
            {body}
          </code>
        );
    }
    return <Fragment key={k}>{part}</Fragment>;
  });
}

export function WaText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <span className="wa-text">
      {lines.map((line, i) => {
        if (line.startsWith('> '))
          return (
            <span key={i} className="wa-quote">
              {inline(line.slice(2), `q${i}`)}
            </span>
          );
        return (
          <Fragment key={i}>
            {inline(line, `l${i}`)}
            {i < lines.length - 1 && <br />}
          </Fragment>
        );
      })}
    </span>
  );
}
