# CrowdSec (proteção contra ataques)

O [CrowdSec](https://www.crowdsec.net) é um sistema gratuito e de código aberto que lê o log de
acesso do servidor, reconhece comportamento de ataque e bloqueia o IP por algumas horas. Ele também
recebe uma lista da comunidade com IPs que já atacaram outros servidores no mundo, então muitos
robôs são barrados antes de tentar qualquer coisa no Comandou.

No Comandou ele fica assim:

```
internet → Traefik ──(plugin do CrowdSec: "este IP está bloqueado?")──→ API / site
              │                         ↑ lista de bloqueados, a cada minuto
              └── log de acesso ──→ CrowdSec (stack `crowdsec`)
```

- **CrowdSec** (stack `crowdsec`, imagem `crowdsecurity/crowdsec`): lê o log do Traefik pelo
  Docker e decide quem bloquear. Fica na rede `network_public`, sem nenhuma porta aberta.
- **Bouncer** (plugin [crowdsec-bouncer-traefik-plugin](https://plugins.traefik.io/plugins/6335346ca4caa9ddeffda116/crowdsec-bouncer-traefik-plugin)
  dentro do Traefik): é quem bloqueia de fato, respondendo 403 ao IP bloqueado. A API do Comandou
  põe o plugin em todas as rotas pelo provider HTTP do Traefik.

## O que ele bloqueia

| O quê | Como |
| --- | --- |
| IPs que atacaram outros servidores | lista da comunidade CrowdSec, atualizada sozinha |
| Robôs procurando falhas (`/wp-login.php`, `/.env`, `/phpmyadmin`...) | cenários `crowdsecurity/base-http-scenarios` e `crowdsecurity/http-cve` |
| Força bruta no login | cenário próprio `comandou/login-bf`: mais de 15 erros seguidos de login do mesmo IP em poucos minutos (equipe, Super Admin e conta do cliente na loja) |
| Ferramentas de ataque conhecidas (sqlmap, nikto...) | `crowdsecurity/http-bad-user-agent` |

O bloqueio dura 4 horas (padrão do CrowdSec). Robôs bons (Google, Bing) nunca são bloqueados
(`crowdsecurity/whitelist-good-actors`).

## O que nunca é bloqueado

- **Webhook do Asaas** (`/api/v1/platform/billing/asaas/webhook`), **teste de status do Super
  Admin** e health checks (`/api/v1/health/...`) e **métricas** (`/api/v1/metrics`): chegam por
  roteadores próprios no Traefik, sem o plugin. Mesmo que o IP esteja bloqueado, passam. Todos já
  exigem token ou não mostram dados.
- **A Focus NFe** não manda webhook para o Comandou: é o Comandou que consulta a Focus. Nada a liberar.
- **O próprio servidor e a rede do Docker** (10.x, 172.16-31.x, 192.168.x, 127.x).
- **IPs que você escolher** (o escritório, por exemplo): `CROWDSEC_TRUSTED_IPS` em
  `/etc/comandou/deploy.env`, separados por vírgula, e rode `scripts/crowdsec.sh` de novo.
- **O uso normal do sistema.** Num restaurante, o PDV, a cozinha, os garçons e os clientes no
  cardápio saem todos pelo mesmo IP do Wi-Fi. Por isso as respostas de erro do dia a dia da API
  (sessão vencida, sem permissão, item apagado) não contam como ataque
  ([`comandou-whitelist.yaml`](../infrastructure/crowdsec/comandou-whitelist.yaml)): a API já tem o
  próprio limite por minuto e o bloqueio por conta ([segurança](security.md)). Só o login conta.

**Se o CrowdSec cair, os sites continuam no ar**, só sem bloqueio (`updateMaxFailure: -1` no
plugin). O Traefik também não espera o CrowdSec para começar a atender. E se o Traefik for
recriado sem o plugin, a API tem roteadores de reserva sem ele: de novo, fica sem bloqueio, mas
no ar. Tudo isso foi testado num Swarm com Traefik 3.6, CrowdSec 1.8.2 e o plugin 1.8.1.

## Ligar no servidor

Pelo SSH, no servidor, rode o mesmo comando de instalar e atualizar (ele baixa a versão 0.78.0 ou
mais nova, que traz o CrowdSec):

```bash
curl -fsSL https://admin.SEU-DOMINIO/instalar | sudo bash
```

No final ele pergunta **"Ligar o CrowdSec agora?"**: responda `s`. Se preferir ligar depois, ou
rodar de novo: `sudo /opt/comandou/scripts/crowdsec.sh`.

O script pergunta antes de cada passo e faz nesta ordem, conferindo cada um antes do próximo:

1. **Traefik**: acrescenta o plugin do CrowdSec e o log de acesso, se faltarem. O Traefik reinicia
   (alguns segundos fora do ar). O script confere no log que o plugin carregou; se não carregou
   (por exemplo, o servidor não alcança `plugins.traefik.io`), para ali e nada mais muda.
   - Traefik instalado pelo Comandou (configuração num secret): cria um secret novo com o plugin
     (`comandou_traefik_static_crowdsec_<data>`) e mantém o antigo.
   - Traefik por argumentos (SetupOrion, Portainer): acrescenta os argumentos. **Se o Traefik é uma
     stack do Portainer, acrescente as mesmas linhas no `command` dela**, senão a próxima
     atualização pelo Portainer tira o plugin. Os sites não caem por isso (a API mantém rotas de
     reserva sem o plugin), mas ficam sem bloqueio até você rodar o script de novo:
     ```
     - "--experimental.plugins.crowdsec.modulename=github.com/maxlerebourg/crowdsec-bouncer-traefik-plugin"
     - "--experimental.plugins.crowdsec.version=v1.8.1"
     - "--accesslog=true"
     - "--accesslog.filters.statuscodes=400-599"
     ```
2. **CrowdSec**: cria o secret `comandou_crowdsec_bouncer_key` (a chave que o Traefik usa para
   consultar o CrowdSec) e sobe a stack `crowdsec`. Na primeira vez ele baixa as regras (~1 min).
3. **Bloqueio**: liga na API (`CROWDSEC_BOUNCER=true`, sem derrubar: uma réplica por vez) e grava
   `COMANDOU_CROWDSEC=1` em `/etc/comandou/deploy.env`, para as próximas atualizações manterem.

Pode rodar o script de novo quando quiser (atualizar regras, mudar IPs confiáveis): o que já está
certo ele pula.

### Painel do CrowdSec (opcional, gratuito)

Em [app.crowdsec.net](https://app.crowdsec.net) dá para ver os ataques num painel e assinar listas
extras. Crie a conta, copie a chave de inscrição ("enroll key") e rode:

```bash
echo 'CROWDSEC_ENROLL_KEY=<chave>' | sudo tee -a /etc/comandou/deploy.env
sudo scripts/crowdsec.sh
```

Depois aceite o servidor no painel do site.

## No dia a dia

```bash
sudo scripts/crowdsec.sh --status     # o que ele está lendo, alertas e quem está bloqueado
```

**Um restaurante ou cliente diz que o site responde "Forbidden" (403):** descubra o IP dele (ex.:
[meuip.com.br](https://meuip.com.br) no aparelho) e desbloqueie:

```bash
docker exec $(docker ps -q -f name=crowdsec_crowdsec) cscli decisions list --ip <IP>
docker exec $(docker ps -q -f name=crowdsec_crowdsec) cscli decisions delete --ip <IP>
```

Para nunca mais bloquear esse IP, ponha-o em `CROWDSEC_TRUSTED_IPS` (acima).

**Desligar o bloqueio** (o CrowdSec continua rodando, só não bloqueia; os sites não saem do ar):

```bash
sudo scripts/crowdsec.sh --off
```

Para tirar de vez: `sudo scripts/crowdsec.sh --off` e depois `docker stack rm crowdsec`. O plugin
no Traefik pode ficar: sozinho ele não faz nada.

## Arquivos

| Arquivo | Para quê |
| --- | --- |
| [`infrastructure/crowdsec/crowdsec-stack.yml`](../infrastructure/crowdsec/crowdsec-stack.yml) | stack `crowdsec` |
| [`infrastructure/crowdsec/acquis-traefik.yaml`](../infrastructure/crowdsec/acquis-traefik.yaml) | de onde vem o log (serviço `*_traefik` do Swarm) |
| [`infrastructure/crowdsec/comandou-whitelist.yaml`](../infrastructure/crowdsec/comandou-whitelist.yaml) | o que não conta como ataque |
| [`infrastructure/crowdsec/comandou-login-bf.yaml`](../infrastructure/crowdsec/comandou-login-bf.yaml) | força bruta no login |
| [`infrastructure/swarm/crowdsec.yml`](../infrastructure/swarm/crowdsec.yml) | overlay da API (o instalador inclui com `COMANDOU_CROWDSEC=1`) |
| [`infrastructure/swarm/wildcard-crowdsec.yml`](../infrastructure/swarm/wildcard-crowdsec.yml) | idem, com certificado coringa |
| [`scripts/crowdsec.sh`](../scripts/crowdsec.sh) | liga, mostra o estado e desliga |

Variáveis da API: `CROWDSEC_BOUNCER` (`true` liga), `CROWDSEC_BOUNCER_KEY` (ou `_FILE`; sem a chave
não liga), `CROWDSEC_LAPI_HOST` (padrão `crowdsec_crowdsec:8080`), `CROWDSEC_PLUGIN_NAME` (padrão
`crowdsec`, o nome em `experimental.plugins`) e `CROWDSEC_TRUSTED_IPS`.

Mudou um dos arquivos `.yaml` acima? Rode `sudo scripts/crowdsec.sh` de novo: as configs do Docker
levam um resumo do conteúdo no nome, então a stack é recriada com a versão nova.
