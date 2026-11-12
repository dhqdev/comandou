# Versão por restaurante

O Super Admin (e o sistema principal: api e web da stack) fica sempre na versão mais nova. Cada
restaurante com banco próprio fica na versão em que está até alguém atualizar ele no painel, em
**Clientes › restaurante › Visão geral › Versão do sistema**: "Atualizar agora" ou "Agendar".

## Como funciona

1. **Atualizar sistema** (Super Admin › Infra › Servidor), antes de trocar qualquer imagem:
   - os restaurantes com banco próprio que acompanhavam o principal ficam presos à versão atual
     (`tenants.app_version`);
   - o agente sobe uma cópia da api e da web nessa versão (`<serviço>-v0-110-0`, 1 réplica cada)
     e espera as duas rodarem. Se não subirem, nada muda e a atualização não começa;
   - a migração do banco central e dos restaurantes que estão na versão nova roda como sempre.
     Os bancos dos restaurantes em outra versão ficam de fora (`migrate-cli` usa
     `COMANDOU_VERSION` da imagem).
2. **Roteamento**: o provider HTTP do Traefik (`/api/v1/internal/traefik`) manda o endereço do
   restaurante (subdomínio e domínios próprios) para a cópia da versão dele, só enquanto a cópia
   está rodando. O resto, inclusive o `admin.`, vai para o principal.
3. **Atualizar um restaurante**: o painel grava um trabalho `upgrade` (`tenant_db_jobs`). O
   serviço de backup faz um backup do banco do restaurante (se o backup estiver ligado), aplica
   as migrações da versão principal só nele e grava a versão nova. Em segundos o Traefik passa a
   mandar o restaurante para o principal; quem estiver com o sistema aberto vê "Nova versão
   disponível".
4. **Agendado**: a cada minuto o principal confere `app_update_at`; na hora, cria o mesmo
   trabalho, sempre para a versão principal daquele momento.
5. **Limpeza**: a cópia de uma versão sai do ar sozinha quando nenhum restaurante usa mais.

## Cópias de versões anteriores

- Criadas pelo agente a partir do serviço principal (mesmas redes, segredos e variáveis), fora da
  stack (o `docker stack deploy` não apaga nem atualiza) e com o rótulo `comandou.pinned-version`
  (o "Atualizar sistema" não mexe nelas).
- Sem apelidos de rede: `http://api:3000` na rede interna é sempre o principal.
- Filas no prefixo `<QUEUE_PREFIX>-v0-110-0`; cobrança, limpeza, conferência do PagBank, chamados
  e agendamentos de versão ficam desligados nelas (rodam só no principal).
- Custo: cada versão anterior no ar usa mais uma api (até 512 MB) e uma web (até 128 MB).

## Limites

- Só restaurantes com **banco próprio**. Quem ainda está no banco central acompanha o sistema.
- Exige o agente do servidor (`infrastructure/swarm/agent.yml`) e imagens com a versão embutida
  (a partir da 0.111.0). A primeira atualização para a 0.111.0 leva todos juntos; a separação
  vale a partir da seguinte.
- Não dá para voltar um restaurante para uma versão anterior (as migrações já rodaram).
- O banco central é um só: a versão anterior lê um banco central já migrado para a versão nova.
  As migrações são aditivas, mas mudanças que tiram ou renomeiam colunas do central precisam
  considerar as versões anteriores no ar.
- Rotinas de fundo do principal (cobrança, limpeza, PagBank, chamados) e o WhatsApp (o gateway
  entrega no principal) também atendem os restaurantes em versão anterior, com o código novo
  sobre o banco ainda não migrado. Atualize os restaurantes logo depois de testar.
- Reaplicar a stack pelo Portainer ou pelo instalador numa versão nova não prende ninguém:
  só o botão "Atualizar sistema" faz isso.
