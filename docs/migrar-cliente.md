# Migrar um cliente para outro servidor

Painel Super Admin → **Infraestrutura → Migrações** (desde a 0.95.0). Leva um restaurante
**inteiro** para outra instalação do Comandou num servidor novo: o banco dele (pedidos, caixa,
cardápio, fotos, clientes, equipe, auditoria), o cadastro na plataforma, os domínios próprios, o
perfil, a assinatura (o plano é achado pelo código), a configuração de IA e o cartão da cobrança.
É o nível 3 do [ADR 0011](decisions/0011-banco-dedicado-por-cliente.md), na ideia do "Movimento
de Site" do Frappe (um site sai de um bench e vai para outro, em fases).

Para só trocar o **servidor Postgres** de um restaurante (a mesma instalação, outro banco), use
[servidores de banco](servidores-de-banco.md).

## Termos

| Termo | O que é |
| --- | --- |
| Origem | A instalação onde o restaurante está hoje (este painel) |
| Stack de destino | Outra instalação do Comandou, em outro servidor, com o próprio painel `https://admin.<domínio de lá>` |
| Token de recebimento | Gerado no painel de destino; só com ele a origem consegue mandar um restaurante |
| Pacote | O `pg_dump` do banco do restaurante, com tamanho e sha256, enviado em blocos de 4 MB |

## Preparar o servidor novo

1. Instale o Comandou no servidor novo com `scripts/install.sh` e o domínio de lá.
2. Use **a mesma `INTEGRATIONS_KEY`** da origem (secret `comandou_integrations_key`). Ela cifra os
   tokens do fiscal, do WhatsApp, do iFood e dos cartões; com outra chave eles não abrem lá. A
   tela de Migrações mostra a impressão da chave dos dois lados para conferir.
3. Painel de lá → Infraestrutura → Migrações → **Receber restaurantes**. O token aparece uma vez:
   copie.
4. Painel daqui → **Nova stack**: nome, endereço do painel de lá e o token. A conferência mostra
   versão, domínio, se a chave é a mesma, se o serviço de backup de lá está vivo e se lá existem
   todas as migrações daqui (o destino precisa estar na mesma versão ou mais nova).

## Migrar

**Migrar cliente** → restaurante, stack, tipo e opções:

- **Mover** (padrão): o restaurante passa a rodar lá. **Só copiar**: fica uma cópia **suspensa**
  lá, para conferir; aqui nada muda.
- **Endereço no destino**: vazio mantém o mesmo; preencha se lá já existir um igual.
- **Backup de segurança antes**, **deixar suspenso no destino** e **apagar o banco daqui no fim**
  (com backup final; sem marcar, o banco fica guardado aqui, sem acesso).

O restaurante precisa ter banco próprio (os antigos, ainda no banco central, passam antes por
"Mover para banco próprio" na aba Banco).

## As fases

Quem executa é o serviço de backup (`comandou-backup`) dos dois lados, pela fila
`tenant_db_jobs` (trabalhos `migrate` aqui e `receive` lá). A tela mostra cada fase com início,
fim e detalhe, e o pacote com tamanho, sha256 e blocos enviados.

| Fase | O que acontece |
| --- | --- |
| preparar | Confere o destino (token, versão, chave, serviço de backup, endereço livre). No modo Mover, põe o restaurante em manutenção e espera as conexões terminarem. Backup de segurança (opcional). Conta as linhas de cada tabela, gera o pacote (`pg_dump`) e abre o recebimento lá |
| enviar | Manda o pacote em blocos de 4 MB. Uma falha de rede tenta de novo o mesmo bloco |
| criar | Lá: junta os blocos, confere tamanho e sha256, cria o cadastro (mesmo id do restaurante) e um banco vazio no servidor de banco que recebe restaurantes novos |
| restaurar | Lá: `pg_restore`, aplica as migrações da versão de lá e confere as contagens. No modo Mover, uma tabela com menos linhas que aqui cancela tudo |
| virar | Lá o restaurante é liberado. Aqui ele vira `migrated` e o endereço antigo responde "mudou de endereço" com o endereço novo: o site leva cada página para o mesmo caminho lá |
| encerrar | Modo Mover: apaga o banco daqui se pedido (com backup final). Modo Cópia: deixa a cópia pronta e suspensa lá |

**Falhou antes da virada?** O destino apaga o banco e o cadastro que criou, e o restaurante volta
a funcionar aqui como estava. As fases já feitas aparecem como "desfeita" e o erro fica na
migração. Depois da virada, uma falha na limpeza vira só um aviso. Se o serviço de backup
reiniciar no meio, a migração recomeça do zero (o que ficou pela metade lá é desfeito) ou, se lá
o restaurante já estava liberado, só completa a virada aqui.

## Depois da virada

- **Endereço**: `<endereço>.<domínio de lá>`. Se os dois servidores usam o **mesmo domínio**, o
  DNS do subdomínio do restaurante precisa apontar para o servidor novo (até lá a tela "mudou de
  endereço" aparece aqui).
- **Domínios próprios** do restaurante vão junto no cadastro, mas o DNS deles precisa apontar para
  o servidor novo.
- **WhatsApp (QR)**: a sessão fica no gateway daqui; leia o QR de novo no servidor novo.
- **Histórico da plataforma** (faturas, contratos, chamados, auditoria) fica aqui. Desde a
  0.245.1 o cartão automático daqui não cobra mais um restaurante migrado (quem cobra é o servidor
  novo). Faturas que ficaram em aberto aqui: cancele em Cobrança, para o cliente não receber a
  mesma mensalidade dos dois lados.
- **Versão**: lá o banco chega com todas as migrações de lá, então o restaurante passa a
  acompanhar o sistema de lá (a versão presa daqui não vai junto; antes ela fazia o migrate de lá
  pular o banco dele nas atualizações seguintes).
- **Domínio diferente**: o app Comandou Impressão do restaurante e os webhooks da Rappi
  apontam para o endereço daqui; com outro domínio, configure de novo lá. Credenciais dos
  aplicativos de delivery e do PagBank são da instalação: cadastre as mesmas no painel de lá.

## Rotas (para quem mantém)

O destino aceita, só em `admin.<domínio>` e com `Authorization: Bearer <token>`:

| Rota | Para quê |
| --- | --- |
| `GET /api/v1/platform/receive/hello` | Versão, domínio, migrações, impressão da chave, serviço de backup |
| `GET /api/v1/platform/receive/check?slug=&tenantId=` | Endereço e id livres |
| `POST /api/v1/platform/receive` | Abre o recebimento com o manifesto (tamanho, sha256, blocos, migrações, contagens, cadastro) |
| `PUT /api/v1/platform/receive/:id/chunks/:n` | Um bloco (`application/octet-stream`) |
| `GET /api/v1/platform/receive/:id` | Situação, blocos recebidos, passo e fase de lá |
| `POST /api/v1/platform/receive/:id/install` · `activate` · `discard` | Instalar, liberar, desfazer |

Tabelas: `platform_stacks` e `tenant_migrations` (origem); `platform_receiver`,
`tenant_receptions` e `tenant_reception_chunks` (destino). Migração `0052_migrar_cliente.sql`.
Código: `apps/api/src/backup/migration-jobs.ts` (fases), `apps/api/src/migration/` (protocolo e
cadastro), `apps/api/src/platform/platform-migrations.service.ts` e `platform-receive.service.ts`.
Teste: `apps/api/test/migrar-cliente.int.test.ts` (duas instalações no mesmo Postgres).
