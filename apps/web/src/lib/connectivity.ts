import { useEffect, useState } from 'react';

/**
 * Indicador de conectividade. Offline NÃO significa que ações foram salvas:
 * a UI bloqueia operações críticas (pagamento, caixa, confirmação de pedido) sem conexão.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
