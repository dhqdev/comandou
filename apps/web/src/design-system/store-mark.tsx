import { useEffect, useState, type ReactNode } from 'react';
import { BRAND_CACHED_EVENT, cachedBranding } from './brand';
import { Mascot, type MascotMood } from './mascot';

/**
 * Ícone do restaurante guardado neste navegador (favicon da Loja online, senão a logo), e
 * acompanha quando a Loja online troca. null = o restaurante ainda não colocou nenhum.
 */
export function useStoreIcon(): string | null {
  const pick = () => {
    const b = cachedBranding();
    return b?.faviconUrl || b?.logoUrl || null;
  };
  const [icon, setIcon] = useState(pick);
  useEffect(() => {
    const sync = () => setIcon(pick());
    window.addEventListener(BRAND_CACHED_EVENT, sync);
    return () => window.removeEventListener(BRAND_CACHED_EVENT, sync);
  }, []);
  return icon;
}

/**
 * A marca do restaurante onde antes ia o panda do Comandou (telas vazias, avisos, cardápio do
 * cliente). Com logo ou ícone na Loja online, mostra só ela; sem nenhum (ou se a imagem não
 * abrir), o panda fica de reserva. `src` usa uma imagem já conhecida (ex.: a logo que veio do
 * cardápio) no lugar da guardada no navegador.
 */
export function StoreMark({
  size = 56,
  src,
  mood = 'happy',
  badge,
  animated,
  className = '',
  fallback,
}: {
  size?: number;
  src?: string | null;
  mood?: MascotMood;
  badge?: boolean;
  /** O panda de reserva balança de leve. */
  animated?: boolean;
  className?: string;
  /** O que aparece sem logo (padrão: o panda). */
  fallback?: ReactNode;
}) {
  const cached = useStoreIcon();
  const icon = src || cached;
  const [broken, setBroken] = useState<string | null>(null);
  if (icon && broken !== icon)
    return (
      <img
        className={`cm-store-mark ${className}`}
        src={icon}
        alt=""
        width={size}
        height={size}
        decoding="async"
        style={{ width: size, height: size }}
        onError={() => setBroken(icon)}
      />
    );
  return (
    <>
      {fallback ?? (
        <Mascot size={size} mood={mood} badge={badge} animated={animated} className={className} />
      )}
    </>
  );
}
