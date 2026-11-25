import { describe, expect, it } from 'vitest';
import { glideShift, messageEl, topOf } from './glide';

describe('conversa que sobe deslizando quando entra mensagem nova', () => {
  it('desliza só o que a conversa subiu', () => {
    expect(glideShift(500, 440, 700)).toBe(60);
    expect(glideShift(500.4, 440.1, 700)).toBe(60);
  });
  it('não anima sem medida, sem subir, quase nada ou mais que a tela', () => {
    expect(glideShift(null, 440, 700)).toBe(0);
    expect(glideShift(500, null, 700)).toBe(0);
    expect(glideShift(440, 500, 700)).toBe(0);
    expect(glideShift(500, 499, 700)).toBe(0);
    expect(glideShift(1500, 400, 700)).toBe(0);
  });
  it('acha a mensagem pela chave e ignora chave estranha', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div data-k="local-3"></div><div data-k="abc"></div>';
    expect(messageEl(root, 'local-3')).toBe(root.firstElementChild);
    expect(messageEl(root, 'x"]')).toBeNull();
    expect(messageEl(root, undefined)).toBeNull();
    expect(topOf(root, 'abc')).toBe(0);
    expect(topOf(root, 'nada')).toBeNull();
  });
});
