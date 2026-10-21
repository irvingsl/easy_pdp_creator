"""Remove o fundo e devolve a foto em JPEG com fundo branco (pronta para o anúncio)."""
import io
import os

import numpy as np
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image
from rembg import new_session, remove

MODEL = os.environ.get("MODEL", "birefnet-general-lite")
TOKEN = os.environ.get("API_TOKEN", "")  # defina em Settings > Variables and secrets do Space
session = new_session(MODEL)
app = FastAPI()


@app.get("/")
def saude():
    return {"ok": True, "modelo": MODEL}


@app.post("/remover")
async def remover(imagem: UploadFile = File(...), sensibilidade: int = Form(50), x_token: str = Header(default="")):
    if TOKEN and x_token != TOKEN:
        raise HTTPException(status_code=401, detail="token inválido")
    img = Image.open(io.BytesIO(await imagem.read())).convert("RGB")
    img.thumbnail((1600, 1600))
    cut = remove(img, session=session, post_process_mask=True)  # RGBA
    alpha = np.asarray(cut.getchannel("A"), dtype=np.float32) / 255.0
    # sensibilidade alta mantém partes finas (parafusos, hastes); baixa limpa mais as bordas
    s = max(0, min(100, sensibilidade))
    limiar = 0.5 - 0.4 * (s - 50) / 50
    alpha = np.clip((alpha - limiar) / 0.2 + 0.5, 0.0, 1.0)
    fundo = Image.new("RGB", img.size, (255, 255, 255))
    rgb = np.asarray(img, dtype=np.float32)
    branco = np.asarray(fundo, dtype=np.float32)
    mix = rgb * alpha[..., None] + branco * (1 - alpha[..., None])
    out = Image.fromarray(mix.astype(np.uint8))
    buf = io.BytesIO()
    out.save(buf, format="JPEG", quality=92)
    area = float((alpha > 0.5).mean())
    return Response(content=buf.getvalue(), media_type="image/jpeg", headers={"x-area-recorte": f"{area:.3f}"})
