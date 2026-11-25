# Aplicativos de delivery: como ligar, o que cada um faz e problemas comuns

Os pedidos do iFood, da 99Food, da Keeta, da Rappi, do aiqfome e de qualquer aplicativo que fale
o padrão Open Delivery chegam sozinhos no Comandou e seguem o caminho de sempre: PDV, cozinha,
impressão, entrega, caixa, estoque e nota. Este guia é para quem opera. O desenho técnico, fase a
fase, está no [ADR 0015](decisions/0015-canais-de-delivery.md), e a documentação de cada
aplicativo, com links, na [pesquisa](delivery-apps-pesquisa.md).

## Como funciona, em uma linha por parte

- **Duas pontas**: a equipe da plataforma cadastra as chaves do **aplicativo do Comandou** em cada
  aplicativo (Super Admin › Credenciais). Cada restaurante liga as **lojas dele** em Sistema ›
  Aplicativos de delivery e marca "Receber pedidos".
- **Chegada**: o Comandou busca os eventos a cada 30 segundos (no mínimo) e só confirma o
  recebimento ao aplicativo **depois** de gravar. A Rappi também avisa por webhook assinado.
- **Pedido**: entra uma vez só (evento repetido não duplica), com o preço que o aplicativo cobrou.
  Item sem vínculo com o cardápio entra mesmo assim e aparece para ligar depois.
- **Volta**: aceitar, recusar, em preparo, pronto, saiu e entregue no Comandou viram a chamada certa
  no aplicativo, por uma fila que tenta de novo sozinha (só em erro do aplicativo, nunca em 4xx).
- **Dinheiro**: pago no aplicativo não entra na gaveta; pago na entrega entra. O repasse vira conta
  a receber em Financeiro › Aplicativos.
- **Onde ver**: Pedidos › aba **Aplicativos** (todos juntos, com o filtro **Aplicativo** para um
  só) e Relatórios › Delivery › **Vendas por aplicativo** (pedidos, vendido, ticket, cancelados,
  taxas e líquido de cada um, com a venda própria para comparar).

## O que cada aplicativo faz no Comandou

| | iFood | 99Food | Keeta | Rappi | aiqfome | Open Delivery (outros) |
| --- | --- | --- | --- | --- | --- | --- |
| Pedidos chegam | busca a cada 30 s | busca a cada 30 s | busca a cada 30 s | busca a cada 30 s + webhook | busca a cada 30 s | busca a cada 30 s |
| Aceitar / recusar | sim / sim | sim / sim | sim / sim | sim / sim | sim / no gestor do aiqfome | sim / sim |
| Em preparo | sim | não tem | não tem | não tem | não tem | sim |
| Pronto | sim | sim | sim | sim | só na retirada | sim |
| Saiu / entregue | sim / conclui sozinho | sim / sim | sim / sim | não tem | sim / sim | sim / sim |
| Cancelar depois de aceito | sim, com motivo | sim | sim | no portal da Rappi | no gestor do aiqfome | sim |
| Pedido de cancelamento do cliente | negociação na gaveta | negociação na gaveta | reembolso na gaveta | não | não | não |
| Loja aberta, pausa e horários | sim | não | não | não | não | não |
| Entregador do aplicativo e Sob Demanda | sim | não | não | não | não | não |
| Cardápio | envio e conferência | não | não | não | não | não |
| Repasse e avaliações | sim | não | não | não | não | não |

"Não" quer dizer que o aplicativo não oferece pela API (ou que ficou para depois, como diz o ADR).
Na tela, o cartão de cada aplicativo mostra "O que funciona com ..." com a mesma lista.

## Como ligar cada um

Primeiro a equipe da plataforma salva o cartão do aplicativo em Super Admin › Credenciais (cada
cartão tem o passo a passo e os links). Depois, no restaurante:

> **Aprovação (0.248):** loja ligada só pelo código (Keeta, 99Food, Rappi, outros Open Delivery e
> iFood centralizado) aparece como "aguardando aprovação" e não faz nada (pedidos, pausa,
> avaliações, repasses, cardápio) até alguém conferir com o restaurante que ela é dele e aprovar em
> Super Admin › Aplicativos de delivery › Lojas esperando aprovação. Recusar solta a loja. aiqfome
> (ID Magalu) e iFood distribuído (código no portal) já provam o dono e entram aprovados.

- **iFood**: Cardápio › Cardápios › ligar a loja do iFood (modo centralizado: o id da loja;
  distribuído: o código do Portal do Parceiro). Ela aparece em Aplicativos de delivery.
- **99Food**: a equipe vincula a loja ao app do Comandou no portal da 99Food (o app_shop_id é o
  número da loja). No restaurante, "Ligar uma loja" com esse número.
- **Keeta**: o restaurante autoriza o Comandou no portal da Keeta e liga a loja pelo código
  numérico dela. O Comandou já faz o cadastro da loja na Keeta.
- **Rappi**: a equipe cadastra os 5 endereços de webhook na Rappi
  (`admin.<domínio>/api/v1/platform/channels/webhooks/rappi/` + `new-order`, `cancel`, `other`,
  `ping`, `store`) com o mesmo segredo do cartão. No restaurante, "Ligar uma loja" com o id da
  loja na Rappi.
- **aiqfome**: a Redirect URI do aplicativo no portal do aiqfome é
  `https://admin.<domínio>/api/v1/platform/channels/oauth/aiqfome/callback`. No restaurante,
  "Ligar uma loja" pede o código da loja e leva ao **ID Magalu**; a pessoa entra com o e-mail de
  dono da loja, escolhe a loja e volta com ela ligada.
- **Outros Open Delivery**: Super Admin › Credenciais › **Outros aplicativos Open Delivery**, com
  nome, endereço da API, Client ID e Client Secret. Em até um minuto o aplicativo ganha um cartão
  com o nome dado, e a loja liga pelo id que o aplicativo deu a ela.

Ligar a loja deixa "Receber pedidos" **desligado**: marque quando a loja estiver pronta. "Aceitar
sozinho" aceita assim que o pedido chega (sem isso, ele fica em análise na tela de Pedidos).

## Problemas comuns

| O que aparece | O que fazer |
| --- | --- |
| Cartão "Falta a credencial no Super Admin" | salve o cartão do aplicativo em Super Admin › Credenciais |
| Loja "sem autorização" | o aplicativo recusou o acesso (403 ou renovação recusada): autorize de novo no portal do aplicativo (aiqfome: ligue de novo pelo ID Magalu) |
| "Essa loja do aplicativo já está ligada a outro restaurante" | uma loja só pode estar em um restaurante; desligue no outro ou fale com o suporte |
| Pedido não chegou | veja se "Receber pedidos" está marcado, o "Último evento" do cartão e Sistema › Aplicativos de delivery no Super Admin (polling parado é alerta crítico) |
| Ação "falhou" no pedido | o aplicativo recusou (4xx, não se repete) ou ficou fora do ar (repete sozinho); "Tentar de novo" na lista de problemas do cartão |
| Item "sem vínculo" | ligue o item a um produto no fim da tela de Aplicativos de delivery; vale para os próximos pedidos |
| Recusar ou cancelar não existe no aplicativo | faça no portal ou gestor dele (Rappi depois de aceito, aiqfome sempre); o cancelamento volta para o Comandou sozinho |

Mais detalhes para a equipe técnica (logs, tabelas e o que não desligar) estão nos itens 13 a 18
da lista de incidentes em [operations.md](operations.md).

## Regras que não mudam

- Polling no mínimo a cada 30 segundos, confirmação só do que foi gravado e no máximo 10 consultas
  por pedido (o iFood bloqueia o aplicativo inteiro, de todos os restaurantes, por uso indevido).
- Chaves só em Super Admin › Credenciais, cifradas. Token de loja, cifrado no banco do restaurante.
- Webhook só com assinatura conferida sobre o corpo cru e prazo curto; sem segredo, tudo é recusado.
- Disputas e respostas a avaliações sempre escritas por uma pessoa.
- Nada pessoal do cliente no log nem na caixa de entrada.
