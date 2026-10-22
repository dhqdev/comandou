# Backups e restauração

> Testado localmente com destino em arquivo e com um emulador S3. Ainda **não** rodou contra um
> bucket real do Backblaze B2 nem em produção.

## O que roda

O serviço `backup` da stack (imagem `pedemais-backup`, usuário `postgres`, sem root) executa
`infrastructure/backup/scheduler.sh`:

| Trabalho | Quando (padrão da stack, UTC) | Script |
| --- | --- | --- |
| Backup | todo dia às `BACKUP_AT` (06:00 = 03:00 em Brasília) | `backup.sh` |
| Teste de restauração | no dia `RESTORE_TEST_WEEKDAY` (7 = domingo) às `RESTORE_TEST_AT` (08:00) | `restore-test.sh` |
| Backup antes do deploy | a cada `scripts/install.sh` | `backup.sh` via `docker exec` |

Cada execução grava uma linha em `backup_runs` (início, fim, status, arquivo, tamanho, sha256,
erro) e aparece no painel Super Admin (Visão geral e Backups). O painel alerta quando o último
backup bom tem mais de 26 h ou o último teste bom mais de 8 dias.

## Backup

1. Anota contagens (restaurantes, pedidos, pagamentos, migrações) antes e depois do dump.
2. `pg_dump --format=custom` com a conexão do dono.
3. Confere que o arquivo é legível (`pg_restore --list`).
4. Cifra com [age](https://age-encryption.org) para o destinatário derivado da identidade
   (`pedemais_backup_age_identity`); o arquivo em claro é apagado logo em seguida.
5. Envia para `s3://$S3_BUCKET/$S3_PREFIX/AAAA/MM/pedemais-<data>.dump.age` e confere o tamanho no
   bucket.

O serviço **não apaga** backups. A retenção é uma regra de ciclo de vida no bucket, por exemplo no
B2: *Lifecycle Settings → Keep prior versions for N days* ou uma regra customizada para o prefixo
`pedemais/` com `daysFromUploadingToHiding: 35` e `daysFromHidingToDeleting: 1`. A chave de
aplicação do B2 pode ter só `listFiles`, `readFiles` e `writeFiles` nesse bucket (sem
`deleteFiles`).

## Teste de restauração

Baixa o último backup bom (ou `RESTORE_KEY`), confere o sha256, decifra, cria um Postgres
**temporário dentro do contêiner** (`initdb`, porta local), restaura e confere:

- a última migração e o número de migrações iguais aos do momento do backup;
- restaurantes, pedidos e pagamentos entre as contagens de antes e de depois do dump.

Nunca toca o banco de produção. No fim apaga o cluster temporário.

Rodar à mão:

```bash
docker exec $(docker ps -q -f label=com.docker.swarm.service.name=pedemais_backup) \
  /opt/pedemais-backup/restore-test.sh
```

## Chave do age

```bash
age-keygen 2>/dev/null | docker secret create pedemais_backup_age_identity -
```

Guarde uma cópia da identidade **fora do servidor** (cofre de senhas). Sem ela os backups são
ilegíveis. A chave pública pode ser vista com `age-keygen -y <arquivo>`.

## Restaurar de verdade (desastre)

Restaurar sobre o banco de produção é uma operação destrutiva: exige autorização explícita e deve
ser feita num banco novo, trocando a conexão depois de conferir.

```bash
# 1. Baixar e decifrar numa máquina segura
aws --endpoint-url "$S3_ENDPOINT" s3 cp "s3://$S3_BUCKET/<chave>" db.dump.age
sha256sum db.dump.age   # comparar com backup_runs.sha256 ou com o metadado sha256 do objeto
age --decrypt --identity identidade.txt --output db.dump db.dump.age

# 2. Os papéis pedemais_owner, pedemais_app e pedemais_platform já devem existir no servidor novo
#    (infrastructure/docker/postgres-init/01-roles.sh)
createdb -O pedemais_owner pedemais_restore
pg_restore --exit-on-error -d pedemais_restore db.dump

# 3. Conferir contagens, apontar os secrets *_url para o banco novo e reiniciar a stack
shred -u db.dump
```
