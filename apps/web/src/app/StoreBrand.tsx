import { useEffect, useState } from 'react';
import { BRAND_CACHED_EVENT, cachedBranding } from '../design-system';

/**
 * Topo do menu lateral: a logo e o nome do restaurante (não a marca do Comandou). Sem logo
 * enviada, mostra a inicial do nome num quadrado da cor da marca. No menu recolhido e no
 * celular (`compact`) fica só a logo.
 */
export function StoreBrand({ name, compact }: { name: string; compact?: boolean }) {
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

  const initial = (name.trim()[0] ?? 'C').toUpperCase();
  return (
    <span className="cm-store-brand" data-compact={compact || undefined} title={name}>
      {logo && !broken ? (
        <img
          className="cm-store-brand__logo"
          src={logo}
          alt=""
          width={36}
          height={36}
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="cm-store-brand__logo cm-store-brand__logo--initial" aria-hidden>
          {initial}
        </span>
      )}
      <span className="cm-store-brand__name">{name}</span>
    </span>
  );
}
