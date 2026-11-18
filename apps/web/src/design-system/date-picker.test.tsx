import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { TextField } from './components';
import { monthCells } from './date-picker';

function Field({ initial = '2026-11-18', required = false }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <TextField
        label="Vencimento"
        type="date"
        value={v}
        required={required}
        onChange={(e) => setV(e.target.value)}
      />
      <output data-testid="v">{v}</output>
    </>
  );
}

describe('Campo de data', () => {
  afterEach(cleanup);

  it('monta 6 semanas começando no domingo', () => {
    const cells = monthCells(new Date(2026, 10, 1));
    expect(cells).toHaveLength(42);
    // 01/11/2026 é domingo: a grade começa nele.
    expect(cells[0]).toBe('2026-11-01');
    expect(cells[41]).toBe('2026-12-12');
    expect(monthCells(new Date(2026, 9, 1))[0]).toBe('2026-09-27');
  });

  it('clicar no campo abre o calendário e o dia escolhido vira o valor', () => {
    render(<Field />);
    fireEvent.mouseDown(screen.getByLabelText('Vencimento'), { button: 0 });
    const pop = screen.getByRole('dialog', { name: 'Vencimento' });
    expect(pop).toHaveTextContent('Novembro 2026');
    fireEvent.click(screen.getByRole('button', { name: '25 de novembro de 2026' }));
    expect(screen.getByTestId('v')).toHaveTextContent('2026-11-25');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('troca de mês, escolhe mês pelo título e limpa', () => {
    render(<Field />);
    fireEvent.mouseDown(screen.getByLabelText('Vencimento'), { button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Próximo mês' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Dezembro 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Escolher mês e ano' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ano anterior' }));
    fireEvent.click(screen.getByRole('button', { name: 'Março de 2025' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Março 2025');
    fireEvent.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(screen.getByTestId('v')).toBeEmptyDOMElement();
  });

  it('campo obrigatório não oferece Limpar; Esc fecha', () => {
    render(<Field required />);
    fireEvent.mouseDown(screen.getByLabelText(/Vencimento/), { button: 0 });
    expect(screen.queryByRole('button', { name: 'Limpar' })).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('nenhuma tela usa o calendário nativo (todo campo de data passa pelo DateInput)', () => {
    const root = join(__dirname, '..');
    const bad: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx$/.test(f) && !/date-picker|\.test\./.test(f)) {
          const src = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
          if (/<input[^>]*type="(date|datetime-local|month)"/s.test(src)) bad.push(p);
        }
      }
    };
    walk(root);
    expect(bad).toEqual([]);
  });
});
