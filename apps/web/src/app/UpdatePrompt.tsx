import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '../design-system';

/** Nova versão do app disponível: o usuário escolhe quando recarregar (não interrompe uma venda). */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div className="pm-toasts">
      <div
        className="pm-toast"
        role="status"
        style={{ display: 'flex', gap: 12, alignItems: 'center' }}
      >
        Nova versão disponível.
        <Button variant="secondary" onClick={() => updateServiceWorker(true)}>
          Atualizar
        </Button>
        <Button variant="ghost" onClick={() => setNeedRefresh(false)} style={{ color: '#fff' }}>
          Depois
        </Button>
      </div>
    </div>
  );
}
