# 0004 — Sessões opacas em cookie HttpOnly

**Contexto.** SPA no mesmo domínio da API; precisamos de revogação imediata (demissão de funcionário, troca de papel) e de impedir uso de sessão de um restaurante em outro.

**Alternativas.** JWT em `localStorage`; JWT em cookie; sessão opaca em cookie.

**Decisão.** Token aleatório (256 bits) em cookie `HttpOnly`, `SameSite=Lax`, `Secure` em produção, **sem `Domain`** (host-only). Banco guarda apenas `sha256(token)` na tabela `sessions` com RLS. CSRF: cabeçalho obrigatório `X-PedeMais-Request` em escritas + verificação de `Origin`.

**Consequências.** Uma consulta ao banco por requisição autenticada (aceitável; cache em Redis se necessário). Revogação instantânea. JavaScript nunca vê o token. Subdomínios de outros restaurantes não recebem o cookie.
