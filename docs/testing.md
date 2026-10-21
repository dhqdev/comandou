# Testes

| Suíte | Ferramenta | Onde | O que prova |
| --- | --- | --- | --- |
| Regras compartilhadas | Vitest | `packages/shared/src/*.test.ts` | dinheiro sem float, half-even, slugs válidos/reservados, permissões por papel |
| Unitários API | Vitest | `apps/api/src/**/*.test.ts` | classificação de Host (injeção, aninhamento), hash de senha, segredos `*_FILE` |
| **RLS no banco** | Vitest + Postgres real | `apps/api/test/rls.int.test.ts` | papel da app sem privilégios de bypass; RLS em toda tabela com `tenant_id`; sem contexto = zero linhas; WITH CHECK bloqueia insert/move entre tenants; `row_security=off` não contorna; sem DELETE/UPDATE de auditoria; **FKs compostas** (até para o dono); **pool reutilizado não vaza contexto**; funções pré-login não cruzam tenants; domínio não verificado não resolve |
| **API ponta a ponta** | Vitest + supertest | `apps/api/test/api.e2e.test.ts` | Host desconhecido/malformado; `X-Forwarded-Host` ignorado sem proxy confiável; login, cookie HttpOnly host-only, token não armazenado em claro; sessão de A rejeitada em B; logout revoga; trocar ID na URL → 404; `tenant_id` do corpo ignorado; validação de preço; garçom sem permissão de escrita; CSRF; auditoria no tenant certo; tenant suspenso; rate limit |
| Provisionamento | Vitest | `apps/api/test/provisioning.int.test.ts` | idempotência, retomada após falha, validações |
| Componentes Web | Vitest + Testing Library | `apps/web/src/**/*.test.tsx` | acessibilidade básica dos componentes, entrada monetária BR |
| E2E navegador | Playwright | `apps/web/e2e` | login (erro e sucesso), PDV, cadastro de produto, sessão após recarregar sem `localStorage`, sem rolagem horizontal; desktop e Pixel 7 |

**Mutação de controle**: ao remover `ENABLE ROW LEVEL SECURITY` de `products`, 7 testes de RLS falham (verificado em 2026-10-21). Ou seja, os testes detectam a regressão que pretendem evitar.

Ainda **não** cobertos (entram com os módulos): filas, WebSockets, arquivos, relatórios/exportações, backups e restauração, Super Admin.
