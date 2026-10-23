import { useRegisterSW } from 'virtual:pwa-register/react';

/** O app se atualiza sozinho (autoUpdate); aqui só procura versão nova ao voltar para ele. */
export function UpdatePrompt() {
  useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (document.visibilityState === 'visible') void registration.update();
      };
      document.addEventListener('visibilitychange', check);
      setInterval(check, 30 * 60 * 1000);
    },
  });
  return null;
}
