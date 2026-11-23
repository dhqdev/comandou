import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicOrderPage } from './PublicOrderPage';

const apiMock = vi.fn();
vi.mock('../../lib/api', () => ({
  api: (...a: unknown[]) => apiMock(...a),
  ApiError: class extends Error {},
}));

const at = '2026-11-23T12:51:00.000Z';
function order(step: string, channel: 'table' | 'delivery' | 'pickup') {
  return {
    restaurant: { name: 'Fumaça Burger & Co.', whatsapp: null, logoUrl: null, chat: false },
    etaMin: 20,
    etaMax: 30,
    number: 18599,
    channel,
    tableLabel: channel === 'table' ? '2' : null,
    selfPickup: false,
    canPickUp: false,
    step,
    canCancel: false,
    createdAt: at,
    customerName: 'Cliente',
    deliveryAddress: null,
    notes: null,
    subtotal: '44.90',
    deliveryFee: '0',
    discount: '0',
    surcharge: '0',
    total: '44.90',
    paymentHint: null,
    changeFor: null,
    paymentStatus: 'unpaid',
    cancelReason: null,
    timeline: {
      awaiting: at,
      accepted: at,
      ready: at,
      dispatched: null,
      completed: null,
      cancelled: null,
    },
    items: [
      {
        name: 'Fumaça (o da casa)',
        quantity: '1',
        total: '44.90',
        notes: null,
        imageUrl: null,
        options: [],
      },
    ],
    courier: null,
    pix: null,
    online: null,
  };
}

const STEPS = ['awaiting', 'accepted', 'ready', 'dispatched', 'completed', 'cancelled'] as const;

/** Blocos do CSS (fora de @media, que só vale com "reduzir movimento" ou outra tela). */
function cssOf(file: string) {
  const css = readFileSync(join(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const keyframes = new Map<string, string>();
  const rules: { selector: string; body: string }[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    // Acha o fim do bloco (com chaves de dentro, como em @keyframes e @media).
    let depth = 1;
    let j = open + 1;
    while (depth && j < css.length) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    const body = css.slice(open + 1, j - 1);
    if (head.startsWith('@keyframes')) keyframes.set(head.split(/\s+/)[1]!, body);
    else if (!head.startsWith('@')) rules.push({ selector: head, body });
    i = j;
  }
  return { keyframes, rules };
}

/**
 * Animações que o CSS liga nos elementos desta tela: o nome de cada `animation:` cuja regra vale
 * para algum elemento desenhado.
 */
function animationsOn(root: Element, files: string[]) {
  const all = files.map(cssOf);
  const keyframes = new Map(all.flatMap((c) => [...c.keyframes]));
  const used = new Map<string, string>();
  const els = [root, ...root.querySelectorAll('*')];
  for (const { rules } of all)
    for (const { selector, body } of rules) {
      const m = /(?:^|;)\s*animation(?:-name)?\s*:\s*([^;]+)/.exec(body);
      if (!m || /^\s*none\b/.test(m[1]!)) continue;
      const name = m[1]!.split(/\s+/).find((w) => keyframes.has(w));
      if (!name) continue;
      for (const sel of selector.split(',')) {
        const clean = sel.trim().replace(/::?(before|after)$/, '');
        let hit = false;
        try {
          hit = els.some((el) => el.matches(clean));
        } catch {
          /* seletor que o jsdom não entende */
        }
        if (hit) used.set(name, keyframes.get(name)!);
      }
    }
  return used;
}

/*
 * A tela do pedido fica aberta o tempo todo na mão do cliente. Animação que mexe em opacidade nela
 * (vapor que some e aparece, pulso) fazia a tela inteira ficar mais fraca e mais forte no Safari do
 * iPhone. Os desenhos se mexem, mas só com transform e traço.
 */
describe('Acompanhamento do pedido: desenhos com movimento, sem piscar', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
  });

  for (const channel of ['table', 'delivery', 'pickup'] as const)
    for (const step of STEPS)
      it(`${channel} · ${step}: nenhuma animação mexe em opacidade`, async () => {
        apiMock.mockResolvedValue(order(step, channel));
        const { container } = render(
          <MemoryRouter initialEntries={['/pedido/tok']}>
            <Routes>
              <Route path="/pedido/:token" element={<PublicOrderPage />} />
            </Routes>
          </MemoryRouter>,
        );
        await screen.findByText('Pedido #18599');
        const used = animationsOn(container, ['art.css', 'public.css']);
        // Os desenhos seguem animados (pedido do David). A comanda do "aguardando" é parada desde
        // sempre e o cancelado é um ícone.
        if (step !== 'awaiting' && step !== 'cancelled') expect(used.size).toBeGreaterThan(0);
        for (const [name, frames] of used) expect(frames, name).not.toMatch(/opacity/);
      });

  /*
   * A causa da tela inteira piscando no iPhone (2026-11-23): o esqueleto de carregamento pulsava a
   * opacidade (1 ↔ 0,5) e o React reaproveitava esse mesmo <div> como o .track da página. No
   * Safari a animação ficava presa e a página toda pulsava a 50%, sem parar.
   */
  it('carregando: o esqueleto não mexe em opacidade', () => {
    apiMock.mockReturnValue(new Promise(() => undefined));
    const { container } = render(
      <MemoryRouter initialEntries={['/pedido/tok']}>
        <Routes>
          <Route path="/pedido/:token" element={<PublicOrderPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Carregando o pedido');
    const used = animationsOn(container, ['public.css', '../../design-system/skeleton.css']);
    expect(used.size).toBeGreaterThan(0);
    for (const [name, frames] of used) expect(frames, name).not.toMatch(/opacity/);
  });

  it('o esqueleto não vira a página: a tela do pedido nasce num elemento novo', async () => {
    let arrive: (o: unknown) => void = () => undefined;
    apiMock.mockReturnValue(new Promise((r) => (arrive = r)));
    const { container } = render(
      <MemoryRouter initialEntries={['/pedido/tok']}>
        <Routes>
          <Route path="/pedido/:token" element={<PublicOrderPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const loadingMain = container.querySelector('main');
    const loadingNodes = [...container.querySelectorAll('main *')];
    expect(loadingMain).toHaveAttribute('aria-busy', 'true');
    arrive(order('ready', 'table'));
    await screen.findByText('Pedido #18599');
    const main = container.querySelector('main');
    expect(main).not.toBe(loadingMain);
    expect(loadingMain!.isConnected).toBe(false);
    // Nenhum pedaço do esqueleto continua na tela (nem reaproveitado como outro bloco).
    for (const el of loadingNodes) expect(el.isConnected).toBe(false);
  });

  it('nenhum esqueleto do cardápio pulsa a opacidade (.sk)', () => {
    const { keyframes, rules } = cssOf('public.css');
    const sk = rules.find((r) => r.selector === '.sk');
    const name = /animation:\s*([\w-]+)/.exec(sk?.body ?? '')?.[1];
    expect(name).toBeTruthy();
    expect(keyframes.get(name!)).not.toMatch(/opacity/);
  });

  it('o pulso do motoboy no mapa fica parado nesta tela', () => {
    const { rules } = cssOf('public.css');
    const rule = rules.find((r) => r.selector === '.store--track .live-rider__pulse');
    expect(rule?.body).toMatch(/animation:\s*none !important/);
  });
});
