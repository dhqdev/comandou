import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { printDocument } from '../lib/print-doc';
import { RECEIPT_PRINT_CSS, ReceiptView } from './CourierPayouts';

const payout = {
  id: 'p1',
  courierId: 'c1',
  courierName: 'Kaique Souza',
  periodFrom: '2026-11-11',
  periodTo: '2026-11-17',
  deliveries: 34,
  daysWorked: 0,
  distanceM: 62000,
  rides: '227.60',
  daily: '0.00',
  adjustments: '0.00',
  gross: '227.60',
  inss: '0.00',
  irrf: '0.00',
  iss: '0.00',
  net: '227.60',
  employer: '0.00',
  taxRegime: 'mei' as const,
  method: 'pix',
  notes: null,
  paidAt: '2026-11-18T00:09:00Z',
  inFinance: true,
};

afterEach(() => {
  cleanup();
  document.getElementById('cm-print-frame')?.remove();
});

describe('recibo de pagamento ao entregador', () => {
  it('imprime numa folha própria com nome, período, valores e assinatura', () => {
    const { container } = render(<ReceiptView p={payout} />);
    const el = container.querySelector('.cp-receipt')!;
    const print = vi.fn();
    // jsdom não imprime: troca o print do iframe por um espião.
    const realWin = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')!;
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true,
      get() {
        const w = realWin.get!.call(this) as Window;
        w.print = print;
        w.focus = () => undefined;
        return w;
      },
    });
    try {
      printDocument({
        title: 'Recibo - Kaique Souza',
        html: `<h1>Recibo de pagamento ao entregador</h1>${el.outerHTML}`,
        css: RECEIPT_PRINT_CSS,
      });
    } finally {
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', realWin);
    }

    expect(print).toHaveBeenCalledOnce();
    const frame = document.getElementById('cm-print-frame') as HTMLIFrameElement;
    const body = frame.contentDocument!.body.textContent!.replace(/\s+/g, ' ');
    expect(body).toContain('Kaique Souza');
    expect(body).toContain('11/11/2026 a 17/11/2026');
    expect(body).toMatch(/R\$\s?227,60/);
    expect(body).toContain('Líquido para o entregador');
    expect(body).toContain('Assinatura do entregador');
  });
});
