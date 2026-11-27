# IA nas fotos dos itens do cardápio

Desde a 0.252. Tudo no cadastro do item (Cardápio › Itens › item), para quem tem `catalog:write`.

## Melhorar a foto

Botão **Melhorar a foto** embaixo da foto do item (`apps/web/src/features/PhotoTune.tsx`).

1. O navegador reduz a foto (1024 px, JPEG) e manda para `POST /catalog-ai/photo/tips?item=<nome>`.
2. O modelo de visão (o mais barato que lê imagem; padrão `google/gemini-2.5-flash-lite`) lê a
   foto guiado por `apps/api/assets/ai/melhorar-foto.md` e devolve um JSON: nota, uma frase,
   até 3 dicas para a próxima foto, retoque leve (`brightness`, `contrast`, `saturation`,
   `warmth`), um corte sugerido e se vale limpar o fundo. O servidor prende tudo em faixas seguras
   (`readTips` em `catalog/item-ai.ts`).
3. O retoque é feito no próprio navegador (`tunePixels` de `features/item-ai.ts`, pixel a pixel:
   o Safari não tem `ctx.filter`). A pessoa compara antes e depois arrastando a linha, muda a força
   e liga ou desliga o corte.
4. **Fundo limpo com IA** (opcional): `POST /catalog-ai/photo/clean?item=<nome>` manda a foto para
   a API de imagens do OpenRouter (`POST /images` com `input_references`; padrão
   `openai/gpt-image-2`, ~US$ 0,014 por foto) com o pedido que está no fim do mesmo .md. Se o
   modelo escolhido não aceitar edição por lá, cai no `AI_IMAGE_MODEL` pelo chat.
5. **Usar esta foto** sobe a foto nova como qualquer outra; o item só muda ao salvar.

## 3D dos itens (retirado por enquanto)

Na 0.272 o 3D dos itens saiu todo, a pedido do David ("por enquanto retire a parte de gerar em
3D"): o cartão **Item em 3D** do cadastro, o "Ver em 3D" / "Ver na sua mesa" do cardápio, as
rotas `products/:id/model*` e `store/models/*`, o interruptor do Super Admin, a parte **3D dos
itens** do uso de IA, os modelos de exemplo da demonstração e a seção "Prato em 3D" do site.
Nada foi apagado do banco: a tabela `product_models` (0060) e a coluna
`platform_ai_settings.model3d_ai_enabled` (0121) seguem lá, sem uso, e o uso antigo de IA da
fonte `menu_model` aparece em "Outros" como "Item em 3D pela foto (desativado)".

Para trazer de volta, o código inteiro está no git na 0.271.1 (`dish3d.ts`, `cutout*.ts` com o
U²-Netp em `apps/api/assets/ai/models/`, `item-3d.md`, `models.controller.ts`, `Item3DCard.tsx`,
`pages/public/Model3D.tsx`, `site/Dish3D.tsx`, os modelos em `db/demo/fumaca/models`) e o guia
dele está neste arquivo, que antes se chamava `ia-fotos-e-3d.md`.

## Super Admin e custos

Super Admin › Tokens de IA › Chaves e assistente › **Fotos do cardápio**: liga e desliga a
função e escolhe os dois modelos (`platform_ai_settings.photo_ai_enabled`, `vision_model`,
`image_model`; migração 0121; o restaurante lê por `app_ai_config()`). Tudo desconta dos tokens
do restaurante, como o resto da IA, e aparece no cartão do restaurante (aba Uso dos restaurantes)
na parte **Fotos dos itens** (`photo_tune`, `photo_clean`, `photo_create`, `menu_photo`).

**Imagem sem tokens na resposta (0.266.0):** a API de imagens do OpenRouter às vezes devolve só
`usage.cost` (ou nada). Como o limite do mês é contado em tokens, a foto saía de graça.
`imageUsage` (`chat/openrouter.ts`) conta essa imagem pelo custo, no preço por token das imagens
que vêm com tokens (4.175 tokens por US$ 0,04, o exemplo do gpt-image-1 na documentação do
OpenRouter); sem custo nenhum, conta 4.175 tokens.

## Mudar o jeito da IA

Edite os .md de `apps/api/assets/ai/`. O `melhorar-foto.md` tem duas partes separadas por `---`:
a leitura da foto e, depois do título e da explicação, o pedido do fundo limpo (com `{{item}}`).
O teste `apps/api/src/catalog/item-ai.test.ts` confere as partes e os campos que o servidor lê.
