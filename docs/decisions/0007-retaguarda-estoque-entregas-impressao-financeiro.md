# ADR 0007 — Retaguarda: estoque, entregas, impressão, financeiro e equipe

- Status: aceita (Etapa 4)
- Data: 2026-10-22

## Contexto

A Etapa 4 adiciona operações que mexem com saldo (estoque, contas), com acesso público (rastreio),
com um programa fora do servidor (agente de impressão) e com o acesso das pessoas (equipe).
Valem as regras das etapas anteriores: RLS por restaurante, dinheiro em decimal, nada de apagar
registro financeiro, tempo real só como sinal.

## Decisão

1. **Estoque como livro-razão.** `stock_items.quantity` é o saldo e `stock_movements` (só INSERT)
   guarda cada variação com o saldo resultante. Contas em `NUMERIC` no Postgres. Constraint
   `allow_negative OR quantity >= 0` garante o "sem negativo involuntário" no banco.
2. **Baixa na criação do pedido**, na mesma transação, pela ficha técnica do produto e dos
   adicionais. Os insumos são travados por último e em ordem de id (depois de caixa → comanda →
   pedido), evitando deadlock. Sem saldo: 409 e nada é gravado. Cancelamento gera
   `sale_reversal` (idempotente: devolve só o que ainda não voltou).
3. **"Saiu para entrega" só pela entrega** (`POST /orders/:id/dispatch`), que registra o
   entregador e gera o link de rastreio. Só o SHA-256 do token fica no banco; o link expira
   (4 h na rua; 30 min após encerrar). A página pública mostra número, situação, primeiro nome do
   entregador e a última posição; nunca endereço ou telefone.
4. **Impressão por fila no banco + agente que busca** (pull). Nada de porta aberta no
   restaurante. Reserva com `FOR UPDATE SKIP LOCKED`, prazo de 60 s e até 5 tentativas;
   `dedupe_key` única impede comanda duplicada. Sem agente ativo, nada é enfileirado e o pedido
   segue normal. O agente se autentica por token próprio (hash no banco), sempre no host do
   restaurante.
5. **Financeiro**: valor e vencimento de um lançamento não mudam (GRANT só nas colunas de baixa e
   cancelamento). Baixa exige `Idempotency-Key`. Pago não se cancela. Conciliação é registro
   imutável, com diferença calculada no servidor e explicação obrigatória.
6. **Equipe**: a conta (e-mail/senha) é global; o vínculo é por restaurante. Criação via função
   `SECURITY DEFINER` estreita que usa o restaurante do contexto. E-mail já existente só ganha o
   vínculo; a senha dele não muda. Alterações em administradores travam todos os administradores
   antes, para nunca zerar.

## Consequências

- A venda pode ser recusada por falta de insumo; o restaurante escolhe por insumo se aceita
  negativo.
- Rastreio ao vivo depende de o entregador enviar a posição pelo celular (sem GPS contínuo
  nesta etapa).
- O agente precisa de Node.js 22 no computador do restaurante; empacotar como executável fica
  para depois.
