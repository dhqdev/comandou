# Financeiro: fechamento de caixa, conciliação bancária e DRE

Guia de como o financeiro do restaurante funciona por dentro (versão 0.145.0; gráficos na
0.159.0). A tela fica em **Gestão › Financeiro**, com as abas **Visão geral**, **Contas**,
**Fechamentos**, **Conciliação**, **Fluxo de caixa** e **DRE**, e os botões **Taxas e prazos** e
**Dia de início do mês** no topo.

## O caminho do dinheiro

```
Venda no PDV ──► Caixa ──fechar──► Recebíveis (finance_settlements) ──► Extrato do banco (OFX)
                                     │  taxa da maquininha                 │  conciliação
                                     │  dia previsto na conta              ▼
                                     └──────────────► DRE e fluxo ◄── bank_reconciliations
```

1. **Fechar o caixa** (`CashService.close`) chama `postCashSession` (`apps/api/src/finance/closing.ts`)
   na mesma transação: para cada forma de pagamento com venda líquida (pagamentos menos
   estornos) cria um recebível com a taxa (`fee_percent`), o valor da taxa, o líquido e a data
   prevista na conta. Dinheiro nasce já recebido (conciliação `manual`, automática). Repetir não
   duplica (`UNIQUE (tenant_id, cash_session_id, method)`).
2. **Taxas e prazos** ficam em `finance_settings.payment_terms` (JSON por forma: `feePercent` e
   `days`). Sem cadastro valem os padrões de `DEFAULT_PAYMENT_TERMS` (crédito 3,2% em 30 dias,
   débito 1,5% em 1 dia, PIX 0% na hora, vale 3,6% em 15 dias, que é o teto do PAT). Prazo que cai
   no sábado ou domingo passa para a segunda (`settlementDate`). Mudar a taxa vale para os
   próximos fechamentos.
3. Caixas fechados **antes** desta versão aparecem em Fechamentos como "Falta lançar", com o
   botão **Lançar no financeiro** (`POST /finance/closings/:sessionId/post`).

## Visão geral, gráficos e leituras do mês (0.159)

A aba **Visão geral** abre primeiro e não tem API própria: junta o que as outras abas já pedem
(`/finance/summary` do mês e do anterior, `/finance/cash-flow` dos dois, `/finance/closings`,
`/finance/dre` com o período anterior e `/finance/entries`). Arquivos em
`apps/web/src/pages/finance/`:

- `charts.tsx`: os gráficos, feitos à mão em SVG/HTML, sem biblioteca. `FlowChart` (saldo
  acumulado com previsão, ou entradas e saídas por dia), `DayBars` (uma barra por dia, com média e
  melhor dia), `HBars` (barras deitadas), `Waterfall` (cascata do DRE), `KpiStrip` (números do
  topo num quadro só), `Sparkline`, `Delta` e `Progress`. Laranja para o que entrou, cinza para o
  que saiu, tracejado para previsão e mês anterior, um eixo só e dica ao passar o dedo/mouse.
- `insights.ts`: `buildInsights` monta as **Leituras do mês** (contas vencidas, ritmo de vendas,
  ponto de equilíbrio, CMV/pessoal/prime fora da referência, despesa que mais subiu, dia da semana
  mais forte, maquininha mais cara, falta nas gavetas, dias fora do financeiro, o que vence em 7
  dias, margem). Tudo em centavos inteiros; ordem: ruim, atenção, bom, informação. Testes em
  `insights.test.ts`.
- **Previsão do saldo** (`cumulative` + `avgDailySales`): até hoje, o saldo real; depois, as contas
  a vencer de cada dia mais a venda líquida média por dia corrido (vendas − estornos − taxas dos
  dias que já passaram, contando os dias fechados).
- **Comparação com o mês anterior**: com o mês ainda correndo, entradas, saídas e saldo comparam
  com **os mesmos dias** do mês anterior (dia 1 até hoje), nunca com ele inteiro; lucro e despesas
  por grupo só comparam com o mês fechado.

## Conciliação bancária

- **Conta do banco** (`bank_accounts`) e **extrato** (`bank_statement_lines`). O OFX é lido no
  navegador (`parseOfx`, aceita SGML 1.x e XML 2.x, vírgula ou ponto) e as linhas vão para
  `POST /finance/bank/accounts/:id/import`. Cada linha tem uma chave (`statementKeys`: o FITID do
  banco ou data + valor + descrição + ordem); linha já importada é pulada.
- **Casar sozinho** (`proposeMatches`, `apps/api/src/finance/bank-match.ts`), do mais seguro para
  o menos seguro: uma linha = um recebível de mesmo valor (até 3 dias do previsto); uma linha =
  a soma dos recebíveis do mesmo dia previsto (a maquininha deposita junto); as linhas de PIX do
  dia = os recebíveis de PIX do dia; uma linha = conta já paga (5 dias) ou em aberto (10 dias,
  como sugestão de baixa). Valor quase igual (até 2% ou R$ 1, taxa diferente da cadastrada) vira
  **sugestão** para a pessoa confirmar. Roda depois de cada importação e no botão **Conciliar
  sozinho** (`POST /finance/bank/auto`).
- **Conciliar à mão** (`POST /finance/bank/reconcile`): recebíveis dos caixas, uma conta já
  lançada (baixa a conta se estava em aberto), uma conta nova criada a partir da linha (tarifa,
  compra no débito; a categoria vem sugerida pela descrição com `suggestCategory`),
  transferência entre contas ou ignorar. Sem extrato, o botão **Recebi** marca o recebível como
  recebido (`manual`).
- **Diferença**: o que caiu menos o previsto fica em `bank_reconciliations.difference` e entra
  no DRE como ajuste da taxa da maquininha.
- **Desfazer** (`DELETE /finance/bank/reconciliations/:id`) solta as linhas e os recebíveis.
  Não dá para desfazer quando a conciliação baixou ou criou uma conta (`entry_settled`): estorne
  a conta antes.

## DRE gerencial

`GET /finance/dre?from&to&basis=accrual|cash[&prevFrom&prevTo]`. Os números crus vêm de
`loadDreRaw` (`apps/api/src/finance/dre-data.ts`) e a conta é feita em `buildDre`
(`packages/shared/src/finance-plan.ts`), testada em `finance-plan.test.ts`.

| Linha | De onde vem |
| --- | --- |
| Receita bruta | Pagamentos recebidos nos pedidos, por canal, mais contas a receber (eventos, convênios) |
| Deduções | Impostos (DAS, ISS…) e estornos |
| CMV | Com ficha técnica: consumo de insumos nas vendas mais perdas (as compras viram estoque). Sem ficha: as compras de insumos do período |
| Despesas variáveis | Taxas das maquininhas (com o ajuste da conciliação), aplicativos, entregadores e marketing |
| Despesas fixas | Pessoal, ocupação, energia/água/gás/internet, administrativas |
| Resultado financeiro | Tarifas bancárias e juros, sobras e faltas de caixa |
| Abaixo do lucro | Investimentos, empréstimos e retiradas dos sócios (não são despesa do mês) |

- **Competência**: contas pelo vencimento. **Caixa**: contas pela data do pagamento.
- **Plano de contas**: cada categoria (texto livre) vai para uma linha por `dreGroupOf`, pelo
  nome exato do plano padrão ou por palavras ("Conta de luz" → energia, "DAS outubro" →
  impostos). Conta a receber de **repasse de vendas** (cartão, iFood) fica fora do DRE, com aviso,
  porque a venda já entrou pelo caixa.
- **Indicadores** (referências do setor): CMV 25% a 35%, pessoal até 30%, ocupação até 10%, CMV
  + pessoal ("prime cost") até 65%, margem líquida 10% ou mais, ponto de equilíbrio (fixas ÷
  margem de contribuição %) e ticket médio.
- **Baixar planilha**: CSV com ponto e vírgula e BOM (abre direto no Excel em português).

## Banco de dados (migração 0077)

| Tabela | O que guarda | O app pode |
| --- | --- | --- |
| `finance_settlements` | Um recebível por caixa × forma | ler, criar, mudar só `reconciliation_id` |
| `bank_accounts` | Contas do banco | ler, criar, mudar nome e ativa |
| `bank_statement_lines` | Linhas do extrato | ler, criar, apagar (sem conciliação), mudar só `reconciliation_id` |
| `bank_reconciliations` | Cada conciliação (linhas ↔ recebíveis ou conta) | ler, criar, apagar (desfazer) |

Todas com `tenant_id` e RLS. Não há ciclo de chave estrangeira entre elas (a cópia e a limpeza
de restaurante seguem a ordem das FKs).

## Assistente de IA

`financeSnapshot` (`apps/api/src/finance/finance-ai.ts`) entra no resumo que o assistente recebe
quando a pessoa tem `finance:read`: vendas e taxas do mês, recebíveis atrasados e dos próximos 7
dias, linhas do extrato para conciliar, caixas fora do financeiro e o DRE do mês com os
indicadores. O guia (`apps/api/src/chat/ai-guide.ts`) explica as telas e manda responder
dinheiro só com os números do resumo.

## Demonstração

A Fumaça Burger nasce com os caixas lançados, uma conta corrente com o extrato do ano já
conciliado e os repasses dos últimos 4 dias mais uma tarifa esperando conciliação (o botão
**Conciliar sozinho** resolve os repasses; a tarifa vira conta pela própria linha).

## Testes

- `packages/shared/src/finance-plan.test.ts`: plano de contas, taxas e prazos, DRE, OFX.
- `apps/api/src/finance/bank-match.test.ts`: regras de casar o extrato.
- `apps/api/test/backoffice.e2e.test.ts` ("o caixa fechado vai para o financeiro, concilia com o
  extrato e entra no DRE"): fechamento lança o dia, importação com linha repetida, conciliação
  sozinha e à mão, desfazer e DRE.
