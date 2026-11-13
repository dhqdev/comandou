import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rowClick } from './rowClick';

function Row({ open, action }: { open(): void; action(): void }) {
  return (
    <table>
      <tbody>
        <tr {...rowClick(open)}>
          <td>Arroz</td>
          <td>
            <button onClick={action}>
              <span>Entrada</span>
            </button>
            {createPortal(<button>No modal</button>, document.body)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

afterEach(cleanup);

describe('rowClick', () => {
  it('abre ao clicar em qualquer ponto da linha', () => {
    const open = vi.fn();
    render(<Row open={open} action={vi.fn()} />);
    fireEvent.click(screen.getByText('Arroz'));
    expect(open).toHaveBeenCalledTimes(1);
  });
  it('não abre ao clicar nos botões da linha nem em modais abertos a partir dela', () => {
    const open = vi.fn();
    const action = vi.fn();
    render(<Row open={open} action={action} />);
    fireEvent.click(screen.getByText('Entrada'));
    fireEvent.click(screen.getByText('No modal'));
    expect(action).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });
});
