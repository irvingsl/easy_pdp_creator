import { canvasToBlob } from "./compress";

type Box = { x: number; y: number; w: number; h: number };

/** Caixa que envolve os pixels não transparentes (ignora ruído de alpha baixo). */
function opaqueBounds(bitmap: ImageBitmap, alphaMin = 24): Box {
  const probe = 512;
  const scale = Math.min(1, probe / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > alphaMin) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
  return {
    x: minX / scale,
    y: minY / scale,
    w: (maxX - minX + 1) / scale,
    h: (maxY - minY + 1) / scale,
  };
}

/** Recorta o objeto e o compõe, com margem, em um quadrado de fundo branco. */
export async function composeOnWhite(cutout: Blob, size = 1200, margin = 0.05): Promise<Blob> {
  const bitmap = await createImageBitmap(cutout);
  const box = opaqueBounds(bitmap);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  const avail = size * (1 - margin * 2);
  const scale = Math.min(avail / box.w, avail / box.h);
  const w = box.w * scale;
  const h = box.h * scale;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, box.x, box.y, box.w, box.h, (size - w) / 2, (size - h) / 2, w, h);
  bitmap.close();
  return canvasToBlob(canvas, "image/jpeg", 0.92);
}

/**
 * Ajusta a "sensibilidade" do recorte (0 a 100; 50 = como o modelo devolveu).
 * Mais alto mantém mais da peça (partes finas, como prisioneiros e bordas); mais baixo remove mais fundo.
 * Usa uma curva sobre a transparência (gama): suave e sem efeito no valor padrão.
 */
export async function ajustarSensibilidade(cutout: Blob, sensibilidade: number): Promise<Blob> {
  const s = Math.min(100, Math.max(0, Math.round(sensibilidade)));
  if (s === 50) return cutout;
  const gama = Math.pow(2, (50 - s) / 25);
  const bmp = await createImageBitmap(cutout);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const tabela = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) tabela[i] = Math.round(255 * Math.pow(i / 255, gama));
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = tabela[img.data[i]];
  ctx.putImageData(img, 0, 0);
  return canvasToBlob(canvas, "image/png");
}

/**
 * Recupera partes finas que o modelo apagou (prisioneiros, hastes, bordas) para sensibilidade acima de 50.
 * Compara a cor da foto original com a cor típica do fundo (estimada onde o modelo disse "fundo") e traz de volta
 * o que é diferente do fundo, mas só numa faixa em volta da peça, para não puxar sujeira distante.
 * Quanto maior a sensibilidade, menor o limite de diferença e maior a faixa.
 */
export async function recuperarPartesFinas(original: Blob, cutout: Blob, sensibilidade: number): Promise<Blob> {
  const s = Math.min(100, Math.max(0, sensibilidade));
  if (s <= 50) return cutout;
  const cb = await createImageBitmap(cutout);
  const w = cb.width;
  const h = cb.height;
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return { c, ctx: c.getContext("2d", { willReadFrequently: true })! };
  };
  const a = mk();
  a.ctx.drawImage(cb, 0, 0);
  cb.close();
  const cut = a.ctx.getImageData(0, 0, w, h);
  const ob = await createImageBitmap(original);
  const b = mk();
  b.ctx.drawImage(ob, 0, 0, w, h);
  ob.close();
  const org = b.ctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const A = cut.data;

  // cor média do fundo e variação (onde o modelo deixou transparente)
  let cnt = 0, sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < n; i++) {
    if (A[i * 4 + 3] < 8) {
      cnt++;
      sr += org[i * 4];
      sg += org[i * 4 + 1];
      sb += org[i * 4 + 2];
    }
  }
  if (cnt < 2000) return cutout;
  const mr = sr / cnt, mg = sg / cnt, mb = sb / cnt;
  const dist = (i: number) => Math.hypot(org[i * 4] - mr, org[i * 4 + 1] - mg, org[i * 4 + 2] - mb);
  let sd2 = 0, mu = 0;
  for (let i = 0; i < n; i++) if (A[i * 4 + 3] < 8) mu += dist(i);
  mu /= cnt;
  for (let i = 0; i < n; i++) if (A[i * 4 + 3] < 8) sd2 += (dist(i) - mu) ** 2;
  const sd = Math.sqrt(sd2 / cnt);
  const k = 5 - (s - 50) * 0.06; // 5 desvios (s=55) até 2 (s=100)
  const limite = Math.max(28, mu + k * sd);

  // faixa em volta da peça (dilatação numa versão reduzida, para ser rápida)
  const f = 4;
  const sw = Math.ceil(w / f), sh = Math.ceil(h / f);
  const nucleo = new Uint8Array(sw * sh);
  for (let y = 0; y < h; y += f) for (let x = 0; x < w; x += f) if (A[(y * w + x) * 4 + 3] >= 200) nucleo[(y / f) * sw + x / f] = 1;
  const r = Math.max(2, Math.round((Math.max(w, h) * (0.01 + 0.03 * ((s - 50) / 50))) / f));
  const tmp = new Uint8Array(sw * sh);
  const faixa = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let v = 0;
    for (let dx = -r; dx <= r && !v; dx++) { const xx = x + dx; if (xx >= 0 && xx < sw && nucleo[y * sw + xx]) v = 1; }
    tmp[y * sw + x] = v;
  }
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let v = 0;
    for (let dy = -r; dy <= r && !v; dy++) { const yy = y + dy; if (yy >= 0 && yy < sh && tmp[yy * sw + x]) v = 1; }
    faixa[y * sw + x] = v;
  }

  // candidatos: diferentes do fundo, dentro da faixa e ainda não opacos
  const cand = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (A[i * 4 + 3] < 200 && faixa[Math.floor(y / f) * sw + Math.floor(x / f)] && dist(i) > limite) cand[i] = 1;
  }
  // limpeza: descarta pontos isolados (precisa de vizinhos também candidatos ou da peça)
  const out = cut;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (!cand[i]) continue;
    let viz = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const j = (y + dy) * w + (x + dx);
      if (cand[j] || A[j * 4 + 3] >= 200) viz++;
    }
    if (viz >= 5) {
      out.data[i * 4] = org[i * 4];
      out.data[i * 4 + 1] = org[i * 4 + 1];
      out.data[i * 4 + 2] = org[i * 4 + 2];
      out.data[i * 4 + 3] = 255;
    }
  }
  a.ctx.putImageData(out, 0, 0);
  return canvasToBlob(a.c, "image/png");
}
