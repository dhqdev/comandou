# Credenciais do Comandou (Super Admin › Credenciais)

Tudo o que o Comandou usa de chave, token ou senha, num lugar só. No painel, a aba
**Credenciais** (`admin.<domínio>/credenciais`) traz este guia inteiro: como funciona, a ordem para
subir o sistema, a situação de cada chave (configurada, faltando ou para conferir fora daqui) e, em
cada cartão, para que serve, o passo a passo, o que vai em cada campo, como saber que deu certo, os
links e, quando ela se cadastra pelo painel, o campo para colar, **Testar** e **Salvar**. Este
arquivo é a mesma lista, para ler antes do painel existir.

As chaves do painel ficam cifradas no banco com a `INTEGRATIONS_KEY` (AES-256-GCM) e nunca voltam
para a tela: depois de salva, aparece só o final dela ("termina em 4f2a"), para saber qual está em
uso. As outras telas (Tokens de IA, Cobrança, Pagamentos pelo app, E-mail, Backups, Site com IA,
Chamados) ficam com os ajustes de cada assunto e uma linha **Chave em uso** (nome, ambiente ou
conta e o final da chave), com o nome levando ao cartão em Credenciais.

Código: `apps/web/src/platform/credentials/` (texto de cada uma em `catalog.tsx`, formulários em
`editors.tsx`) e `apps/api/src/platform/platform-credentials.service.ts`
(`GET /api/v1/platform/credentials`, nunca devolve um valor).

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
| OpenRouter · sua chave | não | a mesma página; separa o gasto do sistema (esteira, testes) |
| OpenRouter · chave de gerenciamento (saldo) | não | [Management Keys](https://openrouter.ai/settings/management-keys); só lê o saldo da conta (`/credits`), nunca chama a IA. Sem ela, Tokens mostra só o que sobra no limite da chave |
| **Resend · chave de envio** | sim (todo e-mail) | [resend.com/domains](https://resend.com/domains) (verifique o domínio) e [API Keys](https://resend.com/api-keys) com *Sending access*. Remetente em Super Admin › E-mail |
| **Asaas · chave da API** | sim (mensalidade) | [Integrações › Chaves de API](https://www.asaas.com/customerApiAccessToken/index) (sandbox em sandbox.asaas.com). Depois **Cadastrar webhook no Asaas** no mesmo cartão |
| PagBank · token, conta e aplicação | não (pagamento pelo app) | [acesso.pagbank.com.br](https://acesso.pagbank.com.br) › Venda online › Integrações › Gerar token; split e Connect liberados pelo comercial. Depois **Criar aplicação no PagBank** |
| Backblaze B2 · bucket | recomendado | [Buckets](https://secure.backblaze.com/b2_buckets.htm) (privado) e [Application Keys](https://secure.backblaze.com/app_keys.htm) (Read and Write, só o bucket) |
| iFood, Keeta, 99Food, Rappi, aiqfome, Open Delivery · aplicativo do Comandou | não | Client ID e Client Secret de cada aplicativo (iFood: [Portal do Desenvolvedor](https://developer.ifood.com.br), com o modo centralizado ou distribuído) |
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
aplicativo usa um diferente). Vale na hora em todas as réplicas (cache de 30 s). O iFood ainda
aceita `IFOOD_CLIENT_ID`/`IFOOD_CLIENT_SECRET`/`IFOOD_APP_MODE` do servidor como reserva: o cartão
mostra "vindo do servidor" até você salvar no painel. O token de cada loja (modo distribuído) fica
no banco do restaurante, cifrado com o contexto da loja (ADR 0015).

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
online › Pagamentos), o WhatsApp (QR Code) e a autorização do iFood.
