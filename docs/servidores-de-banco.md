# Servidores de banco e troca de servidor

Painel Super Admin → **Bancos**. Cada restaurante tem o próprio banco Postgres
(`comandou_<endereço>`, [ADR 0011](decisions/0011-banco-dedicado-por-cliente.md)). Desde a 0.62.0
esse banco pode ficar em **outro servidor Postgres** (outra VM, outro nó do Swarm ou um Postgres
gerenciado) e mudar de servidor com um clique: um restaurante por vez ou todos de uma vez.

## O que roda separado hoje

| Peça | Onde | Separado por restaurante? |
| --- | --- | --- |
| Banco central `comandou` | servidor principal | não: cadastros, domínios, planos, assinaturas, painel, backups e o registro de onde fica cada banco |
| Banco de cada restaurante `comandou_<endereço>` | servidor principal **ou** um servidor extra | **sim**: pedidos, caixa, cardápio, clientes, equipe, fotos, auditoria. Mesmas migrações e RLS |
| API (`api`, 2 réplicas) | Swarm | não: a mesma API atende todos e escolhe o banco pelo endereço do restaurante (`RegistryDatabaseRouter`) |
| Serviço de backup (`backup`) | Swarm | não: um serviço, mas um backup **por banco**, cada um na pasta do restaurante; é ele que cria, copia e apaga bancos |
| WhatsApp (`whatsapp-gateway`) | Swarm | uma sessão cifrada por restaurante no mesmo serviço |
| Redis, web, migrate, agente | Swarm | não |

Restaurantes antigos (de antes da 0.19) podem ainda estar no banco central: o painel mostra
quantos e o botão **Mover para banco próprio** do restaurante já leva para o servidor escolhido.

## Ideias do Frappe que o Comandou segue

O Frappe organiza tudo em *sites*: cada site tem o próprio banco, um `site_config.json` dizendo
onde ele está (`db_host`) e comandos do `bench` para criar, migrar, fazer backup e restaurar site
por site. A comparação:

| Frappe | Comandou | Desde |
| --- | --- | --- |
| Um banco por site | Um banco por restaurante (`comandou_<endereço>`) | 0.19 |
| `bench new-site` | Painel → Novo restaurante (fila `tenant_db_jobs`, trabalho `create`) | 0.19 |
| `bench migrate` em todos os sites | `migrate-cli`: central primeiro, depois cada banco registrado | 0.19 |
| `bench --site x backup` | Backup diário por banco, cifrado, pasta `restaurantes/<endereço>/` | 0.19 |
| `bench drop-site` (com backup antes) | Excluir restaurante: backup final em `final/`, nunca apagado | 0.19 |
| `db_host` no `site_config.json` | `tenant_databases.server_id` → `platform_db_servers` (endereço, porta, SSL) | **0.62** |
| `bench new-site --db-host` | Servidor marcado "restaurantes novos aqui" | **0.62** |
| `bench backup` + `bench restore` em outro servidor | **Trocar de servidor**: cópia direta, conferida, sem arquivo no meio, com backup antes | **0.62** |
| Mover vários sites de servidor | **Mover todos**: um por vez, cada um parado só durante a própria cópia | **0.62** |
| Mover um site para outro bench/servidor (Movimento de Site) | **Migrar cliente** para outra instalação, em fases ([migrar-cliente.md](migrar-cliente.md)) | **0.95** |

Diferenças de propósito: no Comandou nenhuma senha de banco fica gravada (os servidores extras
usam os mesmos papéis e senhas do principal) e a troca é feita pelo serviço de backup, não pela
API, que nunca tem a conexão do dono.

## Preparar um servidor novo (Swarm)

1. Na VM nova: `docker swarm join ...` (o comando sai de `docker swarm join-token worker` no
   manager).
2. No manager: `docker node update --label-add comandou.db=2 <nó novo>`.
3. Suba a stack com o arquivo extra:
   `docker stack deploy -c infrastructure/swarm/comandou-stack.yml -c infrastructure/swarm/db-server.yml comandou`.
   No Portainer, cole o serviço `postgres-2` e o volume `comandou_pgdata2` no fim da stack.
   Ele usa o mesmo `01-roles.sh` e os mesmos secrets: papéis e senhas iguais aos do principal.
4. Painel → **Bancos** → **Novo servidor**: nome, endereço `postgres-2`, porta `5432`, sem SSL.
   Em até um minuto o cartão mostra "ok" (o serviço de backup conferiu o papel dono e a API
   conferiu os papéis da aplicação e do painel).

## Postgres fora do Swarm (outra nuvem, gerenciado)

Crie os papéis com **as mesmas senhas** dos secrets `comandou_owner_password`,
`comandou_app_password` e `comandou_platform_password`:

```sql
CREATE ROLE comandou_owner LOGIN PASSWORD '...' CREATEDB;
GRANT pg_signal_backend TO comandou_owner;
CREATE ROLE comandou_app LOGIN PASSWORD '...' NOBYPASSRLS;
CREATE ROLE comandou_platform LOGIN PASSWORD '...' NOBYPASSRLS CONNECTION LIMIT 10;
```

Libere a porta só para o IP da VM do Comandou e cadastre com **SSL obrigatório**.

## Trocar de servidor

- **Um restaurante:** Restaurante → Banco → **Trocar de servidor**, ou o ícone de troca na lista
  do servidor em Bancos.
- **Todos:** Bancos → cartão do servidor → **Mover todos**. Cada restaurante entra na fila; o
  serviço de backup faz um por vez.

**Na fila o restaurante segue funcionando** (o painel mostra "na fila"). Ele só sai do ar quando
chega a vez dele: no "Mover todos", cada um fica parado só durante a própria cópia (desde a
0.245.1; antes, todos saíam do ar no clique e esperavam a fila inteira sem acesso).

O que acontece em cada um (trabalho `transfer`, `apps/api/src/backup/db-jobs.ts`):

1. Confere o destino: o servidor ainda está cadastrado e ativo, o dono entra, pode criar bancos e
   os papéis da aplicação existem. Se já houver lá um banco com o mesmo nome **com dados** (o
   mesmo servidor cadastrado com outro endereço, ou sobra de uma mudança antiga), para sem mexer
   em nada. Qualquer falha aqui deixa o restaurante no ar, como estava.
2. O restaurante fica em manutenção (a API responde "em manutenção" e nada é gravado) e espera
   15 s para as conexões em uso terminarem.
3. Com backup ligado, faz um backup do banco na pasta do restaurante.
4. Cria o banco no destino com **as mesmas migrações do banco de origem**: um restaurante preso
   numa versão anterior ([versão por restaurante](versao-por-cliente.md)) continua nela.
5. Copia tudo numa fotografia consistente e confere a contagem de cada tabela (uma transação: ou
   copia tudo, ou nada).
6. Troca o apontamento e libera o restaurante. Só então apaga o banco antigo.

Falhou antes da troca: o banco novo é apagado e o restaurante volta a funcionar onde estava. O
erro aparece no restaurante e em "Mudanças recentes".

**Serviço de backup reiniciado no meio** (uma atualização do sistema, por exemplo): o trabalho
volta para a fila e retoma. Se a troca já tinha acontecido, só apaga o banco antigo (antes ele
ficava esquecido no servidor antigo e travava uma volta futura). Se ainda não, apaga o banco novo
que ele mesmo tinha criado e refaz a cópia.

## Desligar um servidor

**Desativar** (não recebe restaurantes) → **Mover todos** para outro → **Remover** (só com zero
restaurantes; nada é apagado no servidor) → desligue a VM. Uma troca que estava na fila para um
servidor desativado ou removido falha sem tirar o restaurante do ar.

## Limites

- O banco central (`comandou`) continua no servidor principal. Para trocar a VM principal inteira,
  use o backup e o instalador (docs/backups.md, "Restaurar de verdade (desastre)"). Para levar um
  restaurante para outra instalação, veja [migrar-cliente.md](migrar-cliente.md).
- O tempo parado de cada restaurante é o tempo da cópia: segundos para restaurantes comuns,
  alguns minutos para bancos com muitas fotos.
