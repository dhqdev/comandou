# 0005 — API em `/api` no domínio do restaurante; Nginx só estático

**Contexto.** O prompt sugere `api.comandou.com` ou `/api` no mesmo domínio.

**Decisão.** `https://<slug>.comandou.com/api/*` → Traefik → NestJS; demais caminhos → Nginx (arquivos estáticos). `api` fica reservado como slug.

**Consequências.** Sem CORS, cookie host-only funciona, o tenant vem do mesmo Host que o navegador mostra. O Nginx não vira proxy de dados. WebSockets usarão `/api/ws` pela mesma regra do Traefik.
