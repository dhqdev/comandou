---
titulo: Quantos itens tem o pedido
quando:
  - quantos itens
  - mostrar o total de itens
papeis: receipt, delivery_slip
---
Conte as linhas de itens com size num assign e mostre logo depois da tabela, antes dos totais.

```json
{"tipo": "trocar", "de": "{% if totais.tem_extras %}{{ \"SUBTOTAL:\" | linha: totais.subtotal_formatado }}", "para": "{% assign qtd = itens.size | append: \"\" %}{{ \"ITENS NO PEDIDO:\" | linha: qtd }}\n{% if totais.tem_extras %}{{ \"SUBTOTAL:\" | linha: totais.subtotal_formatado }}"}
```
