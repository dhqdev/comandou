import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button, TextField } from './components';

describe('Design System', () => {
  it('Button em carregamento fica desabilitado e anuncia aria-busy', () => {
    render(<Button loading>Salvar</Button>);
    const b = screen.getByRole('button', { name: 'Salvar' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
  });
  it('TextField associa label e mensagem de erro acessível', () => {
    render(<TextField label="Preço" error="Use o formato 12,90" />);
    const input = screen.getByLabelText('Preço');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Use o formato 12,90');
  });
});
