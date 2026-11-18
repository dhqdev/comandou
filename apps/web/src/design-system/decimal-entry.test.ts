import { beforeAll, describe, expect, it } from 'vitest';
import { centsRange, installDecimalEntry, integerRange } from './decimal-entry';

const tick = () => new Promise((r) => setTimeout(r, 5));

function field(value: string) {
  const el = document.createElement('input');
  el.setAttribute('inputmode', 'decimal');
  el.value = value;
  document.body.appendChild(el);
  return el;
}

describe('integerRange / centsRange', () => {
  it('acha a parte antes da vírgula', () => {
    expect(integerRange('0,00')).toEqual([0, 1]);
    expect(integerRange('400,00')).toEqual([0, 3]);
    expect(integerRange('R$ 12,50')).toEqual([3, 5]);
    expect(integerRange('1.234,56')).toEqual([0, 5]);
    expect(integerRange('15')).toBeNull();
    expect(integerRange('')).toBeNull();
  });

  it('a vírgula só pula para os centavos com o cursor antes dela', () => {
    expect(centsRange('3,00', 1, 1)).toEqual([2, 4]);
    expect(centsRange('0,00', 0, 1)).toEqual([2, 4]);
    expect(centsRange('3,00', 3, 3)).toBeNull();
    expect(centsRange('3,00', 0, 4)).toBeNull();
    expect(centsRange('30', 2, 2)).toBeNull();
  });
});

describe('installDecimalEntry', () => {
  beforeAll(() => installDecimalEntry());

  it('ao entrar em 0,00, seleciona o zero antes da vírgula', async () => {
    const el = field('0,00');
    el.focus();
    el.setSelectionRange(4, 4);
    await tick();
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 1]);
  });

  it('respeita o clique no meio do número', async () => {
    const el = field('400,00');
    el.focus();
    el.setSelectionRange(2, 2);
    await tick();
    expect([el.selectionStart, el.selectionEnd]).toEqual([2, 2]);
  });

  it('a vírgula leva o cursor aos centavos', async () => {
    const el = field('3,00');
    el.focus();
    await tick();
    el.setSelectionRange(1, 1);
    const ev = new KeyboardEvent('keydown', { key: ',', bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect([el.selectionStart, el.selectionEnd]).toEqual([2, 4]);
  });

  it('não mexe em campo que não é de valor', async () => {
    const el = field('0,00');
    el.setAttribute('inputmode', 'text');
    el.focus();
    el.setSelectionRange(4, 4);
    await tick();
    expect([el.selectionStart, el.selectionEnd]).toEqual([4, 4]);
  });

  it('preencher o valor inteiro por cima da seleção troca o campo todo', async () => {
    const el = field('0,00');
    el.focus();
    el.setSelectionRange(4, 4);
    await tick();
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 1]);
    const ev = new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: '50,00',
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(el.value).toBe('50,00');
  });
});
