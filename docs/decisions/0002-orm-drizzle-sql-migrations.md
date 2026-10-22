# 0002 — Drizzle ORM + migrações em SQL puro

**Contexto.** Precisamos de consultas complexas (relatórios, caixa), transações explícitas, `set_config` por transação para RLS, políticas e funções SQL versionadas, e SQL explícito quando necessário.

**Alternativas avaliadas.**

| Critério | Prisma | Drizzle |
| --- | --- | --- |
| SQL explícito | `$queryRaw`, fora do modelo | nativo (`sql\`\``), mesmo builder tipado |
| Transação com `set_config` local | interativa, mas o client gerencia conexões; exige cuidado com extensions/middleware | usamos o `PoolClient` do `pg` diretamente dentro de `BEGIN…COMMIT` |
| RLS/políticas/funções nas migrações | precisa editar SQL gerado manualmente | migrações já são SQL |
| Binário/engine | engine em Rust (multiarch, mas peso extra) | JS puro |
| Tipos | gerados (`prisma generate`) | inferidos do schema TS |

**Decisão.** Drizzle para consultas tipadas; **migrações escritas em SQL** (`apps/api/db/migrations/NNNN_*.sql`) com um migrador próprio (checksum, advisory lock, uma transação por arquivo). O schema TS (`database/schema.ts`) espelha o SQL.

**Consequências.** Políticas RLS, grants e funções ficam revisáveis no PR. É preciso manter `schema.ts` alinhado ao SQL (os testes de integração quebram se divergir). O ORM **não** é a camada de segurança: o banco é.
