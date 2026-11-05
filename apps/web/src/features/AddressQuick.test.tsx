import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddressQuick, formatAddress } from './AddressQuick';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const PAULISTA = {
  cep: '01310100',
  street: 'Avenida Paulista',
  district: 'Bela Vista',
  city: 'São Paulo',
  state: 'SP',
};

let line = '';
function Form() {
  const [v, setV] = useState('');
  line = v;
  return <AddressQuick value={v} onChange={setV} />;
}

describe('Endereço digitado pela equipe', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('monta a linha do endereço', () => {
    expect(
      formatAddress({
        cep: '01310100',
        street: 'Avenida Paulista',
        number: '1000',
        complement: 'Apto 5',
        district: 'Bela Vista',
        city: 'São Paulo',
        state: 'SP',
      }),
    ).toBe('Avenida Paulista, 1000 - Apto 5 - Bela Vista, São Paulo/SP - CEP 01310-100');
    expect(
      formatAddress({
        cep: '',
        street: '',
        number: '1',
        complement: '',
        district: '',
        city: '',
        state: '',
      }),
    ).toBe('');
  });

  it('cidade do restaurante + rua digitada acham o CEP; CEP preenche o resto', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) =>
        u === '/api/v1/store/region'
          ? json({ city: 'São Paulo', state: 'SP' })
          : u.startsWith('/api/v1/store/cep?')
            ? json([PAULISTA])
            : json(PAULISTA),
      ),
    );
    render(<Form />);
    await waitFor(() => expect(screen.getByLabelText(/^Cidade/)).toHaveValue('São Paulo'));
    fireEvent.change(screen.getByLabelText(/^Rua/), { target: { value: 'Paulista' } });
    await screen.findAllByRole('option', {}, { timeout: 2000 });
    fireEvent.click(screen.getByText('CEP 01310-100', { exact: false }));
    fireEvent.change(screen.getByLabelText(/^Número/), { target: { value: '1000' } });
    expect(line).toBe('Avenida Paulista, 1000 - Bela Vista, São Paulo/SP - CEP 01310-100');
  });

  it('CEP digitado preenche rua e bairro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) =>
        u === '/api/v1/store/region' ? json({ city: null, state: null }) : json(PAULISTA),
      ),
    );
    render(<Form />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/^CEP/), { target: { value: '01310100' } });
    });
    await waitFor(() => expect(screen.getByLabelText(/^Rua/)).toHaveValue('Avenida Paulista'));
    expect(screen.getByLabelText(/^Bairro/)).toHaveValue('Bela Vista');
    expect(line).toContain('CEP 01310-100');
  });
});
