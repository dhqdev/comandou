# Instalação

Três jeitos, do mais simples ao mais manual. Todos usam as mesmas imagens (AMD64 e ARM64, o Docker
escolhe a certa) e criam o Super Admin com o e-mail e a senha que você informar.

> Estado (v0.66.1): instalação do zero e atualização testadas de ponta a ponta num Swarm de um
> nó com Docker 29 (perguntas pelo terminal, Traefik, segredos, migrações, demonstrações, login do
> Super Admin com autenticador, backup antes de atualizar). Testado em AMD64; ARM64 usa as mesmas
> imagens multiarquitetura.

## Antes de começar

- Um servidor Linux (Ubuntu ou Debian), 4 GB de memória ou mais, com as portas 80 e 443 abertas.
- Um domínio com DNS apontando para o IP do servidor: registros **A** para `@`, `*` (e `admin`, se
  não usar o `*`).
- Um bucket no Backblaze B2 (ou outro S3) para os backups diários; ele é configurado depois, no
  painel Super Admin → Credenciais.
- Depois da primeira subida, abra **Super Admin → Credenciais**: ela lista todas as chaves que o
  sistema usa (Focus NFe, OpenRouter, Resend, Asaas…), o que ainda falta e como conseguir cada
  uma. Lista completa também em [credenciais.md](credenciais.md).

## 1. Um comando (recomendado)

Funciona com o repositório privado e sem token: o instalador vem dentro da imagem pública
`ghcr.io/dhqdev/comandou-web` e é servido por qualquer Comandou no ar, no endereço `/instalar`.

**Do seu computador (Windows, Mac ou Linux), entre no servidor por SSH.** No Windows use o
PowerShell ou o Terminal (o `ssh` já vem no Windows 10 e 11); no Mac e no Linux, o Terminal:

```bash
ssh usuario@IP-DO-SERVIDOR
```

**No servidor (Ubuntu ou Debian, AMD64 ou ARM64), rode:**

```bash
curl -fsSL https://admin.comandou.com/instalar | sudo bash
```

Ou tudo de uma vez, direto do seu computador (o `-t` deixa o instalador fazer as perguntas):

```bash
ssh -t usuario@IP-DO-SERVIDOR "curl -fsSL https://admin.comandou.com/instalar | sudo bash"
```

Se ainda não existe nenhum Comandou no ar para servir o `/instalar`, e o servidor já tem Docker:

```bash
docker run --rm ghcr.io/dhqdev/comandou-web:latest cat /opt/comandou-instalador/scripts/get.sh | sudo bash
```

O comando acha a última versão publicada nas imagens, copia o instalador para `/opt/comandou` e
roda o instalador, que:

1. instala o Docker se faltar e liga o Swarm de um nó só (pede confirmação);
2. instala um Traefik com HTTPS automático se o servidor não tiver um;
3. pergunta o domínio, o e-mail e a senha do Super Admin;
4. gera sozinho todos os outros segredos, como Docker secrets (nada de senha em arquivo ou log);
5. mostra **uma vez**, só no terminal, a chave do aplicativo autenticador (e um QR Code, se
   `qrencode` estiver instalado): anote fora do servidor;
6. sobe a stack, espera as migrações e confere a saúde.

Depois entre em `https://admin.<seu domínio>` com o e-mail, a senha e o código do aplicativo.

Atualizar é rodar o mesmo comando de novo (ou o botão **Atualizar sistema** no Super Admin): ele
reaproveita tudo o que já existe e não pergunta de novo. Versão específica:
`sudo COMANDOU_VERSION=v0.66.1 bash` depois do `|` (o instalador vem na imagem a partir da v0.66.1).
Com `GITHUB_TOKEN=<token com leitura de contents>` o código vem do GitHub em vez da imagem.

## 2. Já tenho o repositório (ou quero ler o script antes)

```bash
git clone https://github.com/dhqdev/comandou.git && cd comandou   # repositório privado: precisa de acesso
git checkout v0.66.1   # a versão que você quer
scripts/install.sh
```

## 3. Sem perguntas (automação) ou pelo Portainer

`scripts/install.sh --yes` com as variáveis abaixo (nada é perguntado; falta de variável = erro):

| Variável | O quê |
| --- | --- |
| `COMANDOU_VERSION` | `vX.Y.Z` (padrão: última versão publicada nas imagens) |
| `COMANDOU_BASE_DOMAIN` | domínio do sistema |
| `COMANDOU_ACME_EMAIL` | e-mail do Let's Encrypt (só se instalar o Traefik) |
| `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_NAME` | login e nome do Super Admin |
| `COMANDOU_ADMIN_PASSWORD` ou `COMANDOU_ADMIN_PASSWORD_FILE` | senha (12+ caracteres) |
| `COMANDOU_ADMIN_TOTP_SECRET` | chave do autenticador em base32 (16+ caracteres), obrigatória sem terminal |
| `COMANDOU_BACKUP=off` | sobe sem backup (não recomendado) |
| `COMANDOU_AGENT=off` | sobe sem o agente do servidor e sem o ajudante da VM (abas Servidor e VM do painel ficam sem dados) |
| `COMANDOU_KEEP_DIR=1` | não copia o instalador para `/opt/comandou` quando rodado de outra pasta |
| `COMANDOU_WILDCARD_TLS=1` | certificado coringa `*.domínio` (exige DNS-01 no Traefik) |
| `COMANDOU_CROWDSEC=1` | inclui o bloqueio do CrowdSec (gravado por `scripts/crowdsec.sh`; ver [crowdsec.md](crowdsec.md)) |
| `CROWDSEC_TRUSTED_IPS` | IPs que o CrowdSec nunca bloqueia, separados por vírgula |
| `COMANDOU_DEMO` | restaurante de demonstração: `true` (padrão, cria uma vez), `reset` (recria a cada subida) ou `false` |
| `COMANDOU_DEMO_SLUG` | endereço da Fumaça Burger (padrão `fumaca` → `fumaca.domínio`) |

**Portainer / `docker stack deploy` na mão:** crie os Docker secrets de
[deploy.md](deploy.md#secrets) (inclui os dois do Super Admin, abaixo), defina as variáveis da
stack (`COMANDOU_VERSION`, `COMANDOU_BASE_DOMAIN`, `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_NAME`,
`BACKUP_S3_*`) e aplique `infrastructure/swarm/comandou-stack.yml`. O serviço `migrate` cria o
Super Admin no primeiro deploy.

## Restaurante de demonstração

Junto com o sistema sobe a **Fumaça Burger & Co.** (`https://fumaca.<domínio>`), uma hamburgueria
artesanal fictícia na Vila Mariana que usa o sistema **há um ano**, com **fotos reais** em todos os
itens e logo própria. Tem tudo preenchido: 35 itens em 6 categorias com adicionais, ficha técnica,
galeria de fotos e avaliações dos clientes; ~18 mil pedidos em 12 meses (mesa, balcão, entrega e
retirada), crescendo mês a mês e com pico em dezembro; caixa todo dia, financeiro de 12 meses,
estoque com notas, lotes, produção e itens abaixo do mínimo; fidelidade, reservas, conversas da
equipe e da loja online; entregadores com repasse e GPS; regras fiscais e notas de homologação.

- **WhatsApp:** avisos ligados (aceito, pronto, saiu, entregue e cancelado) com os textos da casa,
  histórico de mensagens enviadas e o atendente IA "Fumacinha" respondendo no WhatsApp. Para enviar
  de verdade, conecte um número em *Configurações › WhatsApp* (QR Code).
- **Super Admin:** cadastro, assinatura de 12 meses no plano Comandou com as faturas, conversa com o
  suporte e chamados resolvidos; se os dados da contratada estiverem em *Contrato*, o contrato já
  vem assinado pelo cliente, esperando a contra-assinatura.
- É criada uma vez (banco próprio `comandou_fumaca`); subir de novo **não** duplica nem apaga o
  que você mexeu. Para começar do zero, suba uma vez com `COMANDOU_DEMO=reset`.
- As demonstrações antigas (Casa Brasa em `exemplo.` e Aurora em `aurora.`) são removidas na
  subida. Um restaurante de verdade com o mesmo endereço nunca é tocado.
- Senha de todos os usuários: `comandou123`. E-mails: `dono@` (Thiago Ferraz), `gerente@`,
  `caixa@`, `garcom@`, `garcom2@`, `cozinha@`, `entregador@`, `entregador2@` e
  `atendente@fumaca.<domínio>`. Cliente do cardápio online: Ana Almeida, `(11) 97100-0000`, senha
  `cliente123`.
- As fotos vêm do Open Images (Flickr, licença CC BY 2.0); autor e link de cada uma estão em
  `apps/api/db/demo/fumaca/credits.json`. Para trocar: `tools/demo-images/fumaca`.

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
