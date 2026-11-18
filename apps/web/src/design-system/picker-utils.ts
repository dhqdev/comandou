import { Ref, useEffect, useState } from 'react';

/** Peças comuns dos seletores (pickers.tsx e date-picker.tsx). Não sai no index. */

export function useCoarse() {
  const q = '(pointer: coarse)';
  const [coarse, set] = useState(() => !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const on = () => set(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return coarse;
}

export function setRef<T>(ref: Ref<T> | undefined, el: T | null) {
  if (typeof ref === 'function') ref(el);
  else if (ref) (ref as { current: T | null }).current = el;
}

/** Troca o valor do elemento nativo e avisa o React, como se a pessoa tivesse escolhido ali. */
export function commit(
  el: HTMLInputElement | HTMLSelectElement,
  value: string,
  event: 'input' | 'change',
) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event(event, { bubbles: true }));
}

/** Nome do campo para o título da folha: aria-label, <label> ou o rótulo do .cm-field. */
export function fieldName(el: HTMLElement, fallback: string) {
  const label = (el as HTMLInputElement).labels?.[0];
  return (
    el.getAttribute('aria-label') ||
    el.closest('.cm-field')?.querySelector('.cm-label')?.textContent?.trim() ||
    // <label> que envolve o campo: só o texto dele, sem as opções do select.
    (label && !label.contains(el) ? label.textContent?.trim() : '') ||
    fallback
  );
}
