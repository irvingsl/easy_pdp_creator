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
