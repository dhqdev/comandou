"""
Gerador de 3D por foto do Comandou (rede interna). Contrato usado pela API
(apps/api/src/model3d/providers.ts, LocalProvider):

  POST /generate  {"images": [{"type": "image/webp", "data": "<base64>"}, ...]}
    200 -> corpo é o GLB (model/gltf-binary)
    422 -> {"message": "..."} quando a foto não serve
  GET /health -> {"ok": true}

Usa só a primeira foto (o TripoSR cria o modelo a partir de uma imagem). Recorta o fundo,
centraliza o prato e gera a malha com cor por vértice. O servidor do Comandou depois
reduz, comprime e acerta o tamanho real. Uma geração por vez.
"""

import asyncio
import base64
import io
import os
import threading

import numpy as np
import rembg
import torch
import trimesh
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from PIL import Image
from tsr.system import TSR
from tsr.utils import remove_background, resize_foreground

TOKEN = os.environ.get("MODEL3D_LOCAL_TOKEN") or None
RESOLUTION = int(os.environ.get("MODEL3D_RESOLUTION", "256"))
torch.set_num_threads(int(os.environ.get("MODEL3D_THREADS", str(os.cpu_count() or 2))))

device = "cuda:0" if torch.cuda.is_available() else "cpu"
model = TSR.from_pretrained("stabilityai/TripoSR", config_name="config.yaml", weight_name="model.ckpt")
model.renderer.set_chunk_size(8192)
model.to(device)
background = rembg.new_session()
lock = threading.Lock()
app = FastAPI(title="Comandou model3d-ai")


class PhotoError(Exception):
    pass


def generate(photo: bytes) -> bytes:
    try:
        image = Image.open(io.BytesIO(photo)).convert("RGB")
    except Exception as e:  # noqa: BLE001
        raise PhotoError("Não foi possível ler a foto") from e
    image = remove_background(image, background)
    alpha = np.array(image)[:, :, 3]
    if (alpha > 127).mean() < 0.02:
        raise PhotoError("Não achei o prato na foto. Use uma foto com o prato inteiro e fundo limpo.")
    image = resize_foreground(image, 0.85)
    arr = np.array(image).astype(np.float32) / 255.0
    arr = arr[:, :, :3] * arr[:, :, 3:4] + (1 - arr[:, :, 3:4]) * 0.5
    image = Image.fromarray((arr * 255.0).astype(np.uint8))
    with lock, torch.no_grad():
        codes = model([image], device=device)
        mesh = model.extract_mesh(codes, True, resolution=RESOLUTION)[0]
    # Eixos do TripoSR -> glTF (y para cima, frente para a câmera).
    mesh.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    mesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0]))
    return mesh.export(file_type="glb")


@app.get("/health")
def health():
    return {"ok": True, "device": device}


@app.post("/generate")
async def generate_route(request: Request, authorization: str | None = Header(default=None)):
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401)
    body = await request.json()
    images = body.get("images") or []
    if not images:
        return JSONResponse({"message": "Mande pelo menos uma foto"}, status_code=422)
    try:
        photo = base64.b64decode(images[0]["data"], validate=True)
        glb = await asyncio.to_thread(generate, photo)
    except PhotoError as e:
        return JSONResponse({"message": str(e)}, status_code=422)
    except (KeyError, ValueError):
        return JSONResponse({"message": "Foto inválida"}, status_code=422)
    return Response(glb, media_type="model/gltf-binary")
