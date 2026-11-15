"""Gera as fotos da Fumaça Burger (apps/api/db/demo/fumaca/*.webp, manifest.json e credits.json).

Uso (só quando mudar alguma escolha em picks.json):
  python3 tools/demo-images/fumaca/build.py            # grava em apps/api/db/demo/fumaca
  python3 tools/demo-images/fumaca/build.py /tmp/prev  # só pré-visualiza noutra pasta
Precisa de Pillow (pip install pillow). Baixa as fotos do Unsplash (licença Unsplash: uso comercial
livre, sem precisar de autorização; os créditos ficam em credits.json mesmo assim).
A logo sai de logo.svg com: node tools/demo-images/fumaca/logo.mjs
"""
import hashlib, json, os, sys, urllib.request
from io import BytesIO
from PIL import Image, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', '..', 'apps', 'api', 'db', 'demo', 'fumaca')
os.makedirs(OUT, exist_ok=True)
picks = json.load(open(os.path.join(HERE, 'picks.json'), encoding='utf-8'))
manifest_path = os.path.join(OUT, 'manifest.json')
manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
credits = {}
# Versões anteriores das fotos (sha256 → nome): a demonstração que já está no ar troca sozinha,
# na próxima subida, as fotos que ainda forem de uma versão antiga (src/demo/refresh.ts).
previous_path = os.path.join(OUT, 'previous.json')
previous = json.load(open(previous_path)) if os.path.exists(previous_path) else {}

for key, p in picks.items():
    url = f"https://images.unsplash.com/photo-{p['id']}?w=2000&q=90&fm=jpg"
    im = Image.open(BytesIO(urllib.request.urlopen(url).read())).convert('RGB')
    if 'crop' in p:
        x0, y0, x1, y1 = p['crop']
        w, h = im.size
        im = im.crop((int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)))
    wide = key == 'capa' or key.startswith('banner-')
    tw, th = (1440, 630) if wide else (1080, 810)
    w, h = im.size
    if w / h > tw / th:
        nw = int(h * tw / th)
        x = int((w - nw) * p.get('focusX', 0.5))
        im = im.crop((x, 0, x + nw, h))
    else:
        nh = int(w * th / tw)
        y = int((h - nh) * p.get('focus', 0.5))
        im = im.crop((0, y, w, y + nh))
    im = ImageEnhance.Contrast(im.resize((tw, th), Image.LANCZOS)).enhance(1.03)
    path = os.path.join(OUT, f'{key}.webp')
    if os.path.exists(path):
        previous[hashlib.sha256(open(path, 'rb').read()).hexdigest()] = key
    im.save(path, 'WEBP', quality=80, method=6)
    manifest[key] = {'width': tw, 'height': th, 'bytes': os.path.getsize(path)}
    credits[key] = {
        'author': p['author'],
        'title': p['title'],
        'source': f"https://images.unsplash.com/photo-{p['id']}",
        'license': 'Unsplash License',
        'licenseUrl': 'https://unsplash.com/license',
        'dataset': 'Unsplash',
    }
    print(key)

json.dump(manifest, open(manifest_path, 'w'), indent=2, ensure_ascii=False)
for key in picks:
    path = os.path.join(OUT, f'{key}.webp')
    previous.pop(hashlib.sha256(open(path, 'rb').read()).hexdigest(), None)
json.dump(previous, open(previous_path, 'w'), indent=2, sort_keys=True)
json.dump(credits, open(os.path.join(OUT, 'credits.json'), 'w'), indent=2, ensure_ascii=False)
