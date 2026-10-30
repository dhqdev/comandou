# Fotos da Aurora Café & Padaria

Fotos reais do restaurante de demonstração Aurora (`apps/api/db/demo/aurora`).

- Fonte: [Open Images](https://storage.googleapis.com/openimages/web/index.html) (Google), fotos do Flickr com licença
  [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/). Autor, título e link de cada uma ficam em `picks.json` e
  em `apps/api/db/demo/aurora/credits.json`.
- A logo (`logo.svg`) foi desenhada para a demonstração e não é de nenhuma marca.

Para trocar uma foto, mude o `id` (e `subset`, `author`, `title`, `source`) em `picks.json` e rode
`python3 tools/demo-images/aurora/build.py`. `crop` recorta antes (frações x0, y0, x1, y1) e `focus` escolhe a
altura do recorte (0 em cima, 1 embaixo).
