---
titulo: Rodapé do cupom fiscal
quando:
  - número da nota no rodapé
  - endereço da loja no cupom
  - whatsapp no cupom fiscal
papeis: fiscal_footer
---
O rodapé enxerga só a loja (`loja.nome`, `loja.endereco`, `loja.telefone`) e a nota (`nota.numero`,
`nota.serie`). O resto do cupom da NFC-e é obrigatório e não muda; sem logo aqui.

```json
{"tipo": "trocar", "de": "{% if loja.nome %}{{ loja.nome | centro }}{% endif %}", "para": "{% if loja.nome %}{{ loja.nome | centro }}{% endif %}\n{{ \"NFC-e \" | append: nota.numero | append: \" série \" | append: nota.serie | centro }}"}
```

```liquid
{% if loja.endereco %}{{ loja.endereco | quebra | centro }}
{% endif %}{% if loja.telefone %}{{ "WhatsApp: " | append: loja.telefone | centro }}
{% endif %}
```
