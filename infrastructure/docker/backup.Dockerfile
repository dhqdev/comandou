# syntax=docker/dockerfile:1.7
# Serviço de backup: pg_dump → age → B2/S3, e teste semanal de restauração num Postgres
# temporário dentro do contêiner. Mesma versão principal do Postgres da stack (16).
# Multiarch (linux/amd64 e linux/arm64).
FROM postgres:16-alpine
RUN apk add --no-cache bash age aws-cli jq coreutils
# Provedores compatíveis com S3 (B2, MinIO) nem sempre aceitam as somas de verificação
# automáticas das versões novas do AWS CLI; só quando a API exige.
ENV AWS_REQUEST_CHECKSUM_CALCULATION=when_required \
    AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    WORK_DIR=/work STATE_DIR=/work
COPY infrastructure/backup/*.sh /opt/comandou-backup/
RUN chmod 0555 /opt/comandou-backup/*.sh && mkdir -p /work && chown postgres:postgres /work
# initdb (teste de restauração) não roda como root.
USER postgres
WORKDIR /work
ENTRYPOINT []
CMD ["/opt/comandou-backup/scheduler.sh"]
