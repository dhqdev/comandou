# Reservas

Tela da equipe em `apps/web/src/pages/ReservationsPage.tsx` (peças em `pages/reservations/parts.tsx`)
e API em `apps/api/src/reservations/`. A tela segue o jeito da Agenda (`pages/agenda/`): reaproveita
as contas de data de `agenda-utils.ts` e as classes de `agenda.css`; o que é só das reservas fica em
`pages/reservations.css`.

## O que tem

- **Visões** Dia, Semana, Mês e Lista (próximos 60 dias), gravadas no aparelho (`cm-rv-view`).
  No computador a tela abre no Dia; no celular, no Mês com os cartões do dia tocado embaixo.
- **Dia**: grade de horários (cada reserva do tamanho do tempo na mesa) e, a partir de 1281 px,
  os cartões do dia ao lado com as ações (Confirmar, Chegou, Concluir, Não veio, Reabrir, mesa,
  telefone e WhatsApp). Em tela menor, tocar na reserva abre o mesmo cartão numa janela.
- **Painel do lado**: só Nova reserva e o minicalendário (desde a 0.173).
- **Tags de situação** acima da agenda (`rv-tags`): Todas (sem Cancelada e Não veio) e uma tag por
  situação com a contagem do período na tela (cor em `STATUS_COLOR`). Dá para escolher mais de uma;
  nenhuma escolhida = Todas. No celular ficam embaixo das visões e rolam de lado.
- **Reservas pelo cardápio**: botão na barra de cima (bolinha verde quando ligadas) que abre as
  configurações, com o link; ao lado, Copiar link. No celular, na folha aberta pelo título, junto
  com a busca, o calendário e o resumo do dia.
- **Tempo real**: todo `reservation.changed` recarrega a lista e marca o cartão com um contorno
  laranja por 2,4 s (`is-fresh`). Quem muda reserva fora do `ReservationsService` precisa publicar
  esse aviso depois do COMMIT (ex.: `completeSeatedForTab` devolve os ids; `publishReservations`
  do `OrdersService`).
- **Arrastar** (computador): muda dia e hora em passos de 15 minutos; a borda de baixo muda o tempo
  na mesa (15 min a 10 h). Reserva encerrada não arrasta. Clique num horário vazio abre a nova
  reserva naquele dia e hora; no mês, num dia vazio, às 20h.

## Tempo na mesa

Cada reserva tem `duration_minutes`. O cardápio usa o tempo médio das configurações; a equipe pode
mandar `durationMinutes` ao criar ou mudar (`StaffFields`). A conta de mesa livre
(`assertTableFree`) usa o tempo da própria reserva, então esticar uma reserva por cima de outra na
mesma mesa dá 409 `table_reserved`.

## Reserva pelo WhatsApp

A IA que atende no WhatsApp (tela Assistente de IA, opção "Fazer reservas de mesa") também reserva,
com as mesmas regras do cardápio (`ReservationsService.checkBooking`: dia aberto, antecedência,
lugares, até 3 em aberto por telefone). Ela só monta o pedido; o servidor grava depois do SIM do
cliente (`createWhatsApp`, `source = 'whatsapp'`, telefone da conversa) e o cartão mostra "pelo
WhatsApp". O cliente cancela pela conversa só reserva do próprio número (`cancelWhatsApp`). Detalhes
em [whatsapp.md](whatsapp.md#ia-que-atende-no-whatsapp).

## Reserva no cadastro do cliente

Na Nova reserva (e ao editar), o campo Cliente é o mesmo seletor do pedido (`CustomerPicker`): dá
para buscar um cliente já cadastrado ou digitar só nome e telefone. Escolhido do cadastro, vai
`customerId` (`StaffFields`, conferido em `checkCustomer`: existe e não está bloqueado, senão 422) e
`reservations.customer_id` liga a reserva à conta dele. O cartão mostra "acompanha pelo app".
Mandar `customerId: null` desliga.

O cliente vê e cancela essas reservas pela conta do cardápio, em **Conta › Reservas**
(`/pedir/reservas` e `/pedir/reservas/:id`), sem precisar do link da reserva:

- `GET /store/account/reservations`: as dele dos últimos 30 dias, as próximas primeiro (sem notas
  da equipe nem telefone).
- `GET /store/account/reservations/:id`: só a dele (de outro cliente dá 404).
- `POST /store/account/reservations/:id/cancel`: com as mesmas regras do link (`canCancel`); fica
  como cancelada pelo cliente, com auditoria e aviso em tempo real.

As três pedem a sessão do cliente (cookie da conta; sem ele, 401) e estão em `PUBLIC_TENANT_ROUTES`
na varredura de segurança. O cancelamento na tela da equipe pede o motivo num campo do próprio
cartão (não usa mais a janela do navegador).
