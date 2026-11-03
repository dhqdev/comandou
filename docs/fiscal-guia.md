# Guia fiscal do Comandou, em linguagem simples

Este guia explica quais papéis e notas um restaurante emite, quais vão para o governo e o que o
Comandou já faz em cada caso. Ele serve para quem não é da área fiscal. Na dúvida, a palavra final
é da contabilidade do restaurante, porque as regras mudam um pouco de estado para estado.

## Como o Comandou fala com o governo

O Comandou não fala direto com a SEFAZ (a secretaria da fazenda de cada estado). Quem faz isso é a
**Focus NFe**, uma empresa que recebe os dados da venda, assina com o certificado digital do
restaurante, manda para a SEFAZ e devolve a resposta. O caminho é este:

1. A venda é paga no caixa, ou a comanda da mesa é fechada.
2. O Comandou monta a nota (itens, impostos, forma de pagamento, CPF se o cliente pediu) e guarda no
   banco antes de mandar. Assim nada se perde se a internet cair.
3. Uma fila manda a nota para a Focus. Se a Focus não responder, a fila tenta de novo com a mesma
   referência, então a nota **nunca sai duplicada**.
4. A SEFAZ autoriza ou recusa. Se recusar, a tela explica o motivo em português e diz onde corrigir.
5. Autorizada, o cupom sai na impressora do caixa com o QR Code, e o XML fica guardado.

Para isso o restaurante precisa de três coisas, todas pedidas na tela Fiscal > Empresa: o
**certificado digital A1** (arquivo .pfx), o **CSC** (um código que o restaurante gera no site da
SEFAZ, usado no QR Code da NFC-e) e a **inscrição estadual**.

## O que vai para o governo

| Documento | Para que serve | No Comandou |
| --- | --- | --- |
| **NFC-e** (modelo 65) | É o "cupom fiscal" de hoje. Sai em toda venda ao consumidor final: balcão, mesa, delivery, retirada. | Pronto. Por pedido ou pela comanda inteira, automática ao pagar (opcional), com CPF na nota. |
| **NF-e** (modelo 55) | Nota "grande", com destinatário identificado. Usada quando uma empresa compra (evento, marmitas para firma), em devolução ou em venda para outro estado. | Pronto. Nasce como rascunho, você confere o destinatário e emite. |
| **Cancelamento** | Desfaz uma nota autorizada. NFC-e: em geral até 30 minutos. NF-e: até 24 horas. | Pronto, com justificativa de 15 caracteres ou mais. |
| **Inutilização** | Avisa a SEFAZ que um número de nota foi pulado e não será usado. | Pronto (Fiscal > Inutilizar). |
| **Carta de correção** | Corrige um detalhe de uma NF-e (não serve para valor nem para NFC-e). | Pronto. |
| **Contingência offline** | Se a SEFAZ estiver fora do ar, a NFC-e sai mesmo assim e é mandada depois (prazo de 24 horas). | **Novo nesta versão.** Veja abaixo. |
| **Notas recebidas** | Notas que os fornecedores emitem contra o CNPJ do restaurante. A "manifestação" confirma que a compra aconteceu. | Pronto (Fiscal > Recebidas). |

O antigo **ECF** (a impressora fiscal com bobina lacrada) e o **SAT** de São Paulo foram trocados
pela NFC-e, que não precisa de equipamento especial: basta uma impressora térmica comum. Em São
Paulo a troca do SAT pela NFC-e ainda está em andamento, então confirme com a contabilidade a data
que vale para o seu CNPJ.

**NFS-e** (nota de serviço, da prefeitura) não é usada pelo restaurante na venda de comida. A taxa
de serviço (os 10% do garçom) entra na própria NFC-e como "outras despesas", e é assim que o
Comandou faz.

## O que NÃO vai para o governo

Estes papéis são só do restaurante e o cliente. Eles precisam ter escrito **"não é documento
fiscal"** quando parecem uma conta:

- **Comprovante de fechamento / conferência de conta**: o papel que o cliente confere antes de pagar.
  No Comandou ele aparece na tela ao fechar a mesa ou a comanda, com pré-visualização e o botão
  Imprimir, e o formato é personalizável (veja "Modelos de impressão").
- **Comanda da cozinha e do bar**: o pedido que sai em cada setor.
- **Comprovante da maquininha de cartão**: quem emite é a maquininha ou o banco.
- **Fechamento de caixa, sangria e suprimento**: controle interno.
- **Recibo de entrega e acerto do entregador**: controle interno.

## Contingência offline (novo)

Quando a SEFAZ do estado sai do ar, antes a nota ficava parada e o caixa ficava sem cupom. Agora a
Focus emite a NFC-e em **contingência offline**:

- O cupom sai com os avisos obrigatórios **"EMITIDA EM CONTINGÊNCIA"** e **"Pendente de
  autorização"**, em duas vias: uma para o cliente e uma que fica no estabelecimento.
- A nota vale para o cliente na hora. A Focus manda para a SEFAZ sozinha quando ela voltar, e o
  Comandou acompanha por até cerca de 18 horas, dentro do prazo de 24 horas.
- Na lista de notas aparece "contingência pendente". O botão **Atualizar** consulta na hora.
- Enquanto está pendente, a nota **não pode ser cancelada** (regra da SEFAZ). Depois que a SEFAZ
  recebe, o cancelamento volta a funcionar normalmente.
- Se a SEFAZ recusar a nota ao receber, ela aparece como recusada, com o motivo, e é só corrigir e
  emitir de novo. O número é o mesmo.
- **Santa Catarina não aceita** NFC-e em contingência offline, então lá ela fica desligada.

A opção fica em Fiscal > Configuração, ligada por padrão. Ela é enviada para a Focus no próximo
"Salvar" da tela Empresa. No modo "token próprio", quem liga é o próprio restaurante, no painel da
Focus.

## O que o cupom da NFC-e precisa ter (já sai assim)

Nome, CNPJ, inscrição estadual e endereço do restaurante. Os itens com quantidade, valor unitário e
total. Os totais, os descontos e os acréscimos. A forma de pagamento. A chave de acesso em blocos
de 4 números, com o site de consulta. O CPF do consumidor, ou "consumidor não identificado".
Número, série, protocolo e data de autorização. O QR Code. Os tributos aproximados (Lei
12.741/2012). Em homologação, sai "sem valor fiscal". O final do cupom é livre: o restaurante pode
pôr agradecimento, Wi-Fi ou redes sociais em **Impressão > Modelos de impressão > Rodapé do cupom
fiscal**. O corpo do cupom não muda, porque o leiaute é obrigatório.

## Modelos de impressão (o "Jinja" do Comandou)

Em **Impressão > Modelos de impressão** o restaurante muda o formato de três papéis: o comprovante
de fechamento (conferência de conta), a comanda da cozinha e o rodapé do cupom fiscal. A linguagem
é a **Liquid**, que funciona do mesmo jeito que o Jinja:

```liquid
{{ loja.nome | centro }}
{{ "=" | traco }}
{% for item in itens %}{{ item.quantidade | qtd | append: "x " | append: item.nome | linha: item.total_formatado }}
{% endfor %}{{ "TOTAL" | linha: totais.total_formatado }}
```

- `{{ ... }}` mostra um dado e `{% for %}` / `{% if %}` fazem listas e condições.
- Ajudantes da bobina: `dinheiro`, `linha` (texto à esquerda e valor à direita), `centro`, `traco`,
  `quebra` e `qtd`.
- **Ver prévia** monta o papel com o último pedido de verdade antes de salvar. **Voltar ao padrão**
  desfaz.
- Um modelo com erro não chega a ser salvo. Se mesmo assim algo der errado na hora de imprimir, sai
  o leiaute padrão, para o caixa nunca ficar sem papel.
- Liquid foi escolhida no lugar do Jinja de verdade (que é do Python) porque roda no nosso servidor
  em JavaScript e foi feita para o cliente escrever modelo **sem conseguir rodar código**: ela não
  lê arquivos nem acessa a rede. Ainda assim limitamos o tamanho, o tempo e a memória de cada
  impressão.

## O que foi revisado na comunicação com a Focus

- Emissão, consulta, cancelamento, inutilização, carta de correção, e-mail e notas recebidas usam as
  rotas certas da API v2 da Focus.
- Referência fixa por nota: reenviar nunca duplica, e uma nota recusada é reemitida com o mesmo
  número.
- Queda da Focus ou da internet: a nota fica "processando" e é consultada, nunca reemitida às cegas.
- Delivery sai como "entrega a domicílio" e exige CPF e endereço, que é o que a SEFAZ pede
  (rejeição 787). Isso é checado antes de enviar.
- Cartão e Pix levam o grupo do cartão ("não integrado") e "Outros" leva a descrição, que é o que
  evita as recusas mais comuns.
- Campos da reforma tributária (IBS e CBS, alíquotas de teste de 2026) já entram na nota.
- Corrigido nesta versão: a mensagem de cancelamento recusado às vezes vinha vazia.
- Novo nesta versão: contingência offline, com duas vias e sem permitir cancelar antes da hora.
