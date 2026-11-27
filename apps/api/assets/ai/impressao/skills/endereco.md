---
titulo: Endereço e telefone grandes para o motoboy
quando:
  - endereço grande
  - endereço em destaque para o motoboy
  - telefone do cliente maior
papeis: delivery_slip
---
O endereço vira letra grande (quebra em 21 colunas) com o título em negrito em cima. O telefone em
negrito ajuda o motoboy a ligar.

```json
[
  {"tipo": "trocar", "de": "{{ \"ENDEREÇO:\" | campo: pedido.endereco | negrito }}", "para": "{{ \"ENDEREÇO:\" | negrito }}\n{{ pedido.endereco | upcase | grande }}"},
  {"tipo": "trocar", "de": "{{ \"TELEFONE:\" | campo: pedido.telefone }}", "para": "{{ \"TELEFONE:\" | campo: pedido.telefone | negrito }}"}
]
```
