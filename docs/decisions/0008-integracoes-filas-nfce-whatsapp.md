# ADR 0008 — Integrações: filas, NFC-e (Focus NFe) e WhatsApp

- Status: aceita (Etapa 5)
- Data: 2026-10-22

## Contexto

A Etapa 5 liga o Comandou a serviços de fora: a Focus NFe (nota fiscal ao consumidor, NFC-e) e o
WhatsApp (avisos ao cliente). Essas chamadas podem demorar, falhar ou ficar sem resposta, e não
podem travar o pedido nem duplicar uma nota. Valem as regras anteriores: RLS por restaurante,
dinheiro em decimal, nada de apagar registro fiscal ou financeiro, evento em tempo real só como sinal.

## Decisão

1. **Fila = transporte; Postgres = verdade.** BullMQ sobre o Redis. Todo trabalho leva só
   `{tenantId, <id do registro>}`; `tenantId` é validado como UUID ao enfileirar e ao consumir, e o
   consumidor relê o registro com `withTenant` (RLS) antes de agir. Se o registro não existir naquele
   restaurante, nada acontece. Sem `REDIS_URL` (desenvolvimento), a mesma interface executa no
   processo, com as mesmas tentativas. `QUEUE_WORKERS=false` permite réplica só de HTTP.
2. **NFC-e pela Focus NFe, homologação primeiro.** O pedido de emissão grava o documento
   (`fiscal_documents`, status `pending`) com o conteúdo congelado e só depois enfileira. A
   referência enviada é fixa por documento (`pm-<id>`), então reenviar nunca gera duas notas; uma
   resposta de erro sem status é conferida consultando a referência. Falha de rede: tenta de novo;
   esgotadas as tentativas, a nota vai para "processando" e a consulta decide (nunca reemitir às
   cegas). Índice único parcial: no máximo uma nota viva por pedido.
3. **Conteúdo da nota a partir do banco.** Itens não cancelados com preço do pedido; desconto e
   acréscimos (taxa de serviço, entrega) rateados pelos itens sem perder centavo (`allocateCents`);
   pagamentos líquidos de estornos agrupados por forma; só pedido totalmente pago; NCM do produto
   ou padrão do restaurante, senão 422 listando os produtos. A data de emissão é a do envio.
4. **Pedido com nota viva não é cancelado nem estornado.** Primeiro cancela-se a NFC-e
   (justificativa de 15 a 255 caracteres, prazo da SEFAZ), depois o pedido.
5. **Produção só pelo dono e com confirmação explícita.** A troca para produção exige o papel
   `owner` e `confirmProduction: true`.
6. **Credenciais cifradas.** Tokens da Focus NFe e da Meta são guardados com AES-256-GCM
   (`INTEGRATIONS_KEY`, fora do banco, via Docker secret), com o id do restaurante como dado
   autenticado: um token copiado para outro restaurante não decifra. A API nunca devolve o token,
   só os 4 últimos caracteres; a auditoria registra apenas "token alterado".
7. **WhatsApp por QR Code (Baileys) como padrão, escolhido pelo dono do produto.** Roda num
   serviço separado (`apps/whatsapp-gateway`), uma réplica, sem porta publicada; só a API fala com
   ele, com token interno, e o restaurante vai na URL a partir do Host resolvido pela API. A sessão
   de cada restaurante (credenciais e chaves Signal) fica em disco cifrada com AES-256-GCM
   (`SESSION_KEY`), nome de arquivo em hash e o restaurante como dado autenticado: copiar a pasta
   para outro restaurante não funciona. "Desconectado no celular" apaga a sessão e pede novo QR.
   **Risco aceito:** cliente não oficial; o número pode ser bloqueado pelo WhatsApp. A tela avisa e
   recomenda número só para avisos. A **API oficial da Meta** fica como alternativa por restaurante
   (modelos aprovados com três variáveis: cliente, pedido, restaurante; token cifrado com
   `INTEGRATIONS_KEY`). Baileys é MIT (versão estável 6.7.24).
8. **Aviso ao cliente na mesma transação.** "Pronto" (retirada/balcão) e "saiu para entrega"
   (delivery) gravam a mensagem em `message_outbox` dentro da transação da mudança de status. Se a
   transação for desfeita, o consumidor não encontra a mensagem e não envia. Índice único por
   pedido e aviso: reabrir e marcar pronto de novo não repete a mensagem. Telefone inválido ou
   aviso desligado: nada é gravado e o pedido segue normal.
9. **Grants por coluna.** A aplicação não altera o conteúdo enviado (payload, total, referência,
   destinatário, modelo) nem apaga documentos fiscais ou mensagens; só atualiza status e retorno.

## Consequências

- Precisa de Redis em produção (já previsto na stack) e do secret `comandou_integrations_key`.
- Perder `INTEGRATIONS_KEY` exige recadastrar os tokens (os dados fiscais continuam íntegros).
- Ainda a validar em homologação real com a Focus NFe: o campo de outras despesas
  (`valor_outras_despesas`) para taxa de serviço e entrega, e se a SEFAZ do estado exige dados
  extras de cartão nas formas de pagamento.
- A conexão real com o WhatsApp (QR Code e envio) não foi exercida nos testes automatizados: o
  ambiente de CI não alcança os servidores do WhatsApp. Os testes cobrem a sessão cifrada, a API
  interna do gateway com um socket falso e a API do Comandou com um gateway falso. A primeira
  leitura de QR Code deve ser feita em homologação com um número de teste.
- O link de rastreio não vai no WhatsApp: guardar o token em claro na mensagem enfraqueceria a
  proteção do rastreio (só o hash fica no banco).
