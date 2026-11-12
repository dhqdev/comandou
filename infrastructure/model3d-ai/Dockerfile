# Gerador de 3D por foto rodando na nossa VM (opcional): TripoSR (MIT, VAST AI + Stability AI).
# Uma foto do prato vira um GLB em ~30 s a 3 min só com processador (sem placa de vídeo).
# Precisa de ~8 GB de memória livre durante a geração; numa VM de 4 GB use o Meshy.
# Build no próprio servidor (só amd64; os pesos, ~1,7 GB, entram na imagem):
#   docker build -t comandou-model3d-ai:local infrastructure/model3d-ai
# e suba com -c infrastructure/swarm/model3d-ai.yml (ver docs/modelos-3d.md).
FROM python:3.11-slim
ENV PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1 U2NET_HOME=/models/u2net HF_HOME=/models/hf
RUN apt-get update \
 && apt-get install -y --no-install-recommends git build-essential cmake libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN pip install torch==2.4.1 torchvision==0.19.1 --index-url https://download.pytorch.org/whl/cpu
RUN git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR /app/triposr
# gradio e o que é só da demonstração ficam de fora; torchmcubes compila aqui (precisa do cmake).
RUN grep -v -E '^(gradio|xatlas|moderngl)' /app/triposr/requirements.txt > /tmp/req.txt \
 && pip install -r /tmp/req.txt fastapi==0.115.6 uvicorn==0.32.1 onnxruntime==1.20.1
ENV PYTHONPATH=/app/triposr
# Baixa os pesos no build: o serviço sobe sem internet e sem esperar.
RUN python -c "from tsr.system import TSR; TSR.from_pretrained('stabilityai/TripoSR', config_name='config.yaml', weight_name='model.ckpt')" \
 && python -c "import rembg; rembg.new_session()"
COPY server.py /app/server.py
RUN useradd -r -u 10001 gerador && chown -R gerador /models
USER gerador
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')" || exit 1
CMD ["uvicorn", "server:app", "--app-dir", "/app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
