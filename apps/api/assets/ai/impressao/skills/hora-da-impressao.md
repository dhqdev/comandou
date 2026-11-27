---
titulo: Hora em que o papel saiu
quando:
  - mostrar a hora da impressão
  - impresso em
  - data de impressão
papeis: receipt
---
`impresso_em` é a data e a hora em que o papel saiu (a data do pedido é `pedido.data`). Ponha logo
embaixo da data do pedido:

```json
{"tipo": "trocar", "de": "{{ \"DATA:\" | campo: pedido.data }}", "para": "{{ \"DATA:\" | campo: pedido.data }}\n{{ \"IMPRESSO:\" | campo: impresso_em }}"}
```
