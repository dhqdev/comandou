---
titulo: Instagram, site e WhatsApp
quando:
  - nosso instagram
  - redes sociais
  - coloca o @
  - nosso site
  - peça pelo whatsapp
papeis: todos
---
Uma linha centralizada no fim, com o @, o site ou o número que a pessoa disse. Sem o @ ou o
endereço, pergunte antes (acoes: []). O telefone da Loja online já existe como `loja.telefone`
(não precisa digitar).

```json
{"tipo": "adicionar_texto", "texto": "Siga a gente: @minhaloja", "onde": "fim"}
```

WhatsApp da loja usando o cadastro, logo antes do último traço:

```liquid
{% if loja.telefone %}{{ "WhatsApp: " | append: loja.telefone | centro }}
{% endif %}
```
