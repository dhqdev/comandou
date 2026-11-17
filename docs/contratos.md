# Contratos e assinatura eletrônica

O contrato de cada cliente é gerado no painel Super Admin (Restaurantes → cliente → **Contrato**)
e assinado pelas duas partes: primeiro o cliente (CONTRATANTE), depois a plataforma
(CONTRATADA). Este documento reúne as regras que o sistema aplica.

## Regras

1. **Texto congelado.** Ao gerar, o texto vira um JSON canônico com hash SHA-256 (impresso no
   rodapé de cada página) e o PDF original também ganha hash. Nada disso muda depois. Para mudar
   uma condição, cancele e gere outro contrato (ou um aditivo, se já estiver assinado).
2. **Ordem das assinaturas.** O cliente assina primeiro; a contratada só assina depois. O banco
   recusa qualquer outra ordem (gatilho `tenant_contracts_freeze`).
3. **Assinatura do cliente.** Pelo link pessoal (`admin.<domínio>/assinar/<token>`), sem login:
   - o link vale 30 dias, só o hash do token fica no banco, e cada novo envio troca o link;
   - a assinatura só é liberada depois de o texto ser percorrido até o fim;
   - o cliente informa nome completo, CPF (com dígito conferido) e e-mail, desenha a assinatura
     (dedo ou mouse) ou digita o nome, e declara ter poderes para assinar pela empresa;
   - ficam registrados: data e hora, **IP** (o mesmo que o Traefik entrega; o cabeçalho
     X-Forwarded-For bruto também é guardado), navegador, imagem da assinatura e, **se a pessoa
     permitir no navegador**, a localização do aparelho (latitude, longitude e precisão). Negar a
     localização não impede a assinatura;
   - tudo isso vira um registro com hash (`client_evidence_sha256`) que não pode mais ser alterado,
     nem direto no banco.
4. **Aviso para a contratada.** Assim que o cliente assina, o Comandou manda (evento
   `contract.client_signed`) um e-mail para o e-mail de aviso com o botão "Conferir e assinar", e
   um recibo para o cliente dizendo que a via final chega depois. A tela Status do painel também
   mostra o contrato pendente.
5. **Assinatura da contratada.** No painel, a pessoa confere a assinatura do cliente (imagem, IP,
   localização, navegador), informa nome e CPF, desenha ou digita a assinatura e confirma com o
   **código do aplicativo autenticador**, pedido sempre, mesmo em navegador confiável. Código
   errado ou já usado é recusado e fica na trilha (`countersign_denied`). A tela envia também o
   hash do texto e do registro do cliente que estavam na tela: se algo mudou, a assinatura é
   recusada.
6. **Prazo.** A contratada tem **10 dias** depois da assinatura do cliente. Passado o prazo, o
   painel não deixa mais assinar: cancele e gere um contrato novo (cláusula "Assinatura
   eletrônica").
7. **Cancelar depois do cliente.** Enquanto falta a assinatura da contratada, o contrato pode ser
   cancelado com motivo. O cliente recebe um e-mail avisando que a assinatura dele perdeu o efeito.
   Contrato completo não é cancelado.
8. **PDF final.** Com as duas assinaturas o sistema gera o PDF final: contrato original +
   **rubricas** das duas partes no pé de cada página + manifesto com as duas assinaturas (imagem,
   nome, CPF, e-mail, empresa representada, data e hora, IP, localização, navegador, forma e hash
   do registro), os hashes do documento e a trilha.
9. **Trilha encadeada.** Cada evento (gerado, enviado, aberto, lido, assinado, contra-assinado,
   avisos) guarda o hash do evento anterior. O hash do evento da assinatura da contratada fecha a
   trilha e vai impresso no manifesto e nos metadados do PDF (`trilha:<hash>`). O painel confere a
   cadeia toda vez que abre o contrato e avisa se algum registro foi mexido.
10. **E-mails da via final.** O Comandou (evento `contract.signed`) manda o PDF final para:
    e-mail de aviso da contratada, e-mail de quem assinou pela contratada, quem assinou pelo
    cliente e o e-mail de cobrança do cliente (sem repetir endereço). Se o envio falhar, a assinatura
    não se desfaz: use **Reenviar aviso** no contrato.
11. **Nada é apagado.** Contratos e eventos só recebem inserções (o papel do painel não tem
    DELETE), e toda ação também vai para a auditoria do painel.

12. **Renovação anual.** O contrato vale no máximo 12 meses (`valid_until`) e é reassinado todo
    ano. O painel avisa 30 dias antes e, em "Gerar contrato", o novo começa no dia seguinte ao fim
    do atual. Vencido sem o novo assinado, o sistema do cliente é bloqueado depois da tolerância
    (padrão 15 dias) até a assinatura. Regras da cobrança em [cobranca.md](cobranca.md).

13. **Preço fixo e custo da nota.** Com o plano sem limites (plano único), a cláusula de preço
    diz que a mensalidade é fixa, sem cobrança por pedido, usuário, produto ou mesa. Se o plano
    inclui nota fiscal, a cláusula da NFC-e diz quanto custa a Focus NFe para o cliente, com os
    valores de Super Admin → Orçamento → Valores padrão (ver [cobranca.md](cobranca.md)).

Contratos assinados antes da v0.43.0 seguem o modelo antigo (a contratada concordava pelo envio)
e continuam válidos como estão.

## E-mails do contrato

Saem pelo envio do Comandou (Super Admin › E-mail, ver [email.md](email.md)) e aparecem em
E-mail › Envios com o tipo de cada um. Sem envio configurado, o botão "Enviar por e-mail" fica
desligado (dá para copiar o link e mandar por WhatsApp).

| Tipo                     | Quando                                    | Anexo     |
| ------------------------ | ----------------------------------------- | --------- |
| `test`                   | botão "Salvar e testar" na configuração   | —         |
| `contract.send`          | envio do link de assinatura               | PDF       |
| `contract.client_signed` | cliente assinou (falta a contratada)      | —         |
| `contract.signed`        | contrato completo (duas assinaturas)      | PDF final |
| `contract.cancelled`     | cancelado depois da assinatura do cliente | —         |

O envio do link acontece dentro da transação: se o provedor recusar, o link novo não vale e o
e-mail é cancelado (não sai mais tarde com um link vencido).

## Base legal

Assinatura eletrônica entre as partes: artigo 10, § 2º, da MP nº 2.200-2/2001, Lei nº
14.063/2020 e artigo 107 do Código Civil. O contrato traz essas regras na cláusula "Assinatura
eletrônica".
