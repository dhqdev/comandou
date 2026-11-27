# Credenciais do Comandou (Super Admin › Credenciais)

Tudo o que o Comandou usa de chave, token ou senha, num lugar só. No painel, a aba
**Credenciais** (`admin.<domínio>/credenciais`) traz este guia inteiro: como funciona e a ordem para
subir o sistema (num quadro que recolhe; vem aberto quando falta algo) e um **cartão por chave** em
grade, com a situação à vista (Em uso / Funcionando / Falta / Recusada / Sem uso / Fora daqui), o
final da chave e um filtro em cima (Pedem atenção, Em uso, Sem uso, Fora daqui). Clicar no cartão
**amplia** numa janela: o cadastro (colar, **Testar** e **Salvar**) de um lado e, do outro, o
passo a passo, o que vai em cada campo, como saber que deu certo e os links. O endereço ganha
`#cred-<id>`: as outras telas abrem direto no cartão certo. Este arquivo é a mesma lista, para
ler antes do painel existir.

As chaves do painel ficam cifradas no banco com a `INTEGRATIONS_KEY` (AES-256-GCM) e nunca voltam
para a tela: depois de salva, aparece só o final dela ("termina em 4f2a"), para saber qual está em
uso. As outras telas (Tokens de IA, Cobrança, Pagamentos pelo app, E-mail, Backups, Site com IA,
Chamados) ficam com os ajustes de cada assunto e uma linha **Chave em uso** (nome, ambiente ou
conta e o final da chave), com o nome levando ao cartão em Credenciais.

Código: `apps/web/src/platform/credentials/` (texto de cada uma em `catalog.tsx`, formulários em
`editors.tsx`) e `apps/api/src/platform/platform-credentials.service.ts`
(`GET /api/v1/platform/credentials`, nunca devolve um valor).

A **Situação** do topo separa as **necessárias** (sem elas o sistema não funciona) das
**opcionais em uso** (aplicativos de delivery, PagBank, Backblaze, GitHub): "salva" não é o
mesmo que "faltando". O webhook do Asaas só conta depois da chave do Asaas.

**Conferir todas agora** (`POST /api/v1/platform/credentials/check`, no máximo 4 por minuto,
auditado como `credentials.checked`) usa cada chave **salva** no próprio fornecedor, sem cobrar
nem mandar nada a ninguém, e marca no cartão "funcionando" ou "recusada" com o motivo:

| Credencial | Como confere |
| --- | --- |
| Focus NFe | lista as empresas da conta (`GET /v2/empresas`) |
| OpenRouter (restaurantes e a do sistema) | lê os dados da chave (`GET /key`, não gasta) |
| OpenRouter de gerenciamento | lê o saldo da conta (`GET /credits`) |
| Resend | lê os domínios e confere se o do remetente está verificado; chave "só envio" (a recomendada) responde `restricted_api_key` e conta como válida |
| Asaas | lê a conta (o mesmo Testar do cartão) |
| PagBank | pede a chave pública da conta com o token da plataforma |
| Backblaze B2 | grava, lê, lista e apaga um arquivo de teste no bucket |
| GitHub da esteira | o mesmo teste do cartão (repositório, push, branch base, Actions) |
| GitHub das atualizações | lê a última versão publicada |

Os aplicativos de delivery não entram: o teste de cada um é ligar a primeira loja.

## Ordem para subir o sistema

1. **DNS**: registros A de `@`, `*` e `admin` para o IP do servidor.
2. **Instalador** (`docs/install.md`): cria sozinho todos os Docker secrets (banco, chave mestra,
   WhatsApp, Traefik, métricas, agente) e o seu acesso ao Super Admin.
3. **Guarde a chave mestra** fora do servidor (comando abaixo).
4. No painel, em **Credenciais**: Focus NFe, OpenRouter, Resend e Asaas (as necessárias); PagBank,
   Backblaze B2 e GitHub, se for usar.

## Cadastradas pelo painel

| Credencial | Necessária? | Onde conseguir |
| --- | --- | --- |
| **Focus NFe · Token Master** | sim (nota fiscal) | [focusnfe.com.br](https://focusnfe.com.br) › Painel API › Tokens › Token Master. A conta precisa do cadastro de empresas pela API liberado (plano para software house). [Guia da Focus](https://doc.focusnfe.com.br/docs/como-cadastrar-uma-empresa) |
| **OpenRouter · chave dos restaurantes** | sim (assistente de IA) | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys), com créditos em [Credits](https://openrouter.ai/settings/credits). Os sites com IA do comandou.com também gastam desta chave (desde a 0.171 não há chave própria dos sites) |
| OpenRouter · chave do sistema (esteira) | não (sem ela, a esteira gasta da dos restaurantes, com aviso) | a mesma página: crie uma chave só para o Comandou (ex.: "Comandou sistema") com limite de gasto. Paga a esteira de chamados e os testes do painel, e o gasto aparece separado em Chamados › Uso de IA e na conta do OpenRouter. Os links "cadastrar a chave do sistema" de Chamados e Tokens de IA abrem o cartão com o campo piscando |
| OpenRouter · chave de gerenciamento (saldo) | não | [Management Keys](https://openrouter.ai/settings/management-keys); só lê o saldo da conta (`/credits`), nunca chama a IA. Sem ela, Tokens mostra só o que sobra no limite da chave |
| **Resend · chave de envio** | sim (todo e-mail) | [resend.com/domains](https://resend.com/domains) (verifique o domínio) e [API Keys](https://resend.com/api-keys) com *Sending access*. Remetente em Super Admin › E-mail |
| **Asaas · chave da API** | sim (mensalidade) | [Integrações › Chaves de API](https://www.asaas.com/customerApiAccessToken/index) (sandbox em sandbox.asaas.com). Depois **Cadastrar webhook no Asaas** no mesmo cartão |
| PagBank · token, conta e aplicação | não (pagamento pelo app) | [acesso.pagbank.com.br](https://acesso.pagbank.com.br) › Venda online › Integrações › Gerar token; split e Connect liberados pelo comercial. Depois **Criar aplicação no PagBank** |
| Backblaze B2 · bucket | recomendado | [Buckets](https://secure.backblaze.com/b2_buckets.htm) (privado) e [Application Keys](https://secure.backblaze.com/app_keys.htm) (Read and Write, só o bucket) |
| iFood, Keeta, 99Food, Rappi, aiqfome, Open Delivery · aplicativo do Comandou | não | Client ID e Client Secret de cada aplicativo: iFood no [Portal do Desenvolvedor](https://developer.ifood.com.br) (modo centralizado ou distribuído), 99Food na [Plataforma Aberta](https://developer-food.99app.com/pt-BR/openapi), Keeta no [portal da Keeta](https://api-docs.mykeeta.com/apis/opendelivery), Rappi no [Rappi Developers](https://dev-portal.rappi.com/) (mais o segredo do webhook), aiqfome no [portal do desenvolvedor](https://developer.aiqfome.com/) (mais a Redirect URI). Guia de cada um em [delivery-apps.md](delivery-apps.md) |
| Outros aplicativos Open Delivery | não | nome, endereço HTTPS da API, Client ID e Client Secret que o aplicativo deu ao Comandou (Software Service, Open Delivery V1); cada um vira um canal `od-<nome>` |
| GitHub · token da esteira | não | [fine-grained token](https://github.com/settings/personal-access-tokens/new): Contents e Pull requests *Read and write*, Actions *Read-only* |

### Focus NFe: o que é seu e o que é do restaurante

O Comandou trabalha como revenda da Focus (ADR 0012). **Você** cadastra só o Token Master da sua
conta. **Cada restaurante**, em Fiscal › Configuração › Empresa › *Cadastro pelo Comandou*, envia o
certificado digital A1 (.pfx e senha), o CSC da SEFAZ e a inscrição estadual; o Comandou cria a
empresa na Focus (`POST /v2/empresas`) com o seu token e guarda os tokens de homologação e
produção dela, cifrados. Os endereços da Focus já vêm prontos.

O token salvo no painel (tabela `platform_credentials`, migração 0082) vale na hora em todas as
réplicas (cache de 30 s). Sem ele, a API usa a variável antiga `FOCUS_NFE_MASTER_TOKEN`, então uma
instalação que já usava a variável continua funcionando sem fazer nada.

### Aplicativos de delivery

Cada aplicativo de delivery tem um cartão no painel (`platform_credentials`, nomes `channel_<id>`,
JSON cifrado com o Client ID, o Client Secret, o modo do iFood e o segredo do webhook quando o
aplicativo usa um diferente). Vale na hora em todas as réplicas (cache de 30 s). Salvar de novo
sem preencher o segredo do webhook ou o endereço da API mantém os que já estavam salvos (só o
Client Secret é sempre pedido). O iFood ainda
aceita `IFOOD_CLIENT_ID`/`IFOOD_CLIENT_SECRET`/`IFOOD_APP_MODE` do servidor como reserva: o cartão
mostra "vindo do servidor" até você salvar no painel. O token de cada loja (iFood distribuído e
aiqfome) fica no banco do restaurante, cifrado com o contexto da loja (ADR 0015).

O que vai fora do Comandou, em cada aplicativo:

- **Rappi**: os 5 endereços de webhook (`https://admin.<domínio>/api/v1/platform/channels/webhooks/rappi/`
  + `new-order`, `cancel`, `other`, `ping`, `store`) com o mesmo segredo salvo no cartão.
- **aiqfome**: a Redirect URI `https://admin.<domínio>/api/v1/platform/channels/oauth/aiqfome/callback`
  no aplicativo de integração.
- **99Food**: o vínculo de cada loja ao app do Comandou (app_shop_id = número da loja).
- **Outros Open Delivery**: o cadastro do Comandou como Software Service no aplicativo.

Como ligar cada um e os problemas comuns: [delivery-apps.md](delivery-apps.md).

## Criadas pelo instalador (Docker secrets)

| Secret | Para que serve |
| --- | --- |
| `comandou_integrations_key` | **Chave mestra**: cifra as chaves do painel, os tokens de cada restaurante e os backups |
| `comandou_pg_password`, `comandou_owner_password`, `comandou_app_password`, `comandou_platform_password`, `comandou_db_*_url` | Senhas e endereços do PostgreSQL |
| `comandou_platform_admin_password`, `comandou_platform_admin_totp` | Seu acesso ao Super Admin (esqueceu: `scripts/admin-reset.sh`) |
| `comandou_wa_gateway_token`, `comandou_wa_session_key` | WhatsApp: API ↔ gateway e as sessões (perder a segunda obriga a ler o QR de novo) |
| `comandou_traefik_provider_token` | Lista de endereços e HTTPS pelo Traefik |
| `comandou_metrics_token` | `/api/v1/metrics` (Prometheus) |
| `comandou_agent_token` | Agente do servidor (Atualizar, reiniciar, logs) |
| `comandou_crowdsec_bouncer_key` | CrowdSec, criado por `scripts/crowdsec.sh` |

Copiar a chave mestra para guardar fora do servidor:

```bash
docker exec $(docker ps -q -f label=com.docker.swarm.service.name=comandou_api | head -1) \
  cat /run/secrets/comandou_integrations_key
```

## Você informa no servidor (`/etc/comandou/deploy.env`)

Depois de mudar, rode o instalador de novo (`sudo bash /opt/comandou/scripts/install.sh`): ele
mantém tudo o que já existe.

| Variável | Quando |
| --- | --- |
| `IFOOD_CLIENT_ID`, `IFOOD_CLIENT_SECRET`, `IFOOD_APP_MODE` | Só reserva: o lugar do iFood agora é Super Admin › Credenciais (acima) |
| `UPDATE_GITHUB_TOKEN` | Repositório privado: o painel acha as versões novas (Contents *Read-only*) |
| `GHCR_USER`, `GHCR_TOKEN` (e `GITHUB_TOKEN` na instalação) | Imagens privadas no GHCR (token clássico com `read:packages`) |
| `COMANDOU_ACME_EMAIL` | Avisos do Let's Encrypt, quando o instalador instala o Traefik |
| `CROWDSEC_ENROLL_KEY` | Opcional, para ver os ataques em [app.crowdsec.net](https://app.crowdsec.net) |

## No GitHub (só para o workflow manual "Deploy (produção)")

Em *Settings › Secrets and variables › Actions*: `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`
(`ssh-keyscan -H <ip>`), `DEPLOY_HOST`, `DEPLOY_USER` e a variável `DEPLOY_PATH` (padrão
`/opt/comandou`). O botão Atualizar do painel não precisa disso.

## Cada restaurante cadastra no sistema dele

Certificado A1, CSC e inscrição estadual (Fiscal › Configuração › Empresa), a conta PagBank (Loja
online › Pagamentos), o WhatsApp (QR Code) e as lojas dos aplicativos de delivery (Sistema ›
Aplicativos de delivery: iFood pelo cardápio, aiqfome pelo ID Magalu, os outros pelo código da
loja).
