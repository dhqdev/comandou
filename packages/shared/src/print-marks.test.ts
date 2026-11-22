import { describe, expect, it } from 'vitest';
import {
  agentSupportsMarks,
  parsePrintLines,
  plainPrintText,
  printLineColumns,
  widenBigLine,
} from './print-marks';

describe('marcas do texto de impressão', () => {
  it('lê cada linha com o estilo dela', () => {
    const lines = parsePrintLines(
      '@@LOGO@@\n@@G@@  LOJA\n@@N@@PEDIDO: #1\nsimples\n@@QR@@https://x',
    );
    expect(lines.map((l) => l.kind)).toEqual(['logo', 'big', 'bold', 'text', 'qr']);
    expect(printLineColumns(lines[1])).toBe(12);
  });

  it('sem marcas para o aplicativo antigo: some a logo, a letra grande volta à bobina', () => {
    const out = plainPrintText(
      '@@LOGO@@\n@@G@@     LOJA\n@@N@@PEDIDO: #1\n@@G@@TOTAL:       R$ 9,00\n@@QR@@https://x',
    );
    const [loja, pedido, total, qr] = out.split('\n');
    expect(loja.trim()).toBe('LOJA');
    expect(loja.length).toBeGreaterThan(15); // continua centralizada em 42 colunas
    expect(pedido).toBe('PEDIDO: #1');
    expect(total).toMatch(/^TOTAL:\s+R\$ 9,00$/);
    expect(total.length).toBe(42);
    expect(qr).toBe('@@QR@@https://x');
    expect(widenBigLine('')).toBe('');
  });

  it('versão do aplicativo que entende as marcas', () => {
    expect(agentSupportsMarks('1.11.0')).toBe(true);
    expect(agentSupportsMarks('1.12.3')).toBe(true);
    expect(agentSupportsMarks('2.0.0')).toBe(true);
    expect(agentSupportsMarks('1.10.9')).toBe(false);
    expect(agentSupportsMarks('1.9.0')).toBe(false);
    expect(agentSupportsMarks(null)).toBe(false);
  });
});
