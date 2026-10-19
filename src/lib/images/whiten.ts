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
