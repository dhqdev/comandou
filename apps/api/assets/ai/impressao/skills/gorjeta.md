---
titulo: Sugestão de gorjeta
quando:
  - sugestão de 10%
  - mostrar a gorjeta sugerida
  - serviço opcional
papeis: receipt
---
Se o restaurante já cobra a taxa de serviço, ela já sai como "TAXA DE SERVIÇO". Para só sugerir,
calcule com times e formate com dinheiro num assign antes (filtro não pode ser argumento de outro),
logo depois do TOTAL.

```json
{"tipo": "trocar", "de": "{{ \"TOTAL:\" | linha: totais.total_formatado, 21 | grande }}", "para": "{{ \"TOTAL:\" | linha: totais.total_formatado, 21 | grande }}\n{% assign dez = totais.subtotal | times: 0.1 | dinheiro %}{{ \"SUGESTÃO 10%:\" | linha: dez }}"}
```
