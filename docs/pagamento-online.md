# Pagamento pelo app (PagBank)

O cliente do restaurante paga o pedido do cardápio online com **cartão de crédito** ou **Pix
automático**, direto no celular. O dinheiro cai na conta PagBank **do restaurante**; a Comandou
recebe só a sua taxa, separada na hora pelo próprio PagBank (split de pagamento). A Comandou nunca
fica com o dinheiro do restaurante.

Decisão: [ADR 0013](decisions/0013-pagamento-online-pagbank-split.md).

## A regra

1. **Sem PagBank conectado, nada muda.** O cardápio continua com o Pix com comprovante (quando a
   chave Pix está ligada) e com dinheiro, cartão e voucher pagos na entrega ou na retirada.
2. **Conectado, o restaurante escolhe o que aceita pelo app:** cartão de crédito, Pix automático
   ou os dois (Loja online → Pagamentos). Com o Pix automático ligado, a entrega e a retirada usam
   o Pix do PagBank (QR Code com o valor, confirmado sozinho) no lugar do Pix com comprovante. Na
   mesa, o pedido continua com o Pix com comprovante ou pago no fim; a **conta inteira da mesa**
   (aba Garçom › Fechar a conta) também pode ser paga pelo PagBank (veja "Conta da mesa").
3. **Pagar o pedido pelo app pede a conta do cliente aberta**, como o Pix com comprovante: o
   pagamento fica ligado a quem pagou, e o PagBank pede nome, e-mail e CPF do comprador. A conta da
   mesa é a exceção: veja abaixo.
4. **O pedido espera o pagamento.** Pedido pago pelo app nasce "em análise" e não vai para a
   cozinha antes de pago. Pagou: com o aceite automático ligado ele é aceito na hora; sem o aceite
   automático, a equipe aceita como sempre (já pago).
5. **Cartão recusado:** o cliente vê o motivo e pode tentar outro cartão, até **3 tentativas** por
   pedido. Também pode trocar para Pix (se a loja aceita) ou cancelar o pedido.
6. **Não pagou em 20 minutos, cancela sozinho** com o motivo "Pagamento não concluído" (o Pix do
   PagBank vence nesse mesmo prazo). Nada foi cobrado, nada é devolvido.
7. **O pagamento entra no caixa sozinho**, como crédito ou Pix, no caixa escolhido em Loja online
   → Pagamentos (ou, sem escolha, no caixa aberto há mais tempo). Sem caixa aberto, o pedido fica
   "Pago pelo app, falta lançar no caixa" e entra assim que um caixa abrir. A equipe também pode
   lançar na hora, pelo pedido.
8. **Devolver é estornar.** Para cancelar um pedido pago pelo app, estorne o pagamento no pedido
   (como qualquer pagamento): o estorno vai ao PagBank e o valor volta no cartão ou no Pix do
   cliente. Se o PagBank recusar, nada é estornado aqui. Pedido pago que é cancelado antes de o
   pagamento entrar no caixa é devolvido sozinho pelo PagBank.
9. **Depois de pagar, o cliente não cancela pelo app**: fala com a loja (que estorna).

## Conta da mesa (0.236)

O cliente sentado fecha a conta inteira da mesa pelo cardápio do QR Code (`/pedir/mesa/conta`):
todos os pedidos da comanda, inclusive os do garçom e de outros celulares.

1. **Formas que a loja liberou.** Com o PagBank conectado: Pix automático (no lugar do Pix com
   comprovante, como no cardápio online) e/ou cartão de crédito, conforme Loja online →
   Pagamentos. Sem PagBank, segue o Pix da loja com comprovante. Sempre dá para chamar o garçom.
2. **Sem conta do cliente.** Na mesa ninguém entra em conta: a tela pede nome (Pix), CPF e e-mail
   de quem paga, que vão só para o PagBank (o pedido pela mesa já pede o CPF; a tela preenche
   com o que o cliente digitou). O PagBank recebe sem telefone.
3. **O valor é o saldo de agora.** O celular manda o valor que mostrou; se a conta mudou (o garçom
   lançou mais, um item foi cancelado), nada é cobrado e a tela mostra o valor novo. Pedido do
   celular esperando a loja aceitar, Pix de pedido ou comprovante da mesa com o caixa travam o
   pagamento até resolver.
4. **Enquanto o PagBank espera, ninguém cobra a comanda de outro jeito** (caixa, garçom, pedido
   avulso, comprovante). O Pix da mesa vale **10 minutos**; o cliente pode tocar em "Pagar de
   outro jeito" (ou em "Pagar com o garçom"), e o Pix deixa de valer na hora.
5. **Pago, entra no caixa sozinho** (o caixa escolhido em Pagamentos ou o aberto há mais tempo),
   como Pix ou crédito, dividido nos pedidos da comanda do mais antigo ao mais novo (um pagamento
   por pedido, ligados à cobrança em `online_charge_payments`). Pedido já entregue e agora pago
   conclui; sem nada em preparo, a mesa fica livre. Sem caixa aberto, a conta aparece paga para o
   cliente, a comanda fica travada ("já pagou pelo PagBank") e o valor entra quando um caixa
   abrir (ou pelo "Lançar no caixa" no detalhe de qualquer pedido da mesa).
6. **Devoluções sozinhas:** comanda fechada ou paga de outro jeito quando o pagamento chega (Pix
   antigo pago depois, aviso atrasado do PagBank) volta inteiro; item cancelado enquanto o cliente
   pagava faz entrar só o saldo, e a sobra volta pelo PagBank (`applied` e `excess_refunded_at`).
   Estornar no caixa um dos pagamentos da conta vai ao PagBank antes, só com aquele valor.
7. A cobrança da comanda é a mesma `online_charges`, com `tab_id` no lugar de `order_id`; aviso,
   conferência, varredura, taxa da Comandou e relatório do Super Admin valem igual.

## A taxa da Comandou

- Cada pagamento aprovado leva a **taxa da Comandou**: um percentual do total (padrão definido no
  Super Admin) mais um valor fixo opcional por pagamento. O Super Admin pode dar outra taxa a um
  restaurante.
- A conta é feita em centavos, arredondando metade para o par, e nunca passa de 50% do pagamento.
  Taxa que daria zero centavo não gera split (o pagamento vai inteiro para o restaurante).
- O PagBank divide na hora: o restaurante recebe `total − taxa` e a Comandou recebe a taxa. A taxa
  do PagBank e os chargebacks ficam com o restaurante, que é o vendedor principal.
- No estorno, o PagBank devolve o valor dividido na mesma proporção: a taxa da Comandou sobre o
  valor devolvido também volta para o cliente.
- O valor da taxa fica gravado em cada pagamento. O restaurante vê a taxa vigente em Loja online →
  Pagamentos; o Super Admin vê quanto rendeu por restaurante e por mês.

## Conectar a conta do restaurante

1. O administrador (dono) do restaurante abre Loja online → Pagamentos e toca em **Conectar
   PagBank**.
2. O navegador vai para a página do PagBank (Connect), onde ele entra na conta dele, ou cria uma, e
   autoriza a Comandou a criar e estornar cobranças.
3. O PagBank volta para `admin.<domínio>/api/v1/pagbank/connect/callback`, que manda o navegador
   de volta para o endereço do restaurante. Lá a API confere o `state` (uso único, 10 minutos,
   ligado ao restaurante e a quem começou), troca o código pelos tokens e cria a chave pública de
   cartão da conta.
4. Os tokens ficam **cifrados** com a `INTEGRATIONS_KEY` no banco do restaurante e nunca voltam
   ao navegador. O token é renovado sozinho antes de vencer.
5. **Desconectar** apaga os tokens e desliga o pagamento pelo app na hora (o cardápio volta à
   regra 1). Pagamentos já feitos continuam no pedido e podem ser estornados enquanto o PagBank
   aceitar, reconectando.

## Configuração no Super Admin (Credenciais e Pagamentos pelo app)

Os passos 2, 3 e 5 (token, aplicação, conta recebedora e ambiente) ficam em **Super Admin →
Credenciais → PagBank**; a taxa e o liga e desliga, em **Pagamentos pelo app**.

1. No PagBank: peça ao comercial a **liberação do split de pagamento** para a sua conta.
2. Crie a **aplicação** do Connect: em Credenciais, cole o token da sua conta PagBank e toque em
   **Criar aplicação no PagBank** (ou cole `client_id` e `client_secret` de uma aplicação que você
   já tem). O endereço de retorno é `https://admin.<domínio>/api/v1/pagbank/connect/callback`.
3. Informe o **ID da conta recebedora** da Comandou (`ACCO_...`): é para ela que vai a taxa.
4. Defina a **taxa padrão** (percentual e fixo) e ligue o pagamento pelo app. Desligado aqui, nenhum
   restaurante vê a opção, mesmo conectado.
5. Ambiente **sandbox** ou **produção**. Trocar o ambiente desconecta, na prática, quem foi
   conectado no outro (cada conexão guarda o ambiente em que foi feita).

## Como funciona por dentro

- **Cartão:** o cardápio carrega o SDK do PagBank e cifra o cartão no celular com a chave pública
  da conta do restaurante (`PagSeguro.encryptCard`). Só o cartão cifrado chega à API; número e
  código de segurança nunca passam pelo servidor nem vão para log.
- **Cobrança:** `POST /orders` no PagBank com o token do restaurante, uma cobrança por tentativa,
  `reference_id` = id da cobrança no Comandou e `splits` com os dois recebedores (método `FIXED`).
  Cada tentativa é gravada antes de chamar o PagBank; resposta perdida é consultada depois.
- **Sem resposta do PagBank (0.198.2):** o envio é repetido uma vez, na hora, com o mesmo
  `x-idempotency-key` (o id da tentativa), e o PagBank devolve o pedido que já tinha criado. Se
  continuar sem resposta, outro cartão fica bloqueado enquanto o pedido está aberto (só o Pix
  passa), para não cobrar duas vezes; o aviso do PagBank decide a tentativa depois.
- **Tentativa vencida que foi paga (0.198.1):** Pix trocado por outra forma, ou cartão que o
  PagBank aprovou depois, entra como pago ou vira `refund_due` se o pedido já foi pago ou
  cancelado. A conferência consulta o Pix trocado por mais 10 minutos depois do vencimento.
- **Aviso do PagBank:** `notification_urls` aponta para
  `<endereço do restaurante>/api/v1/store/pagbank/notify`. A API **não confia no corpo**: pega o id
  do pedido do PagBank e consulta a situação real com o token do restaurante.
- **Sem depender só do aviso:** a cada minuto, uma réplica por vez confere as cobranças pendentes
  há mais de 1 minuto, cancela os pedidos sem pagamento há 20 minutos, lança no caixa os pagos sem
  caixa e devolve os pagos de pedidos cancelados.
- **Situações da cobrança:** `pending` (criada, esperando), `paid`, `declined` (recusada),
  `expired` (Pix vencido ou pedido cancelado sem pagar), `refund_due` (pedido cancelado com o
  pagamento fora do caixa, a devolver), `refunded` (devolvido inteiro).
- Tudo vai para a auditoria do restaurante (`online_pay.*`) e do painel (`platform.online_pay.*`).

## Ainda não

- **Débito pelo app:** exige a autenticação 3DS do banco do cliente. Entra depois de testada no
  sandbox.
- **Voucher (VR, VA):** as bandeiras de refeição não passam no PagBank pela internet; continuam na
  maquininha.
- **Parcelamento:** só à vista nesta primeira versão.
