# IA nas fotos e no 3D dos itens do cardápio

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

## Fazer o 3D pela foto

Cartão **Item em 3D** (`apps/web/src/features/Item3DCard.tsx`). O OpenRouter não tem foto → 3D
(só texto → 3D, em beta), então o modelo é montado no nosso servidor:

1. A foto do item (ou uma tirada na hora pela câmera) vai em JPEG para
   `POST /products/:id/model/generate`.
2. O modelo de visão lê **só a forma** guiado por `apps/api/assets/ai/item-3d.md`: tipo
   (prato, tigela, copo, xícara, lanche alto, fatia, embalagem), de onde a foto foi tirada, onde
   estão o recipiente e a comida na foto, diâmetro e alturas, e o perfil de lado para copos e
   lanches.
3. `catalog/dish3d.ts` monta o GLB sem biblioteca: prato ou tigela por anéis, com a foto projetada
   de cima (o ângulo da câmera sai do formato da borda, `cameraElevation`), e um domo onde está a
   comida; copo e lanche girando o perfil, com a foto em volta. Base em y = 0, medidas reais em
   metros, foto embutida como textura.
4. A tela mostra girando (o mesmo `@google/model-viewer` do cardápio). Ficou estranho? Troca a
   forma, o ângulo ou os tamanhos e **Monta de novo**: vai com `?forma=<json>` e não usa IA.
5. **Publicar no cardápio** envia o GLB pelo `PUT /products/:id/model/glb` de sempre. O iPhone
   gera o USDZ na hora a partir do GLB.

Quem já tem um arquivo 3D ainda envia `.glb` e `.usdz` em "Já tem o arquivo 3D?".

## Super Admin e custos

Super Admin › Tokens › Assistente › **Fotos e 3D do cardápio**: liga e desliga cada função e
escolhe os dois modelos (`platform_ai_settings.photo_ai_enabled`, `model3d_ai_enabled`,
`vision_model`, `image_model`; migração 0121; o restaurante lê por `app_ai_config()`). Tudo
desconta dos tokens do restaurante, como o resto da IA, e aparece no extrato com as fontes
**Melhorar a foto do item** (`photo_tune`), **Foto do item com fundo limpo** (`photo_clean`) e
**Item em 3D pela foto** (`menu_model`). Com o 3D com IA desligado (ou sem tokens), o restaurante
ainda monta escolhendo a forma, sem IA.

## Mudar o jeito da IA

Edite os .md de `apps/api/assets/ai/`. O `melhorar-foto.md` tem duas partes separadas por `---`:
a leitura da foto e, depois do título e da explicação, o pedido do fundo limpo (com `{{item}}`).
O teste `apps/api/src/catalog/item-ai.test.ts` confere as partes e os campos que o servidor lê.
