import { describe, expect, it } from 'vitest';
import { errorMessage } from './api';

describe('errorMessage', () => {
  it('mostra o motivo da validação quando há um só', () => {
    expect(
      errorMessage(
        {
          message: 'Dados inválidos',
          issues: [
            { path: 'password', message: 'Essa senha é fácil de adivinhar. Escolha outra.' },
          ],
        },
        400,
      ),
    ).toBe('Essa senha é fácil de adivinhar. Escolha outra.');
  });

  it('o mesmo motivo repetido conta como um só', () => {
    expect(
      errorMessage(
        { message: 'Dados inválidos', issues: [{ message: 'x' }, { message: 'x' }] },
        400,
      ),
    ).toBe('x');
  });

  it('com vários motivos, ou outro erro, fica a mensagem da API', () => {
    expect(
      errorMessage(
        { message: 'Dados inválidos', issues: [{ message: 'a' }, { message: 'b' }] },
        400,
      ),
    ).toBe('Dados inválidos');
    expect(errorMessage({ message: 'PIN incorreto' }, 401)).toBe('PIN incorreto');
    expect(errorMessage(undefined, 502)).toBe('Erro 502');
  });
});
