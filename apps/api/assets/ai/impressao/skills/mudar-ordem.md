---
titulo: Mudar a ordem das linhas
quando:
  - colocar antes
  - mudar a ordem
  - subir o cliente
  - passar para baixo
papeis: kitchen_ticket
---
Mover é tirar de um lugar e pôr no outro: duas ações `trocar`. A primeira apaga a linha (com a
quebra de linha dela, "\n"); a segunda troca a linha vizinha do destino por ela mesma mais a linha
movida. Mantenha o `{% if %}` junto da linha que ele protege.

```json
[
  {"tipo": "trocar", "de": "{{ \"HORA:\" | campo: pedido.hora }}\n", "para": ""},
  {"tipo": "trocar", "de": "{% if pedido.cliente %}{{ \"CLIENTE:\" | campo: pedido.cliente }}\n{% endif %}", "para": "{% if pedido.cliente %}{{ \"CLIENTE:\" | campo: pedido.cliente }}\n{% endif %}{{ \"HORA:\" | campo: pedido.hora }}\n"}
]
```
