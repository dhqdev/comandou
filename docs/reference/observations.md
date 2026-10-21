# Observações do sistema de referência

Fonte: 11 capturas de tela enviadas pelo dono em 2026-10-21 (PedidoJá v1.31.0 "DEV" e Anota AI).
Nenhum acesso direto foi feito. Usamos apenas **fluxos e conceitos**; identidade visual, textos de marketing e imagens **não** são copiados.

## Navegação (PedidoJá)

Barra lateral: PDV · Mesas · Pedidos · Caixa · Entregas · Cardápio ▾ · Clientes · Fornecedores · Estoque ▾ · Fiscal ▾ · Dashboard · Relatórios · Insights · Avisos · WhatsApp (status) · Configurações ▾ · Sair.
Topo: busca global ("mesa, comanda, pedido ou cliente"), chave **Loja aberta/fechada**, impressão (status do agente), notificações.

Configurações observadas: Cadastro da empresa, Empresa, Aparência, Ponto de Venda, Formas de Pagamento, Notas e Moedas, Usuários, Cozinhas (KDS), Bairros, Áreas de Entrega.

## Fluxos e regras observados

### PDV (home)
- Painel **Salão**: comandas abertas, busca por comanda/mesa, ordenação.
- Painel **Pedidos** em kanban: `Novo` → `Em produção` → `Prontos` → `Saiu / Entregue`; contadores de `Concluído`, `Cancelado`, `Cancelamento Solicitado`.
- Opções: **Aceite automático**, modo Compacto/Completo, filtro por tipo, Agendados.
- Atalhos de teclado: **Nova Venda (F2)**, **Fechar Conta (F4)**.

→ No PedeMais: estados de pedido `new, in_production, ready, dispatched, completed, cancel_requested, cancelled` já existem na migração 0002. Atalhos de teclado entram na Etapa 3.

### Pedidos (lista e detalhe)
- Filtros: período (de/até), Status Operacional, Status Financeiro, Tipo (Delivery, Retirada…), número.
- Detalhe: cliente, telefone, data de entrega, endereço, **status do pedido** e **status do pagamento** separados (ex.: Concluído / Pago), observação do pedido, itens com status por item (ex.: Pendente), pagamentos (ex.: Venda · PIX · data · valor), subtotal, taxa de entrega, total. Ações: Cancelar pedido, Imprimir pedido.

→ Regra adotada: **status operacional e status financeiro são independentes**. Pedido criado ≠ pagamento recebido.

### Caixa
- Cabeçalho: "Aberto em <data> por <usuário>", escopo **Este terminal / Todos os caixas**, ações **Suprimento**, **Sangria**, **Fechar Caixa**.
- Indicadores: Total vendido desde a abertura, Frete arrecadado, Movimentado no caixa, Contas fechadas, Suprimentos, Sangrias.
- **Linha do tempo do caixa**: primeira linha é o valor de abertura em dinheiro (evento Suprimento, origem Abertura, referência CX-xxxxx). Colunas: data/hora, evento, origem, referência, frete, desconto, dinheiro, cartão de crédito, cartão de débito, PIX, NFC-e (botão "Emitir NFC-e" por venda).

→ Modelo para Etapa 3: `cash_sessions` por terminal + `cash_movements` imutáveis (abertura, venda, suprimento, sangria, estorno) com valores por forma de pagamento; fechamento compara esperado × informado.

### Cozinhas (KDS) e impressão
- Cada cozinha (ex.: Bar, KDS-000002) tem título, **tipos exibidos** (Delivery, Mesa, Balcão), **Avisar após (min)**, **Atrasar após (min)**, tema e layout (Lista).
- Agente local de impressão com versão, último sinal ("Sem sinal há 70 h"), botão de atualização, e impressoras por setor (Caixa, Bar, Cozinha) com teste.

→ Setores de produção com SLA de aviso/atraso; agente de impressão com heartbeat. Aceite do agente ≠ impresso.

### Clientes
- Lista com busca por nome/telefone/documento, ordenação, contador e "Novo cliente".

### Dashboard
- Cards: Produtos mais vendidos, Pedidos por hora (lançamento), Vendas por funcionário, Entregas por motoboy, com "Ver relatório" e estado vazio "Sem dados no período".

## Anota AI (conceitos)

- Kanban `Em análise` → `Em produção` → `Prontos para entrega`, com "Aceitar pedidos automaticamente", tempo por pedido, forma de pagamento e troco, botões **NF** e **Finalizar pedido**.
- Gestor de cardápio: categorias com arrastar para ordenar, itens com foto, preço, chave **Esgotar** por item e por categoria, link de compartilhamento.
- Cardápio digital com link público e QR Code para redes sociais.
- Marketing: cashback, cupom, recuperador de vendas (fora do escopo inicial).

→ Já implementado no PedeMais: categorias e produtos com **Esgotar/Reativar** confirmados pelo servidor.

## Pendente de validação (requer acesso ao sistema)

- Regras exatas de transição de estados e quem pode cancelar.
- Divisão de contas, transferência de mesa, taxa de serviço.
- Como o estoque é baixado (na venda ou na produção).
- Campos fiscais (NCM, CFOP, CSOSN) no cadastro de produto.
- Regras de entrega por bairro/área e cálculo de frete.
