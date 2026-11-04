# Modelo da configuração estática do Traefik. O instalador troca @ACME_EMAIL@ e @PROVIDER_TOKEN@
# e guarda o resultado como secret (o token nunca vai para arquivo em disco).
api: { dashboard: false }
log: { level: INFO }
accessLog:
  filters: { statusCodes: ['400-599'] } # só erros: não registra URLs de rastreio
entryPoints:
  web:
    address: ':80'
    http:
      redirections:
        entryPoint: { to: websecure, scheme: https }
  websecure:
    address: ':443'
providers:
  swarm:
    endpoint: unix:///var/run/docker.sock
    exposedByDefault: false
    network: network_public
  http:
    endpoint: http://comandou_api:3000/api/v1/internal/traefik?token=@PROVIDER_TOKEN@
    pollInterval: 30s
certificatesResolvers:
  letsencryptresolver:
    acme:
      email: @ACME_EMAIL@
      storage: /letsencrypt/acme.json
      httpChallenge: { entryPoint: web }
  letsencrypt-http:
    acme:
      email: @ACME_EMAIL@
      storage: /letsencrypt/acme-http.json
      httpChallenge: { entryPoint: web }
# Plugin do CrowdSec (docs/crowdsec.md). Sozinho não bloqueia nada: só vale quando a API põe o
# middleware nas rotas, o que scripts/crowdsec.sh liga depois de subir o CrowdSec.
experimental:
  plugins:
    crowdsec:
      moduleName: github.com/maxlerebourg/crowdsec-bouncer-traefik-plugin
      version: v1.8.1
