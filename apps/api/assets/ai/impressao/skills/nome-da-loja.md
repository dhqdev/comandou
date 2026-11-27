---
titulo: Nome da loja em destaque
quando:
  - nome da loja maior
  - destaque o nome do restaurante
  - nome do restaurante na comanda
papeis: receipt, delivery_slip, kitchen_ticket
---
Na Conferência e na Via de entrega o nome já sai em letra grande e centralizado no modelo padrão.
Se o modelo atual não estiver assim, troque a linha do nome por esta (até 21 letras por linha;
nome maior quebra sozinho). Na cozinha o nome não sai no padrão: ponha no começo, se pedirem.

```liquid
{{ loja.nome | upcase | grande: "centro" }}
```

```json kitchen_ticket
{"tipo": "trocar", "de": "{{ setor | upcase | grande: \"centro\" }}", "para": "{{ loja.nome | upcase | centro | negrito }}\n{{ setor | upcase | grande: \"centro\" }}"}
```
