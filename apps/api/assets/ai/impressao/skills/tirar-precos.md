---
titulo: Itens sem o preço
quando:
  - tire os preços
  - sem valor dos itens
  - motoboy não precisa ver preço
papeis: receipt, delivery_slip
---
Na tabela de itens, tire o "VALOR" do cabeçalho e o valor de cada item (o nome continua com recuo,
alinhado depois da quantidade). Não mexa nos totais se a pessoa não pedir.

```json
[
  {"tipo": "trocar", "de": "{{ \"QTDE  DESCRIÇÃO\" | linha: \"VALOR\" | negrito }}", "para": "{{ \"QTDE  DESCRIÇÃO\" | negrito }}"},
  {"tipo": "trocar", "de": "{{ item.quantidade_formatada | coluna: 6 | append: item.nome | linha: item.total_formatado, 42, 6 }}", "para": "{{ item.quantidade_formatada | coluna: 6 | append: item.nome | recuo: 6 }}"}
]
```
