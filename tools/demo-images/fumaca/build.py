"""Gera as fotos da Fumaça Burger (apps/api/db/demo/fumaca/*.webp, manifest.json e credits.json).

Uso (só quando mudar alguma escolha em picks.json):
  python3 tools/demo-images/fumaca/build.py
Precisa de Pillow (pip install pillow). Baixa as fotos do Open Images (Flickr, CC BY 2.0).
A logo sai de logo.svg com: node tools/demo-images/fumaca/logo.mjs
"""
import json, os, urllib.request
from io import BytesIO
from PIL import Image, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', '..', 'apps', 'api', 'db', 'demo', 'fumaca')
picks = json.load(open(os.path.join(HERE, 'picks.json'), encoding='utf-8'))
manifest_path = os.path.join(OUT, 'manifest.json')
manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
credits = {}

for key, p in picks.items():
    url = f"https://open-images-dataset.s3.amazonaws.com/{p['subset']}/{p['id']}.jpg"
    im = Image.open(BytesIO(urllib.request.urlopen(url).read())).convert('RGB')
    if 'crop' in p:
        x0, y0, x1, y1 = p['crop']
        w, h = im.size
        im = im.crop((int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)))
    wide = key == 'capa' or key.startswith('banner-')
    tw, th = (1200, 525) if wide else (960, 720)
    w, h = im.size
    if w / h > tw / th:
        nw = int(h * tw / th)
        x = (w - nw) // 2
        im = im.crop((x, 0, x + nw, h))
    else:
        nh = int(w * th / tw)
        y = int((h - nh) * p.get('focus', 0.5))
        im = im.crop((0, y, w, y + nh))
    im = ImageEnhance.Color(im.resize((tw, th), Image.LANCZOS)).enhance(1.06)
    path = os.path.join(OUT, f'{key}.webp')
    im.save(path, 'WEBP', quality=80, method=6)
    manifest[key] = {'width': tw, 'height': th, 'bytes': os.path.getsize(path)}
    credits[key] = {
        'author': p['author'],
        'title': p['title'],
        'source': p['source'],
        'license': 'CC BY 2.0',
        'licenseUrl': 'https://creativecommons.org/licenses/by/2.0/',
        'dataset': 'Open Images (Google)',
    }
    print(key)

json.dump(manifest, open(manifest_path, 'w'), indent=2, ensure_ascii=False)
json.dump(credits, open(os.path.join(OUT, 'credits.json'), 'w'), indent=2, ensure_ascii=False)
