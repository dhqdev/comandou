# Backups e restauração

> Testado com o banco real e um bucket S3 falso (assinatura conferida com os exemplos da AWS), e
> com a imagem do serviço rodando de verdade. Ainda **não** rodou contra um bucket real do
> Backblaze B2: o primeiro "Testar conexão" no painel confirma.

## O que é salvo

O **banco inteiro**, de uma vez: todos os restaurantes, pedidos, pagamentos, clientes, cadastros,
configurações, auditoria e as **fotos** (ficam no próprio banco, tabela `media`). As sessões do
WhatsApp por QR Code não entram: se o servidor for perdido, basta ler o QR de novo.

## Configurar (painel Super Admin → Backups)

1. No Backblaze: **Buckets → Create a Bucket** (privado). Copie o **Endpoint** do bucket
   (ex.: `https://s3.us-west-004.backblazeb2.com`). Em **Lifecycle Settings**, escolha
   *Keep only the last version of the file*.
2. **Application Keys → Add a New Application Key**: só esse bucket, *Read and Write*. Copie o
   **keyID** e a **applicationKey** (aparece uma vez).
3. No painel: endereço, bucket, keyID e applicationKey → **Testar conexão** (grava, confere, lista
   e apaga um arquivo de teste) → marque **Backup ligado** → **Salvar**.

A applicationKey é cifrada com a `INTEGRATIONS_KEY` (AES-256-GCM) antes de ir para o banco
(`platform_backup_settings`). O painel nunca a devolve e a auditoria só registra que ela mudou.

| Opção | Padrão | O que faz |
| --- | --- | --- |
| Horário (Brasília) | 03:00 | backup diário; o primeiro sai logo depois de ligar |
| Guardar por (dias) | 30 | apaga do bucket os backups mais velhos, guardando sempre os 3 últimos; 0 = nunca apaga |
| Teste de restauração | domingo | 2 h depois do backup; "Nunca" desliga |
| Pasta no bucket | `comandou` | arquivos em `<pasta>/AAAA/MM/comandou-<data>.dump.enc` |

Botões **Fazer backup agora** e **Testar restauração** pedem ao serviço, que começa em até 15 s.

## O serviço

`backup` na stack (imagem `comandou-backup`: Postgres 16 + Node, usuário `postgres`, sem root),
com `DATABASE_OWNER_URL` e a **mesma** `INTEGRATIONS_KEY` da API, nas redes interna e de saída.
A cada 15 s avisa que está vivo (o painel mostra "Serviço de backup parado" se não), lê a
configuração e roda o que estiver na hora. Uma execução por vez no servidor (trava no banco).

Backup:

1. Anota contagens (restaurantes, pedidos, pagamentos, fotos, migrações) antes e depois.
2. `pg_dump --format=custom` com a conexão do dono e confere que é legível (`pg_restore --list`).
3. Cifra (AES-256-GCM, chave derivada da `INTEGRATIONS_KEY` com sal por arquivo); o arquivo em
   claro é apagado logo em seguida.
4. Envia ao bucket com o sha256 nos metadados e confere o tamanho lá.
5. Aplica a retenção. Sem permissão de apagar, o backup não falha: o aviso fica em `details`.

Teste de restauração: baixa o último backup bom, confere o sha256, decifra, cria um Postgres
**temporário dentro do contêiner** (`initdb`), restaura e confere migrações, contagens e as
políticas de RLS. Nunca toca o banco de produção.

Cada execução vira uma linha em `backup_runs` (painel → Backups → Histórico, com quem disparou).
O painel alerta quando o último backup bom tem mais de 26 h ou o último teste mais de 8 dias.

## Linha de comando (dentro do contêiner)

```bash
B=$(docker ps -q -f label=com.docker.swarm.service.name=comandou_backup)
docker exec $B node dist/backup/backup-cli.js run            # backup agora
docker exec $B node dist/backup/backup-cli.js restore-test   # teste de restauração agora
docker exec $B node dist/backup/backup-cli.js list           # backups no bucket
```

O `install.sh` roda `run --deploy` antes de atualizar e cancela a atualização se falhar (sem
bucket configurado, só avisa).

## A chave

Os arquivos só abrem com a `INTEGRATIONS_KEY` da stack. **Guarde uma cópia dela fora do
servidor** (cofre de senhas). Sem ela os backups são ilegíveis.

## Restaurar de verdade (desastre)

Restaurar sobre o banco de produção é destrutivo: exige autorização explícita e deve ser feito
num banco novo, trocando a conexão depois de conferir.

```bash
# 1. Baixar e decifrar (no contêiner de backup, ou em qualquer máquina com a imagem)
docker exec $B node dist/backup/backup-cli.js download comandou/2026/10/comandou-<data>.dump.enc /work/db.dump
#    Arquivo baixado à mão do site do B2:
#    INTEGRATIONS_KEY=... node dist/backup/backup-cli.js decrypt arquivo.dump.enc db.dump

# 2. Os papéis comandou_owner, comandou_app e comandou_platform já devem existir no servidor novo
createdb -O comandou_owner comandou_restore
pg_restore --exit-on-error -j 4 -d comandou_restore db.dump

# 3. Conferir contagens, apontar as conexões para o banco novo e reiniciar a stack; apagar db.dump
```

## Ensaios

**2026-10-22** (versão anterior, mesmo método), máquina de desenvolvimento, 16 restaurantes e
1.005.983 pedidos (1,1 GB): backup 17 s (arquivo de 139 MB), teste de restauração 41 s,
restauração de desastre com `-j 4` 14 s. RTO estimado: menos de 15 minutos. RPO: até 24 h
(backup diário).
