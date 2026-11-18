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
