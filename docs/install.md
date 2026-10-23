# Instalação

Três jeitos, do mais simples ao mais manual. Todos usam as mesmas imagens (AMD64 e ARM64, o Docker
escolhe a certa) e criam o Super Admin com o e-mail e a senha que você informar.

> Estado: o instalador foi testado aqui com um Docker simulado (fluxo, segredos, ordem dos
> passos). **Não foi executado num servidor real ainda.** Rode primeiro em um servidor de teste.

## Antes de começar

- Um servidor Linux (Ubuntu ou Debian), 4 GB de memória ou mais, com as portas 80 e 443 abertas.
- Um domínio com DNS apontando para o IP do servidor: registros **A** para `@`, `*` (e `admin`, se
  não usar o `*`).
- Um bucket de backup (Backblaze B2 ou outro S3), para os backups cifrados diários.

## 1. Um comando (recomendado)

```bash
curl -fsSL https://raw.githubusercontent.com/dhqdev/comandou/main/scripts/get.sh | sudo bash
```

Baixa a última Release para `/opt/comandou` e roda o instalador, que:

1. instala o Docker se faltar e liga o Swarm de um nó só (pede confirmação);
2. instala um Traefik com HTTPS automático se o servidor não tiver um;
3. pergunta o domínio, o e-mail e a senha do Super Admin e o bucket de backup;
4. gera sozinho todos os outros segredos, como Docker secrets (nada de senha em arquivo ou log);
5. mostra **uma vez**, só no terminal, a chave do aplicativo autenticador (e um QR Code, se
   `qrencode` estiver instalado) e a chave dos backups: anote as duas fora do servidor;
6. sobe a stack, espera as migrações e confere a saúde.

Depois entre em `https://admin.<seu domínio>` com o e-mail, a senha e o código do aplicativo.

Atualizar é rodar o mesmo comando de novo: ele reaproveita tudo o que já existe e não pergunta de
novo. Versão específica: `sudo COMANDOU_VERSION=v0.7.0 bash` depois do `|`. Repositório ou imagens
privados: `GITHUB_TOKEN=<token com leitura de contents e packages>`.

## 2. Já tenho o repositório (ou quero ler o script antes)

```bash
git clone https://github.com/dhqdev/comandou.git && cd comandou
git checkout v0.7.0   # a Release que você quer
scripts/install.sh
```

## 3. Sem perguntas (automação) ou pelo Portainer

`scripts/install.sh --yes` com as variáveis abaixo (nada é perguntado; falta de variável = erro):

| Variável | O quê |
| --- | --- |
| `COMANDOU_VERSION` | `vX.Y.Z` (padrão: última Release) |
| `COMANDOU_BASE_DOMAIN` | domínio do sistema |
| `COMANDOU_ACME_EMAIL` | e-mail do Let's Encrypt (só se instalar o Traefik) |
| `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_NAME` | login e nome do Super Admin |
| `COMANDOU_ADMIN_PASSWORD` ou `COMANDOU_ADMIN_PASSWORD_FILE` | senha (12+ caracteres) |
| `COMANDOU_ADMIN_TOTP_SECRET` | chave do autenticador em base32 (16+ caracteres), obrigatória sem terminal |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `COMANDOU_BACKUP_KEY_ID`, `COMANDOU_BACKUP_APP_KEY` | backup |
| `COMANDOU_BACKUP=off` | sobe sem backup (não recomendado) |
| `COMANDOU_WILDCARD_TLS=1` | certificado coringa `*.domínio` (exige DNS-01 no Traefik) |

**Portainer / `docker stack deploy` na mão:** crie os Docker secrets de
[deploy.md](deploy.md#secrets) (inclui os dois do Super Admin, abaixo), defina as variáveis da
stack (`COMANDOU_VERSION`, `COMANDOU_BASE_DOMAIN`, `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_NAME`,
`BACKUP_S3_*`) e aplique `infrastructure/swarm/comandou-stack.yml`. O serviço `migrate` cria o
Super Admin no primeiro deploy.

## Super Admin

A stack lê `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_NAME` e dois secrets:

```bash
printf '%s' 'uma-senha-com-12-ou-mais-caracteres' | docker secret create comandou_platform_admin_password -
head -c 20 /dev/urandom | base32 | tr -d '=\n' | tee /dev/tty | docker secret create comandou_platform_admin_totp -
```

A segunda linha mostra a chave do autenticador no terminal: cadastre-a no aplicativo (Google
Authenticator, 1Password, Authy; "inserir chave"). O administrador é criado **só se a plataforma
ainda não tem nenhum**. Trocar o secret depois não muda um administrador que já existe.

### Esqueci a senha ou perdi o autenticador

```bash
scripts/admin-reset.sh voce@empresa.com
```

Pede uma senha nova, gera uma nova chave do autenticador (mostrada só no terminal), troca as duas
e encerra as sessões do painel desse administrador. Os navegadores lembrados (que entravam só
com a senha depois do primeiro login com código) voltam a pedir o código. A ação fica na
auditoria da plataforma.
Também não foi executado num servidor real.

## O que o instalador não faz

Não remove serviços, volumes, redes nem secrets, não mexe em Traefik que já existe e não apaga
dados. Ele guarda só valores não secretos em `/etc/comandou/deploy.env` (permissão 600).
Rollback e recuperação: [deploy.md](deploy.md#rollback).
