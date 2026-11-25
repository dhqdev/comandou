"""Gera as fotos do site público (apps/web/public/site/food e apps/web/public/site/3d).

Uso (só quando mudar alguma escolha abaixo):
  python3 tools/site-images/build.py            # grava em apps/web/public/site
  python3 tools/site-images/build.py /tmp/prev  # só pré-visualiza noutra pasta
Precisa de Pillow e numpy (pip install pillow numpy).

As fotos vêm da demonstração Fumaça Burger (apps/api/db/demo/fumaca, fotos do Unsplash com os
créditos em credits.json). Aqui elas só são recortadas e reduzidas para o site:

- food/<item>.webp (640 x 480) e food/<item>-sm.webp (240 x 180): o celular do topo e a lanchonete
  de demonstração (/demo);
- 3d/<prato>.webp, 3d/<prato>-sm.webp e 3d/<prato>-depth.webp: a foto, a miniatura e o mapa de
  profundidade do "Prato em 3D" (site/depth-photo.ts). O mapa sai da própria foto: o fundo preto fica longe, o prato perto e o
  meio do prato mais perto que a borda (distância até o fundo), com um borrão para a imagem não
  rasgar quando gira.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

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
# Pratos do "Prato em 3D": chave do site -> foto da Fumaça (fundo escuro, para a profundidade).
DEPTH = {
    'classico': 'burger-classico-2',
    'combo': 'combo-fumaca',
    'batata': 'porcao-batata',
    'chopp': 'bebida-chopp',
}


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


def shift(a, dy, dx, fill):
    out = np.full_like(a, fill)
    h, w = a.shape
    ys, yd = (slice(dy, h), slice(0, h - dy)) if dy >= 0 else (slice(0, h + dy), slice(-dy, h))
    xs, xd = (slice(dx, w), slice(0, w - dx)) if dx >= 0 else (slice(0, w + dx), slice(-dx, w))
    out[ys, xs] = a[yd, xd]
    return out


def erode(m):
    out = m.copy()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        out &= shift(m, dy, dx, False)
    return out


def dilate(m):
    out = m.copy()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        out |= shift(m, dy, dx, False)
    return out


def depth_map(im):
    """Mapa de profundidade (0 longe, 255 perto) de uma foto com fundo escuro."""
    a = np.asarray(im.convert('RGB')).astype(np.float32) / 255
    value = a.max(axis=2)
    soft = np.clip((value - 0.07) / 0.12, 0, 1)
    fg = soft > 0.5
    # Fecha buracos pequenos (sombra no meio do pão, da carne).
    for _ in range(4):
        fg = dilate(fg)
    for _ in range(4):
        fg = erode(fg)
    # Fundo = o que está ligado à borda da foto sem passar pelo prato; o resto é prato.
    bg = np.zeros_like(fg)
    bg[0, :] = bg[-1, :] = bg[:, 0] = bg[:, -1] = True
    bg &= ~fg
    while True:
        grown = dilate(bg) & ~fg
        if (grown == bg).all():
            break
        bg = grown
    fg = ~bg
    # Distância até o fundo, contada por erosões: o meio do prato fica mais perto.
    dist = np.zeros(fg.shape, np.float32)
    cur = fg.copy()
    while cur.any():
        dist += cur
        cur = erode(cur)
    pillow = np.sqrt(dist / max(1.0, dist.max()))
    # O chão (tábua, mesa) fica mais perto embaixo.
    ys = np.linspace(0, 1, fg.shape[0], dtype=np.float32)[:, None]
    floor = np.clip((ys - 0.55) / 0.45, 0, 1) * 0.35
    d = np.where(fg, 0.42 + 0.58 * pillow, 0.0)
    d = np.maximum(d, floor * fg)
    out = Image.fromarray((np.clip(d, 0, 1) * 255).astype(np.uint8), 'L')
    return out.filter(ImageFilter.GaussianBlur(radius=max(4, im.size[0] // 90)))


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
    for key, src in DEPTH.items():
        im = Image.open(os.path.join(SRC, f'{src}.webp')).convert('RGB')
        photo = fit(im, 1080, 810)
        save(photo, '3d', f'{key}.webp', quality=78)
        save(fit(photo, 240, 180), '3d', f'{key}-sm.webp', quality=70)
        small = photo.resize((540, 405), Image.LANCZOS)
        save(depth_map(small), '3d', f'{key}-depth.webp', quality=85)
    print('ok', OUT)


if __name__ == '__main__':
    main()
