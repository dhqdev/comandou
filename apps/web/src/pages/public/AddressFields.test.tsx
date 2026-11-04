import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddressFields, type AddressDraft } from './AddressFields';

const EMPTY: AddressDraft = {
  cep: '',
  street: '',
  number: '',
  district: '',
  city: '',
  state: '',
  complement: '',
  reference: '',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function Form() {
  const [v, setV] = useState(EMPTY);
  return (
    <AddressFields
      value={v}
      onChange={(p) => setV((x) => ({ ...x, ...p }))}
      city="São Paulo"
      state="SP"
    />
  );
}

const PAULISTA = {
  cep: '01310100',
  street: 'Avenida Paulista',
  district: 'Bela Vista',
  city: 'São Paulo',
  state: 'SP',
};

describe('Endereço com CEP', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('CEP digitado preenche rua, bairro, cidade e UF', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(PAULISTA)),
    );
    render(<Form />);
    fireEvent.change(screen.getByLabelText(/^CEP/), { target: { value: '01310100' } });
    await waitFor(() => expect(screen.getByLabelText(/^Rua/)).toHaveValue('Avenida Paulista'));
    expect(screen.getByLabelText(/^CEP/)).toHaveValue('01310-100');
    expect(screen.getByLabelText(/^Bairro/)).toHaveValue('Bela Vista');
  });

  it('rua digitada mostra os CEPs e escolher um preenche o resto', async () => {
    const fetch = vi.fn(async (u: string) =>
      u.startsWith('/api/v1/store/cep?')
        ? json([PAULISTA, { ...PAULISTA, cep: '01311000' }])
        : json({}, 404),
    );
    vi.stubGlobal('fetch', fetch);
    render(<Form />);
    fireEvent.change(screen.getByLabelText(/^Rua/), { target: { value: 'Av Paulista' } });
    const hits = await screen.findAllByRole('option', {}, { timeout: 2000 });
    expect(hits).toHaveLength(2);
    expect(String(fetch.mock.calls[0][0])).toContain('city=S%C3%A3o+Paulo');
    fireEvent.click(screen.getByText('CEP 01310-100', { exact: false }));
    expect(screen.getByLabelText(/^CEP/)).toHaveValue('01310-100');
    expect(screen.getByLabelText(/^Rua/)).toHaveValue('Avenida Paulista');
    expect(screen.getByLabelText(/^Bairro/)).toHaveValue('Bela Vista');
  });

  it('um só CEP para a rua já vale ao sair do campo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json([PAULISTA])),
    );
    render(<Form />);
    const rua = screen.getByLabelText(/^Rua/);
    fireEvent.change(rua, { target: { value: 'Paulista' } });
    await screen.findAllByRole('option', {}, { timeout: 2000 });
    fireEvent.blur(rua);
    await waitFor(() => expect(screen.getByLabelText(/^CEP/)).toHaveValue('01310-100'));
  });

  it('API sem acesso aos serviços de CEP: o navegador pergunta direto à ViaCEP', async () => {
    const fetch = vi.fn(async (u: string) =>
      u.startsWith('https://viacep.com.br/ws/01310100/json/')
        ? json({
            cep: '01310-100',
            logradouro: 'Avenida Paulista',
            bairro: 'Bela Vista',
            localidade: 'São Paulo',
            uf: 'SP',
          })
        : json({ message: 'fora do ar' }, 503),
    );
    vi.stubGlobal('fetch', fetch);
    render(<Form />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/^CEP/), { target: { value: '01310-100' } });
    });
    await waitFor(() => expect(screen.getByLabelText(/^Rua/)).toHaveValue('Avenida Paulista'));
  });
});
