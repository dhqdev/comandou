# Chamados e esteira de desenvolvimento

O restaurante abre um chamado (texto, fotos e vídeos) em **Sistema › Chamados**. O chamado cai na
**esteira** do painel Super Admin (**Chamados**), onde cada etapa tem um agente de IA
(OpenRouter) que faz a parte dele. Você decide se o chamado será feito; aprovado, ele anda sozinho
até abrir um PR em rascunho no GitHub, e o cliente vê o andamento a cada etapa.

## Tela do restaurante

- **Lista** (`pages/TicketsPage.tsx`): resumo no topo (em andamento, respostas novas, resolvidos) e
  o quadro com as seis etapas que o cliente vê. No celular o quadro vira lista e só mostra as
  etapas que têm chamado. Cancelados e recusados ficam numa lista embaixo.
- **Chamado aberto**: conversa em tela cheia no jeito de um chat (`features/tickets/TicketChat.tsx`
  + `ticket-chat.css`): o restaurante à direita, o suporte à esquerda, separador por dia, avisos do
  andamento no meio e a descrição de abertura como a primeira mensagem. A caixa de escrever fica
  presa embaixo (Enter envia, Shift + Enter pula linha). Ao lado, o andamento em passos e os
  detalhes; abaixo de 900 px eles descem para depois da conversa.

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
- **Conversa**: o que você escreve vai para o cliente; marque **Nota interna** para ele não ver.
- Demanda criada por você no painel (**Nova demanda**) já nasce aprovada.
- Erro numa etapa: tenta 3 vezes (1, 2 e 3 min depois) e então espera você, com o erro no cartão.

## Segurança

- O texto do cliente vai para a IA entre aspas, com a regra de nunca seguir instruções de dentro
  dele. Mesmo assim, nada vai para a `main`: o máximo é um PR em rascunho, e o merge é sempre seu.
- O agente nunca mexe em `.github/`, `infrastructure/`, `scripts/`, `.env*`, `package.json`,
  `pnpm-lock.yaml` nem em migrações. Edição que não acha o trecho exato é descartada (fica no
  arquivo do chamado como "não aplicado").
- O token do GitHub fica cifrado com a `INTEGRATIONS_KEY` (contexto `pipeline:github`) e nunca volta
  para o navegador. A chave do OpenRouter é a mesma de **Super Admin › IA**; o uso da esteira fica
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
