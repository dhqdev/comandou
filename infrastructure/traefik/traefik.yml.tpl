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
    endpoint: http://pedemais_api:3000/api/v1/internal/traefik
    pollInterval: 30s
    headers:
      Authorization: Bearer @PROVIDER_TOKEN@
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
