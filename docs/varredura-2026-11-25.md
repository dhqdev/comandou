# Varredura do sistema (25/11/2026, versão 0.245.3)

Revisão de ponta a ponta: API (todos os módulos, menos Super Admin, WhatsApp do painel, migrador
e servidores, que têm revisão própria), telas da equipe, app do garçom, entregador, cozinha,
cardápio do cliente, acompanhamento, pagamento e site. Cada achado foi conferido no código antes
de entrar aqui.

## Corrigido nesta versão

| Onde | O que acontecia | O que mudou |
| --- | --- | --- |
| `cash/cash.service.ts` (`assertNoOrderOnlinePending`), `tables/tabs.service.ts` | O caixa recebia no balcão um pedido com Pix/cartão do PagBank esperando ou pago e ainda fora do caixa. O cliente pagava duas vezes e a cobrança do app ficava `paid` sem lançamento, sem devolução. | Receber pelo caixa, pela comanda ou no acerto da entrega é recusado (409) com o motivo, como já era na conta da mesa. |
| `tables/tabs.service.ts` (`setServiceFee`) | Ligar/tirar a taxa da mesa recalculava pedidos concluídos e pagos, fiado/a receber e retirada. | Só pedidos em aberto (não retirada) entram. |
| `delivery/delivery.service.ts` (`complete`) | Código errado contava numa transação separada: toques juntos davam ~30 tentativas no código de 4 dígitos. | O erro conta na mesma transação, com a entrega travada. |
| `loyalty/loyalty.service.ts` (`expireIn`) | Dois vencimentos juntos zeravam o saldo duas vezes (saldo negativo). | Trava consultiva por restaurante antes do vencimento. |
| `store-chat/store-chat.service.ts` (`saveFile`) | Visitante abrindo conversas novas apagava anexos de todas as conversas (o limite do restaurante tirava os mais antigos). | Envio do cliente só tira arquivos com mais de 30 dias, recusa se não couber e tem limite diário somando todas as conversas; trava por restaurante. |
| `auth/session.service.ts` + `auth.guards.ts` | Tablet ou socket aberto contava dia de trabalho todo dia (diárias infladas). | Conta no login e quando a pessoa grava algo (uma vez por hora). |
| `audit/audit.service.ts` + `common/request-context.ts` | Ações no acesso de suporte entravam no histórico como se fossem do dono. | Toda linha do histórico feita no suporte leva `support: <nome do Super Admin>`. |
| `common/log-redact.ts` | Tokens de acompanhamento, reserva, assinatura e teste grátis iam inteiros para o log. | Mascarados (`[oculto]`), com teste. |
| `reservations/reservations.service.ts` | IA do WhatsApp não achava/cancelava reserva quando o número vinha sem o 9; limite de 3 reservas só por telefone digitado. | Compara DDD + 8 últimos dígitos; limite vale também por conta. |
| `kitchen/kitchen.service.ts` | Resposta e evento levavam a situação do pedido de antes da mudança. | Lê de novo depois de `afterItemChange`. |
| `integrations/channels/channel-poller.service.ts` | Um aplicativo lento travava o polling de todos (iFood exige 30 s). | Cada credencial roda sozinha; a ocupada fica de fora da rodada seguinte. |
| `integrations/ifood/ifood.service.ts` | Código de autorização digitado errado apagava a autorização pendente. | Só apaga depois da troca dar certo. |
| `mail/providers.ts` | Tempo esgotado depois do Resend aceitar mandava o e-mail de novo. | `Idempotency-Key: mail-<id>`. |
| `delivery/geocoder.service.ts` | Fila do Nominatim sem limite: buscas únicas travavam a finalização de todos. | Mais de 15 esperando falha na hora (cliente marca no mapa). |
| `web/lib/api.ts` + `app/auth.tsx` | Sessão vencida no meio do uso: toda tela dava "Sessão inválida" até F5; fila offline parada. | 401 confere `/auth/me` e volta ao login. |
| `web/features/OrderDetailModal.tsx` | Resposta atrasada do pedido anterior aparecia no pedido aberto (ações no pedido errado). | Descarta resposta de outro pedido. |
| `web/features/NewSaleModal.tsx`, `waiter/WaiterOrder.tsx` | Cardápio não se atualizava com a tela aberta; depois de `idempotency_mismatch` todo envio falhava. | `menu.changed` recarrega; chave nova e aviso para conferir em Pedidos. |
| `web/pages/stock/ItemModals.tsx` | Saldo inicial falhou → salvar de novo criava insumo repetido. | Reaproveita o insumo criado. |
| `web/pages/KitchenPage.tsx`, `features/DriverPanel.tsx`, `pages/CustomersPage.tsx` | Quadro do setor anterior voltava; GPS fraco pedia permissão; linha de cliente sem teclado. | Corrigidos. |
| `web/pages/public/CartScreen.tsx` | Comprovante do Pix anexado continuava valendo depois de mudar o total. | Sai sozinho com aviso. |
| `web/pages/public/store.ts`, `context.tsx` | Dado antigo no aparelho quebrava o cardápio; sair da conta deixava nome/telefone/CPF. | Valida o formato; sair limpa os dados. |
| `web/pages/public/PublicOrderPage.tsx` | Acompanhamento consultava a cada 8 s para sempre (pedido concluído, link vencido). | Para. |
| `web/pages/public/HomeScreen.tsx` | Enter no favorito/Adicionar também abria o produto; espaço não abria. | Só o próprio cartão. |
| `web/site/Builder.tsx` | Teste grátis que falhou ficava preso em "Não deu certo", também ao recarregar. | "Tentar de novo" e limpa o cadastro guardado. |
| `web/vite.config.ts` | Regra `NetworkOnly` da API no service worker nunca casava. | Compara o caminho. |
| `.gitattributes` | Migração com CRLF (Windows) mudava o checksum. | `*.sql text eol=lf`. |

## Feito na 0.248.0 (itens altos e médios abaixo, menos o 10, que já tinha saído na 0.246.0)

Migração `0116_pendencias_da_varredura.sql`.

| Item | O que mudou |
| --- | --- |
| 1 | `channel_store_claims.approved_at`: loja ligada só pelo código (Keeta, 99Food, Rappi, Open Delivery, iFood centralizado) nasce sem aprovação e fica fora do polling (`app_channel_poll_targets`), das ações (toda busca de `credential` exige `approved_at`) e do cardápio do iFood (`IfoodService.clientFor`). Super Admin › Aplicativos de delivery › "Lojas esperando aprovação" aprova ou recusa (recusar apaga a reserva e solta a loja). aiqfome (ID Magalu) e iFood distribuído (`ownerVerified`) nascem aprovados; as reservas antigas ficaram aprovadas. |
| 2 | Pix com comprovante: o pedido é criado esperando pagamento e o comprovante vai no acompanhamento (`PixAfterHint`); aprovar lança o pagamento (`acceptPaidIn`). |
| 3 | Cobrança do app paga com o pedido quitado ou cancelado vira `refund_due`; sobra de qualquer cobrança volta por `refundExcess`; varreduras com `ORDER BY`. |
| 4 | Com o WhatsApp da loja mandando código, `POST /store/account/signup/code` + `code` no cadastro (422 `phone_code_required` sem ele). `customers.phone_verified_at`, `customer_phone_codes` (só o hash). |
| 5 | Pino a mais de 1,5 km do endereço digitado (`PIN_DRIFT_M`) não escolhe a área. |
| 6 | PIN novo de 6 números (`memberships.pin_digits`; o de 4 ainda entra). Erros contam por aparelho (cookie `cm_pdev`, `pin_devices`); aparelho desconhecido conta no restaurante. |
| 7 | Escolha padrão (sem decisão do dono do produto): o acesso de suporte não troca senha, PIN nem e-mail de login, não cria acesso nem dono (`assertNotSupport`, 403 `support_blocked`) e dura no máximo 2 horas. |
| 8 | `surchargeAfterItems`: mantém acréscimo zerado à mão e não recalcula na retirada. |
| 9 | `online_refund_journal`: registro à parte antes de chamar o PagBank; parado em `sent` vira `orphan` e aparece no pedido. |
| 11 | Aceite automático só para pedido pago ou sem Pix pendente (`autoAcceptAllowed`); o resto chega em análise. |
| 12 | Tempo esgotado na Meta é "incerto" e não reenvia. |
| 13 | `maskSubject`: o assunto gravado na fila esconde códigos; o real vai lacrado com o corpo. |
| 14 | `op-replay.interceptor.ts` reserva a chave antes de executar (`OP_BUSY`, 429). |
| 15 | Gatilho `users_password_changed_revoke` encerra as sessões nos outros restaurantes. |
| 16 | Zoom liberado no `index.html`. |

## Fica para decidir (lista original; altos e médios feitos acima)

**Alta**

1. **Ligar loja de aplicativo de outro restaurante** (`opendelivery.service.ts:143`, `rappi.adapter.ts` `onboard()` vazio, `ifood.service.ts` `connectCentralized`). Ninguém prova que é dono da loja: digitando o id (Rappi e Keeta são números), um restaurante passa a receber os pedidos de outro. Sugestão: loja ligada por código entra "aguardando aprovação" no Super Admin, ou conferir o CNPJ que o aplicativo devolve.
2. **Pix manual pago antes do pedido existir** (`CartScreen.tsx`). Com Pix por comprovante, o cliente paga e só então o pedido é enviado; se a loja fechou ou um item esgotou, o dinheiro foi e o pedido não. Sugestão: criar o pedido esperando pagamento e pedir o comprovante no acompanhamento (como no Pix do PagBank).

**Média**

3. **Cobrança do app paga com o pedido já quitado** (`online-pay.service.ts` `launch`): com `due = 0` a cobrança fica `paid` sem lançamento e a varredura (`LIMIT 50` sem ordem) tenta para sempre; a sobra não volta porque `refundExcess` só olha comanda. O bloqueio desta versão evita o caso comum; falta tratar a sobra como `refund_due`.
4. **Cadastro de cliente sem confirmar o telefone** (`customers.service.ts`): alguém cadastra o número de outra pessoa e recebe os pedidos e pontos dela ligados pelo balcão. Sugestão: código pelo WhatsApp no cadastro.
5. **Taxa de entrega pelo pino do cliente** (`store.service.ts` `quoteIn`): o pino escolhe a área e a taxa, sem conferir com o endereço digitado.
6. **PIN de 4 números** (`auth.controller.ts`): 10 erros por 15 min por restaurante = ~960 tentativas/dia, e qualquer um trava o PIN da equipe inteira. Sugestão: aparelho cadastrado ou 6 dígitos com trava por aparelho.
7. **Acesso de suporte sem limites**: agora fica marcado no histórico, mas ainda pode trocar senha do dono ou criar dono novo (acesso que dura depois das 2 horas). Decidir se o suporte pode fazer isso.
8. **Recalcular taxa ao cancelar/editar item** (`orders.service.ts` `cancelItem`, `editItems`) ignora acréscimo zerado à mão e não exclui retirada.
9. **Estorno do PagBank dentro da transação do caixa** (`online-pay.service.ts` `onRefundIn`).
10. **Credencial da Rappi**: salvar sem redigitar o segredo do webhook apaga o segredo (fica para a revisão de Credenciais).
11. **Pedidos falsos direto para a cozinha** com aceite automático (só telefone válido): limite por telefone/restaurante.
12. **Mensagem da Meta repetida** depois de tempo esgotado (o caminho do QR Code já trata como incerto).
13. **Código no assunto do e-mail** fica em claro em `mail_outbox.subject` por 90 dias, mesmo com `sensitive`.
14. **Reenvio offline** (`op-replay.interceptor.ts`) não impede duas execuções ao mesmo tempo.
15. **Troca de senha de conta compartilhada** não derruba as sessões nos outros restaurantes.
16. **Zoom bloqueado** (`index.html`: `user-scalable=no`) atrapalha quem enxerga pouco.

**Baixa**

17. Item que deixou de cumprir os grupos obrigatórios fica na sacola e trava o envio (`syncCart`).
18. Produto com preço só nas opções aparece "R$ 0,00" (mostrar "a partir de").
19. Reenvio do cardápio depois de recarregar a página cria pedido novo (chave só na memória).
20. "Vendas no app" do caixa soma todos os terminais; fiado gravado em duas transações.
21. Avaliação escondida pela loja volta se o cliente apagar e escrever de novo.
22. Pixel do cardápio aceita milhares de eventos por minuto por IP.
23. Corpos grandes (vídeo, PDF) lidos antes de qualquer conferência, em qualquer rota.
24. Domínio próprio verificado uma vez vale para sempre; "manter conectado" sem limite final.
25. `migrate-cli.ts`: falha ao ler `tenant_databases` vira lista vazia (bancos dedicados ficam sem a migração em silêncio). Vai para a revisão do migrador.
