---
name: comandou-projeto
description: Mapa do projeto Comandou e o que manter em dia a cada mudança — onde fica cada coisa (API NestJS, web React, Super Admin, site, e-mail, migrações), como versionar (package.json + Novidades), como rodar testes e telas no Windows, como mandar e-mail de qualquer módulo, e como o GitHub Actions publica. Use antes de mudar qualquer coisa no Comandou, ao terminar uma entrega (README, docs, skills, Novidades) e antes de enviar para a main.
---

# Projeto Comandou

SaaS para restaurantes: PDV, salão, cozinha, caixa, cardápio online, entregas, estoque,
financeiro, nota fiscal, WhatsApp e o painel Super Admin (`admin.<domínio>`), mais o site público
(`<domínio>`) que cria o teste grátis. Monorepo pnpm; tudo em português do Brasil, sem jargão.

## Onde fica cada coisa

| Caminho | O que é |
| --- | --- |
| `apps/api/src/<módulo>` | NestJS 11. Guards globais: limite → CSRF → restaurante (Host) → sessão → permissão → cobrança. Painel: `PlatformHostGuard` + `PlatformSessionGuard`. |
| `apps/api/db/migrations/NNNN_*.sql` | Migrações versionadas, **só aditivas**; nunca edite uma já aplicada (checksum). Tabela de restaurante: `tenant_id` + RLS. Tabela do painel: `ENABLE RLS` + política `platform_all TO comandou_platform`. |
| `apps/api/src/mail/` | E-mail próprio: fila `mail_outbox` que entrega **só pelo Resend** e a tela Super Admin › E-mail (Resend + Envios). Caixas, agenda, agendamento, Cloudflare e SMTP foram retirados na 0.142 (tabelas antigas seguem no banco, sem uso). Guia: `docs/email.md`. |
| `apps/web/src/platform/` | Super Admin (uma tela por arquivo, carregada sob demanda em `PlatformApp.tsx`; menu em `NAV`). |
| `apps/web/src/site/` | Site público (sempre claro, React Bits em `site/reactbits/`). |
| `apps/web/src/pages`, `features`, `design-system` | App do restaurante e o Design System (tokens em `design-system/tokens.css`). |
| `packages/shared` | Regras comuns e `releases.ts` (tela Novidades). |
| `infrastructure/` | Dockerfiles, Nginx, Traefik, Swarm, CrowdSec, monitoramento. |
| `docs/` | Arquitetura, ADRs, operação, segurança, auditorias, guias (site, e-mail, contratos, cobrança). |

## Regras que quebram o CI se esquecer

1. **Versão**: toda entrega sobe a versão em `package.json` (raiz) **e** `packages/shared/package.json`
   (o teste confere) — e os de `apps/api` e `apps/web` juntos — e acrescenta a entrada no topo de
   `packages/shared/src/releases.ts` (mesma versão, data, título, resumo e notas com as tags
   `novo`, `melhoria`, `correção` ou `segurança`). Funcionalidade nova sobe o número do meio.
2. **Prettier**: `pnpm format:check` roda no CI. Rode `pnpm exec prettier --write <arquivos>`.
   No Windows, use `git config core.autocrlf input` neste repositório, senão o Prettier acusa
   centenas de arquivos só por causa do fim de linha.
3. **Tipos e testes**: `pnpm typecheck`, `pnpm test`, `pnpm build`, `shellcheck` dos scripts e
   `pnpm audit --prod --audit-level high`.
4. **Dependência nova**: versão fixa ou `^` com lockfile atualizado (`pnpm install`), e conferir
   o `pnpm audit`.

## Como o GitHub Actions publica

`.github/workflows/ci.yml` roda a cada push na `main` (mudança só em `*.md` ou `docs/` não roda):
1. Qualidade (formatação, tipos, testes com Postgres e Redis, build, auditoria) e Ponta a ponta
   (Playwright no navegador + backup e restauração);
2. Versão: a do `package.json` se a tag ainda não existe, senão a próxima correção;
3. Imagens `ghcr.io/<dono>/comandou-{api,web,whatsapp-gateway,backup}` (amd64 + arm64);
4. Tag e Release. **Publicar não implanta**: o deploy é o workflow manual "Deploy (produção)",
   o botão Atualizar do painel ou o instalador.

O dono pede para enviar direto na `main`, sem PR. Antes do push: tudo verde localmente.

## Testes e telas no Windows

- Banco de teste: `docker run -d --name cmd-test-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:16-alpine`
  e Redis em 56379; crie os papéis como no passo "Papéis do banco de teste" do `ci.yml` e exporte
  `TEST_DATABASE_*_URL` / `TEST_REDIS_URL` apontando para essas portas.
- `cd apps/api && npx vitest run <arquivo>`; a suíte toda leva uns 20 minutos.
- Telas: banco `comandou` no mesmo contêiner, `node apps/api/dist/database/migrate-cli.js`,
  `platform-admin-cli.js --bootstrap` e um Super Admin de teste com `PLATFORM_ADMIN_PASSWORD` e
  `PLATFORM_ADMIN_TOTP_SECRET`; `node apps/api/dist/main.js` e `npx vite --port 5173` em
  `apps/web`. Painel em `http://admin.comandou.localhost:5173`, site em `http://comandou.localhost:5173`.
- O código do autenticador sai de `apps/api/dist/platform/totp.js` (`totpCode(segredo, totpStep())`).

## Mandar e-mail de qualquer módulo

Injete `MailService` (módulo global). Dentro da sua transação: `mail.enqueue(c, {...})` (o
e-mail só existe se a transação valer) e, depois do COMMIT, `mail.deliver(id)`. Fora de
transação: `mail.send({...})`. Conteúdo com senha ou código: `sensitive: true` (fica cifrado e
é apagado ao sair). Remetente com o nome do restaurante: `from: { name }`. Nos testes, use
`test/mail-fake.ts` (troca a internet por uma função e liga o provedor Resend falso).

## Ao terminar uma entrega, atualize

- `packages/shared/src/releases.ts` e as versões (acima);
- `README.md` (o que o sistema faz, documentação, estrutura) quando mudar algo que o cliente vê;
- o guia em `docs/` do assunto (e `docs/security.md` se mexer em proteção);
- **estas skills**: `comandou-design` (padrão visual e exceções) e esta (mapa, regras, como
  testar). Skill desatualizada ensina o próximo a errar.
