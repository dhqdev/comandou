import { describe, expect, it } from 'vitest';
import { FIX_HINTS, findFixHint } from './fix-hints';
import { STATIC_ENTRIES } from './nav-catalog';

describe('caminho para resolver os impedimentos', () => {
  // Mensagens exatamente como a API devolve hoje.
  const cases: [string, string][] = [
    ['Caixa fechado: abra um caixa para continuar', 'cash-closed'],
    ['Este terminal já tem um caixa aberto', 'cash-terminal-busy'],
    ['Produto esgotado: X-Burger', 'product-sold-out'],
    ['Comanda não está aberta', 'tab-closed'],
    ['Comanda de destino não está aberta', 'tab-closed'],
    ['Mesa já está ocupada', 'table-busy'],
    ['Mesa de destino está ocupada', 'table-busy'],
    ['Há saldo em aberto em 2 pedido(s)', 'tab-unpaid'],
    ['Há 1 pedido(s) ainda em produção', 'tab-in-production'],
    ['Configure o CNPJ em Fiscal > Configuração', 'fiscal-setup'],
    ['Envie o certificado digital A1 (.pfx) da empresa', 'fiscal-certificate'],
    ['A nota só é emitida com o pedido totalmente pago', 'fiscal-unpaid'],
    ['Nenhum agente de impressão ativo. Configure em Impressão.', 'printing-agent'],
    ['Para despachar, escolha o entregador na tela Entregas', 'order-dispatch'],
    ['Saldo insuficiente (3)', 'stock-low'],
    ['Permissão insuficiente', 'permission'],
  ];
  it.each(cases)('"%s" leva a %s', (msg, id) => {
    expect(findFixHint(msg)?.id).toBe(id);
  });

  it('não inventa caminho para erro desconhecido', () => {
    expect(findFixHint('Erro interno')).toBeNull();
    expect(findFixHint('')).toBeNull();
  });

  it('todo destino existe no app e tem botão e permissão', () => {
    const known = ['/', ...STATIC_ENTRIES.map((e) => (e.to ?? '').split(/[?#]/)[0])];
    for (const h of FIX_HINTS) {
      if (!h.to) continue;
      const path = h.to.split(/[?#]/)[0]!;
      expect(known.some((k) => k && (path === k || path.startsWith(`${k}/`)))).toBe(true);
      expect(h.label, h.id).toBeTruthy();
      expect(h.perms?.length, h.id).toBeGreaterThan(0);
    }
  });
});
