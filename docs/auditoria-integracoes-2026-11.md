# Auditoria das integrações e da nota fiscal (0.197.1)

Revisão feita em 19/11/2026 sobre a versão 0.197.0: leitura do código de cada integração, conferência
contra a documentação dos parceiros onde havia dúvida, e os testes de ponta a ponta rodando com
Postgres e Redis de verdade (a fila fiscal passa pelo BullMQ, como em produção). Cada falha corrigida
ganhou um teste que **falhava antes da correção** e passa depois.

## O que foi revisado

| Integração | Onde | Resultado |
| --- | --- | --- |
| Nota fiscal (Focus NFe): NFC-e, NF-e, cancelamento, contingência, inutilização, carta de correção, notas recebidas, cadastro da empresa | `apps/api/src/fiscal/` | 3 correções (C2, C4, C5); 4 pontos em aberto |
| Pagamento pelo app (PagBank: cartão e Pix, split, estorno, aviso) | `apps/api/src/online-pay/` | 1 correção (C1); 1 ponto em aberto |
| Cobrança da assinatura (Asaas) | `apps/api/src/billing/` | Sem falhas encontradas |
| Aplicativos de delivery (iFood, Keeta, 99Food, Rappi, aiqfome, Open Delivery) | `apps/api/src/integrations/` | 1 correção (C3); 1 ponto em aberto |

## Falhas corrigidas

| # | Gravidade | O que acontecia | Onde | Correção e teste |
| --- | --- | --- | --- | --- |
| C1 | **Alta** | **Pix pago depois de trocar de forma era ignorado.** O cliente gerava o Pix, trocava para o cartão (o Comandou marcava o Pix como vencido, mas o QR Code continuava valendo no banco) e pagava o Pix também. O aviso do PagBank chegava e era descartado porque a tentativa não estava mais "esperando". O dinheiro entrava no PagBank e não aparecia no Comandou nem era devolvido. O mesmo valia para o cartão que o PagBank aprovava depois de o Comandou desistir de esperar. | `online-pay.service.ts`, `applyOrderIn` | A tentativa vencida que o PagBank diz que foi paga passa pelo caminho normal do "pago": entra no pedido, ou vira "a devolver" se o pedido já foi pago por outra tentativa ou cancelado, e a conferência devolve sozinha. A conferência do ciclo também consulta esse Pix por 10 minutos depois do vencimento, caso o aviso se perca. Testes em `online-pay.e2e.test.ts`. |
| C2 | Média | **Nota parada em "processando" ou "cancelando".** As consultas à Focus entravam na fila com um nome fixo por nota. O BullMQ guarda os últimos 1000 trabalhos terminados e descarta, sem avisar, um trabalho novo com o mesmo nome. A NF-e é sempre assíncrona, então toda NF-e recusada e emitida de novo ficava em "processando" até alguém tocar em Atualizar. O cancelamento com a Focus fora do ar e a contingência emitida de novo tinham o mesmo problema. | `fiscal.service.ts`, `enqueue` | Só o primeiro envio da nota mantém o nome fixo (é ele que impede mandar a mesma nota duas vezes). As consultas ganham um nome novo a cada vez, e repetir uma consulta não faz mal. Teste em `fiscal.e2e.test.ts` (recusada na consulta e reemitida). |
| C3 | Média | **Pedir o cancelamento de novo ao aplicativo não chegava.** Depois que o iFood (ou outro aplicativo) negava o pedido de cancelamento, pedir de novo mudava o pedido para "Cancelamento solicitado" no Comandou, mas a caixa de saída descartava o envio por ter a mesma chave do primeiro. O pedido ficava parado e o aplicativo seguia com ele ativo. | `channel-outbox.service.ts` | A chave do pedido de cancelamento leva a versão do pedido, então cada novo pedido é outro envio. Teste em `ifood-orders.e2e.test.ts`. |
| C4 | Média | **Nota de homologação reaproveitada em produção.** A nota guarda o ambiente em que foi montada. Uma NFC-e recusada em homologação e emitida de novo depois de o restaurante passar para produção saía em homologação, sem valor fiscal, e aparecia como autorizada. | `fiscal.service.ts`, `request` e `reissue` | A NFC-e só reaproveita nota do ambiente atual; senão sai uma nota nova. A reemissão de NF-e de outro ambiente é recusada com a explicação: apague o rascunho e emita outra. |
| C5 | Baixa | **Cupom impresso duas vezes.** Tocar em Atualizar enquanto a nota ainda estava sendo enviada criava um segundo envio. Os dois recebiam "autorizada" e cada um imprimia o cupom, mandava o e-mail ao cliente e gravava o histórico. | `fiscal.service.ts`, `setDoc` e `apply` | A gravação da autorização só vale se a nota ainda está "pendente" ou "processando". Quem chega depois não repete impressão, e-mail nem histórico. Teste em `fiscal.e2e.test.ts`. |

## Pontos em aberto (recomendações, sem mudança no código)

| # | Gravidade | Ponto | Recomendação |
| --- | --- | --- | --- |
| A1 | Média | **Cartão sem resposta do PagBank.** Se o PagBank não responde a tempo (20 s), a tentativa fica sem o número do PagBank. Depois de 2 minutos o cliente pode tentar de novo, e se a primeira cobrança tiver passado ele paga duas vezes. Com a C1, a primeira agora é achada quando o aviso do PagBank chega e vira "a devolver". Sem o aviso, ela só aparece no log do servidor. | Antes de liberar a nova tentativa, repetir o mesmo envio com a mesma chave de idempotência (o `x-idempotency-key` já é o id da tentativa): o PagBank devolve o pedido que criou, sem cobrar de novo. Mostrar essa situação na tela da equipe em vez de só no log. |
| A2 | Média | **NFC-e de entrega pede CPF e endereço** (rejeição 787). O Comandou confere isso antes de enviar, o que está certo. Mas pedidos do iFood e de outros aplicativos quase sempre chegam sem CPF, então a emissão automática deixa essas notas em "erro" até alguém preencher o CPF. Alguns estados nem aceitam NFC-e com entrega a domicílio (rejeição 785). | Decidir com a contabilidade: pedir CPF na nota no aplicativo, emitir NF-e nesses casos, ou outra saída que o estado aceite. |
| A3 | Baixa | **Cancelar nota autorizada** pede só a permissão de emitir, então qualquer caixa cancela. Fica registrado no histórico. | Avaliar exigir a permissão de gerenciar o fiscal (gerente ou dono) para cancelar. |
| A4 | Baixa | **Cadastro da empresa na Focus (modo revenda).** Se a Focus cria a empresa e a resposta se perde, o próximo Salvar tenta criar de novo e a Focus recusa porque o CNPJ já existe. Não há botão para achar a empresa que já está lá. | Antes de criar, procurar a empresa pelo CNPJ na conta da Focus e ligar a que existir. |
| A5 | Baixa | **NFC-e só com o nome do cliente, sem CPF**, manda o nome do destinatário sem documento. Pelo leiaute da SEFAZ, o grupo do destinatário pede CPF ou CNPJ. Não foi possível confirmar se a Focus omite o grupo nesse caso. | Testar uma NFC-e de balcão com nome e sem CPF em homologação. Se recusar, mandar o nome só quando houver CPF ou CNPJ. |
| A6 | Baixa | **Nota parada sem a fila.** Se o trabalho da fila se perder (Redis apagado), a nota fica "pendente" ou "processando" até alguém tocar em Atualizar, porque não há varredura que retome notas paradas. A consulta automática de uma nota em processamento dura cerca de 4 minutos, e não os 8 que o comentário do código diz. | Uma varredura a cada poucos minutos que reenfileire notas paradas há mais de 10 minutos. |
| A7 | Baixa | **Tempo limite das chamadas aos aplicativos** (`channel-http.ts`) cobre a resposta, mas não a leitura do corpo. Um aplicativo que responde devagar pode segurar a rodada. | Manter o mesmo `AbortController` ativo até terminar de ler o corpo. |
| A8 | Info | Pendências fiscais já listadas no [guia fiscal](fiscal-guia.md): CNPJ dos outros aplicativos como intermediador, DIFAL, Pix estático, crédito do Simples e taxa de serviço na base do ICMS. | Seguem com a contabilidade. |

## Conferido e certo

- **Focus NFe:** referência fixa por nota; queda da Focus vira consulta e nunca reemissão às cegas; 401 e 403 explicados; contingência offline com duas vias, sem cancelamento antes da hora e desligada em SC; nota denegada não é reemitida; travas de CFOP, CST/CSOSN, CEST e IBS/CBS antes de enviar; intermediador só no iFood. Nos pedidos sem intermediador, a Focus preenche sozinha o indicador "sem intermediador" (conferido na documentação da Focus da NT 2020.006), então a rejeição 434 não acontece.
- **Tokens e certificado:** tokens da Focus cifrados por restaurante e por ambiente, nunca devolvidos à tela nem gravados no histórico. Certificado, senha e CSC vão direto para a Focus.
- **PagBank:** o aviso só diz qual pedido mudou e a situação vem sempre da consulta (aviso falso dizendo "pago" não muda nada, e isso tem teste). Split com a taxa do Comandou, estorno no PagBank antes do estorno no caixa, devolução automática de pedido cancelado e cancelamento sozinho em 20 minutos.
- **Asaas:** token do webhook comparado em tempo constante; cada evento entra uma vez; a situação vem da consulta; baixa manual protegida; estorno tira os dias liberados; conferência no ciclo pega o aviso perdido.
- **Aplicativos de delivery:** ack só depois de gravar na caixa de entrada; no máximo 10 consultas por pedido; polling de 30 s com trava entre réplicas; caixa de saída em ordem por pedido, sem duplicar e com repetição só em 5xx e 429; varredura a cada 20 s; webhook da Rappi com assinatura sobre o corpo cru e prazo; volta do aiqfome com state de uso único guardado no servidor (sem redirecionamento aberto).

## Testes rodados

Com Postgres 16 e Redis (fila real):

- `fiscal.e2e.test.ts`: 41 testes, incluindo os 2 novos.
- `online-pay.e2e.test.ts`: 17 testes, incluindo os 2 novos.
- `ifood-orders`, `channels`, `keeta`, `food99`, `rappi`, `aiqfome`, `custom-od`, `ifood`, `billing` e `channel-usage`: 137 testes, incluindo o novo.
- Testes de unidade de `src/fiscal`, `src/integrations` e `src/online-pay`: 88 testes.

Os novos testes foram rodados também sem a correção, para confirmar que pegavam a falha: C2 parava em "processando", C1 deixava o Pix pago como "vencido" e C3 não chegava ao iFood.
