# 0003 — Banco compartilhado com tenant_id + RLS

**Contexto.** Muitos restaurantes pequenos; custo operacional precisa ser baixo; isolamento é requisito crítico.

**Alternativas.** Banco por tenant; schema por tenant; banco compartilhado só com filtro na aplicação; banco compartilhado com RLS.

**Decisão.** Banco compartilhado, `tenant_id` em toda tabela de negócio, RLS com `app.tenant_id` local à transação, papel da aplicação sem `BYPASSRLS` e sem posse das tabelas, FKs compostas `(tenant_id, …)`. Operações globais (migração, provisionamento) usam o papel dono em caminhos separados. Duas funções `SECURITY DEFINER` estreitas para o que acontece antes de saber o usuário (resolver Host e buscar credencial dentro de um tenant).

**Consequências.** Um backup e uma migração para todos. Isolamento garantido em duas camadas (app + banco) e testado. Consultas sem contexto retornam vazio (falha segura). Um tenant grande pode ser movido para banco dedicado no futuro (ver arquitetura). Não usamos `FORCE ROW LEVEL SECURITY`; por isso o papel dono nunca pode ser usado pela API.
