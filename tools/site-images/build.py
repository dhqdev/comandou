"""Gera as fotos do site público (apps/web/public/site/food).

Uso (só quando mudar alguma escolha abaixo):
  python3 tools/site-images/build.py            # grava em apps/web/public/site
  python3 tools/site-images/build.py /tmp/prev  # só pré-visualiza noutra pasta
Precisa de Pillow (pip install pillow).

As fotos vêm da demonstração Fumaça Burger (apps/api/db/demo/fumaca, fotos do Unsplash com os
créditos em credits.json). Aqui elas só são recortadas e reduzidas para o site:

- food/<item>.webp (640 x 480) e food/<item>-sm.webp (240 x 180): o celular do topo e a lanchonete
  de demonstração (/demo).
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
SRC = os.path.join(ROOT, 'apps', 'api', 'db', 'demo', 'fumaca')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'apps', 'web', 'public', 'site')

# Itens do celular do topo e da lanchonete de demonstração (mesmo nome da foto da Fumaça).
FOOD = [
    'combo-fumaca', 'combo-classico', 'combo-smash',
    'burger-fumaca', 'burger-classico', 'burger-smash', 'burger-egg', 'burger-picanha',
    'burger-crispy', 'burger-veggie', 'burger-cheese', 'burger-triplo',
    'porcao-batata', 'porcao-cheddar-bacon', 'porcao-onion', 'porcao-iscas',
    'shake-chocolate', 'shake-morango', 'shake-doce-leite',
    'bebida-limonada', 'bebida-limonada-suica', 'bebida-chopp', 'bebida-agua-gas',
    'sobremesa-brownie-sorvete', 'sobremesa-sundae', 'sobremesa-sundae-morango',
]


def fit(im, w, h, focus_y=0.5):
    """Recorta no meio (ou na altura `focus_y`) e reduz para w x h."""
    sw, sh = im.size
    if sw / sh > w / h:
        nw = round(sh * w / h)
        x = (sw - nw) // 2
        im = im.crop((x, 0, x + nw, sh))
    else:
        nh = round(sw * h / w)
        y = round((sh - nh) * focus_y)
        im = im.crop((0, y, sw, y + nh))
    return im.resize((w, h), Image.LANCZOS)


def save(im, *parts, quality=72):
    path = os.path.join(OUT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, 'WEBP', quality=quality, method=6)
    return path


def main():
    for key in FOOD:
        im = Image.open(os.path.join(SRC, f'{key}.webp')).convert('RGB')
        save(fit(im, 640, 480), 'food', f'{key}.webp', quality=70)
        save(fit(im, 240, 180), 'food', f'{key}-sm.webp', quality=70)
    combo = Image.open(os.path.join(SRC, 'banner-combo.webp')).convert('RGB')
    save(fit(combo, 1280, 560), 'food', 'capa.webp', quality=70)
    smash = Image.open(os.path.join(SRC, 'banner-smash.webp')).convert('RGB')
    save(fit(smash, 600, 300, 0.35), 'food', 'capa-sm.webp', quality=72)
    logo = Image.open(os.path.join(SRC, 'logo.webp')).convert('RGB')
    save(fit(logo, 192, 192), 'food', 'logo.webp', quality=80)
    print('ok', OUT)


if __name__ == '__main__':
    main()
