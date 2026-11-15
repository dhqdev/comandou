# Fotos, logo e modelos 3D da Fumaça Burger & Co.

Arquivos do restaurante de demonstração Fumaça Burger (`apps/api/db/demo/fumaca`).

- **Fotos**: [Unsplash](https://unsplash.com), [licença Unsplash](https://unsplash.com/license) (uso comercial
  livre, sem pedir autorização). Autor e título de cada uma ficam em `picks.json` e em
  `apps/api/db/demo/fumaca/credits.json`.
- **Logo** (`logo.svg`): desenhada para a demonstração, não é de nenhuma marca. Fontes Anton e Oswald (SIL Open Font
  License, em `fonts/`).
- **Modelos 3D** (`models/`): feitos só com código (`models/scene.js`), sem escaneamento nem arquivo de terceiros.
  Medidas reais em metros, para o "Ver na minha mesa" mostrar o prato do tamanho certo.

Para trocar uma foto, mude o `id` (o trecho depois de `photo-` no endereço `images.unsplash.com`), `author` e
`title` em `picks.json` e rode `python3 tools/demo-images/fumaca/build.py` (com uma pasta como argumento, só
pré-visualiza ali). `crop` recorta antes (frações x0, y0, x1, y1) e `focus` escolhe a altura do recorte (0 em cima,
1 embaixo).

A logo: `node tools/demo-images/fumaca/logo.mjs`. Os modelos: `node tools/demo-images/fumaca/models/build.mjs`
(com uma pasta como argumento, grava só fotos de conferência). Os dois precisam do `pnpm install` e do Chromium do
Playwright (`CHROMIUM=/caminho/do/chrome` se não estiver no lugar padrão).

`apps/api/db/demo/fumaca/previous.json` guarda o sha256 das versões antigas das fotos e da logo (os scripts
atualizam sozinhos). Na subida da stack, a demonstração que já está no ar troca as fotos que ainda forem de uma
versão antiga e grava os modelos 3D (`apps/api/src/demo/refresh.ts`), sem mexer no resto dos dados.
