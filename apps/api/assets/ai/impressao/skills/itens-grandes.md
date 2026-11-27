---
titulo: Itens em letra grande na cozinha
quando:
  - itens em letra grande
  - cozinheiro não enxerga
  - aumenta os itens
  - letra maior nos pedidos
papeis: kitchen_ticket
---
Troque só a linha do item pela letra grande (quebra sozinha em 21 colunas). Os adicionais (+) e a
observação do item continuam embaixo, como estão.

```json
{"tipo": "trocar", "de": "{{ item.quantidade_formatada | append: \" \" | append: item.nome | recuo: 3 | negrito }}", "para": "{{ item.quantidade_formatada | append: \" \" | append: item.nome | grande }}"}
```

Adicionais em negrito também: troque `{{ "+ " | append: op | quebra: 3 }}` por
`{{ "+ " | append: op | quebra: 3 | negrito }}`.
