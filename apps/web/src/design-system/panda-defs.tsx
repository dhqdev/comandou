/**
 * Degradês do LivePanda (viewBox 64). Cada panda na tela usa o seu prefixo `u` nos ids, para
 * dois pandas não trocarem as cores um do outro.
 */
export function PandaDefs({ u }: { u: string }) {
  return (
    <defs>
      {/* corpo: luz vindo de cima à direita, sombra cinza embaixo e à esquerda (só preto e branco) */}
      <radialGradient id={`${u}-face`} cx="0.64" cy="0.22" r="0.95" fx="0.66" fy="0.2">
        <stop offset="0" style={{ stopColor: 'var(--cm-mascot-face, #fff)' }} />
        <stop offset="0.55" stopColor="#f6f6f7" />
        <stop offset="0.85" stopColor="#e6e6e8" />
        <stop offset="1" stopColor="#d4d4d7" />
      </radialGradient>
      <linearGradient id={`${u}-ink`} x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stopColor="#38383b" />
        <stop offset="1" style={{ stopColor: 'var(--cm-mascot-ink, #1a1613)' }} />
      </linearGradient>
      <radialGradient id={`${u}-iris`} cx="0.42" cy="0.36" r="0.7">
        <stop offset="0" stopColor="#5a5a60" />
        <stop offset="0.55" stopColor="#1e1e21" />
        <stop offset="1" stopColor="#060607" />
      </radialGradient>
      <radialGradient id={`${u}-ground`} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#000" stopOpacity="0.2" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}
