# Chamados e esteira de desenvolvimento

O restaurante abre um chamado (texto, fotos e vídeos) em **Sistema › Chamados**. O chamado cai na
**esteira** do painel Super Admin (**Chamados**), onde cada etapa tem um agente de IA
(OpenRouter) que faz a parte dele. Você decide se o chamado será feito; aprovado, ele anda sozinho
até abrir um PR em rascunho no GitHub, e o cliente vê o andamento a cada etapa.

## Tela do restaurante

- **Lista** (`pages/TicketsPage.tsx`): resumo no topo (em andamento, respostas novas, resolvidos) e
  o quadro com as seis etapas que o cliente vê. No celular o quadro vira lista e só mostra as
  etapas que têm chamado. Cancelados e recusados ficam numa lista embaixo.
- **Chamado aberto** (`TicketView` em `pages/TicketsPage.tsx`, estilos em
  `features/tickets/ticket-chat.css`): **não tem conversa nem caixa de escrever** (desde a 0.158.1).
  No topo, a situação atual com a barra das seis etapas; depois **O que você contou** (descrição e
  anexos de abertura) e o **Histórico** (`features/tickets/TicketHistory.tsx`), do mais novo para o
  mais antigo, com os avisos do andamento e as respostas da equipe (as antigas, de antes da 0.155,
  continuam aparecendo ali). Ao lado, o cartão **Falar no chat**, que abre o chat do sistema na aba
  Suporte com o chamado já anexado (`talkAboutTicket` em `features/chat/TeamChat.tsx`), e os
  detalhes. Abaixo de 900 px vira uma coluna: situação, Falar no chat, o que contou, histórico e
  detalhes; abaixo de 600 px as etapas ficam só nas barrinhas.

## Conversa sobre o chamado

Desde a 0.155 a conversa de cada chamado mora na conversa de suporte (aba Suporte do chat ›
Super Admin › Conversas). A mensagem pode levar um chamado junto (`ticket_id` em
`platform_support_messages`, migração 0079): pelo clipe › **Um chamado** (restaurante: todos os
chamados dele; painel: os abertos daquele restaurante) ou pelos botões **Falar no chat**
(restaurante) e **Conversar sobre este chamado** (aba Notas do chamado no painel). O cartão do
chamado mostra o número, o título e a situação que o cliente vê, e abre o chamado dos dois lados.
O servidor só aceita chamado do mesmo restaurante; sem texto, a mensagem vira "Sobre o chamado
#CH-0000". Quando a esteira espera resposta do cliente, a resposta chega pelas Conversas.

## Etapas

| Etapa           | Agente | O que faz                                                                                                                                 | O cliente vê       |
| --------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Início          | Lia    | Triagem: resume a dor, classifica, sugere prioridade, critérios de aceite e perguntas. **Para e espera você aprovar ou recusar.**         | Em análise         |
| Priorização     | Bento  | Prioridade 0–100 (urgência, impacto, plano do cliente) e análise do código: lê a lista de arquivos do repositório e aponta onde mexer.    | Aprovado, na fila  |
| Desenvolvimento | Caio   | Cria a branch `<prefixo>/<número>-<título>`, grava `docs/chamados/chamado-NNNN.md` e propõe a correção (trechos trocados) num commit só. | Em desenvolvimento |
| Code review     | Vera   | Revisa o diff. Problema grave vira pendência e o chamado espera você.                                                                    | Em desenvolvimento |
| PR              | Paulo  | Abre o PR em **rascunho** com cliente, dor, critérios de aceite, revisão e pendências.                                                    | Em desenvolvimento |
| Testes          | Íris   | Acompanha o GitHub Actions do commit. Sem execução em 10 min, monta um roteiro de teste manual. Espera o merge.                         | Em testes          |
| Concluído       | Nina   | Quando o PR é mesclado (ou você move para cá), escreve ao cliente, sem termos técnicos, o que foi resolvido.                             | Resolvido          |

- **Avança sozinho**: depois de aprovado, o chamado passa de etapa em etapa. Desligue no chamado
  (ou em Configurar, para os novos) para avançar com o botão **Avançar**.
- **Mover / refazer**: leva o chamado para qualquer etapa e põe o agente dela para trabalhar de novo.
- **Notas**: só para a equipe (o cliente não vê). Para falar com o cliente, **Conversar sobre este
  chamado** abre as Conversas com o chamado citado.
- Demanda criada por você no painel (**Nova demanda**) já nasce aprovada.
- Erro numa etapa: tenta 3 vezes (1, 2 e 3 min depois) e então espera você, com o erro no cartão.

## Segurança

- O texto do cliente vai para a IA entre aspas, com a regra de nunca seguir instruções de dentro
  dele. Mesmo assim, nada vai para a `main`: o máximo é um PR em rascunho, e o merge é sempre seu.
- O agente nunca mexe em `.github/`, `infrastructure/`, `scripts/`, `.env*`, `package.json`,
  `pnpm-lock.yaml` nem em migrações. Edição que não acha o trecho exato é descartada (fica no
  arquivo do chamado como "não aplicado").
- O token do GitHub fica cifrado com a `INTEGRATIONS_KEY` (contexto `pipeline:github`) e nunca volta
  para o navegador. A chave do OpenRouter é a de **Super Admin › Credenciais** (a sua, ou a dos restaurantes); o uso da esteira fica
  no próprio chamado e não conta no limite de IA do restaurante.

## Token do GitHub (repositório privado)

Em **Chamados › Configurar** há o passo a passo. Resumo:

1. GitHub › Settings › Developer settings › **Fine-grained tokens** › Generate new token.
2. Resource owner: o dono do repositório. **Repository access: Only select repositories** e escolha
   o repositório do Comandou (sem isso, o token não enxerga um repositório privado).
3. Repository permissions: **Contents: Read and write**, **Pull requests: Read and write**,
   **Actions: Read-only** (Metadata: Read-only vem marcado).
4. Gere, cole em **Token do GitHub**, clique em **Testar GitHub** e **Salvar**.

Token clássico também funciona (escopo `repo`). O CI do Comandou hoje roda só na `main`; para a
etapa Testes acompanhar os PRs, acrescente `pull_request` ao gatilho do workflow.

## Técnico

- Tabelas no banco central (`0039_support_tickets.sql`): `platform_pipeline_settings`,
  `platform_tickets`, `platform_ticket_events`, `platform_ticket_files` (prefixo `platform_`: não
  saem do central ao mover um restaurante para banco próprio).
- API do restaurante: `/api/v1/support/tickets*` (permissão `plan:read`, funciona com o
  restaurante bloqueado pela cobrança). Painel: `/api/v1/platform/tickets*`.
- O laço da esteira roda na API a cada `TICKETS_PIPELINE_SECONDS` (padrão 10; 0 para). Réplicas
  não pegam o mesmo chamado (`FOR UPDATE SKIP LOCKED` + `locked_until`). **Rodar agora** no painel
  roda uma volta na hora.
- `GITHUB_API_URL` só muda nos testes (`apps/api/test/tickets.e2e.test.ts`, com OpenRouter e
  GitHub falsos).
