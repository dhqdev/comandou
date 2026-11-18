# Agenda

Agenda pessoal de cada pessoa da equipe, no jeito do Google Agenda. Fica no menu, embaixo, ao lado
de Novidades (no celular, em Mais › Conta). Não pede permissão especial: todo mundo tem a sua, e
ninguém vê a agenda do outro.

## O que tem

- **Visões** Dia, Semana, Mês e Lista (próximos 60 dias). A semana começa no domingo, como o
  calendário dos campos de data. A escolha fica gravada no aparelho.
- **Criar**: botão Criar (próxima meia hora do dia escolhido), clique num horário vazio da grade
  (dia/semana) ou num dia do mês (cria de dia todo).
- **Arrastar** (computador): o compromisso muda de dia e hora em passos de 15 minutos; a borda de
  baixo muda a duração. No mês, arrasta para outro dia mantendo a hora. Se tinha lembrete, ele
  anda junto (mesma antecedência).
- **Tags** da própria pessoa (nome + cor, até 50). No painel do lado elas são filtros (desmarcar
  esconde os compromissos). Excluir uma tag mantém os compromissos, só sem a tag.
- **Concluído**: círculo na Lista e no dia do celular; risca o título. Lembrete de compromisso
  concluído não sai.
- **Busca** pelo título, anotações e tag, no período que está na tela.

## Lembretes pelo WhatsApp

1. A pessoa permite uma vez em "Lembretes no WhatsApp" (liga/desliga + o número dela) e pode
   mandar uma mensagem de teste.
2. Em cada compromisso escolhe quando avisar: na hora, 10/30 min, 1/2 h, 1 dia antes; no dia todo,
   no dia às 8h ou na véspera às 18h; ou um dia e hora à mão.
3. `AgendaService.sweep` roda a cada `AGENDA_INTERVAL_SECONDS` (padrão 60; 0 desliga; desligado
   nas versões fixas de cliente). O papel do painel só descobre quais restaurantes têm lembrete
   vencido; o envio roda dentro do restaurante, marca `reminded_at` antes de mandar (com
   `FOR UPDATE SKIP LOCKED`, então duas réplicas não mandam duas vezes) e grava `remind_error`
   quando não deu (permissão desligada, WhatsApp desconectado, mais de 6 h de atraso).
4. Sai pelo WhatsApp do restaurante **conectado por QR Code** (`MessagingService.sendText`). A API
   oficial da Meta exige modelo aprovado por mensagem, então não manda lembrete.

Lembrete com horário que já passou, ao salvar, não sai (fica marcado como resolvido).

## Onde fica

| Caminho | O que é |
| --- | --- |
| `apps/api/db/migrations/0080_agenda.sql` | `agenda_tags`, `agenda_events`, `agenda_settings` (RLS por restaurante; a API filtra por `user_id`). |
| `apps/api/src/agenda/` | Rotas `/api/v1/agenda/*` e a varredura dos lembretes. |
| `apps/web/src/pages/agenda/` | Tela (`AgendaPage`), janelas (`EventDialog`, `AgendaDialogs`), contas de data (`agenda-utils.ts`) e `agenda.css`. |
| `apps/api/test/agenda.e2e.test.ts` | Isolamento entre pessoas e restaurantes, tags, lembrete que anda junto e a varredura. |
