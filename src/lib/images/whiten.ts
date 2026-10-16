import { canvasToBlob } from "./compress";

/** Compõe o recorte em um quadrado de fundo branco, centralizado e com margem. */
export async function composeOnWhite(cutout: Blob, size = 1200, margin = 0.06): Promise<Blob> {
  const bitmap = await createImageBitmap(cutout);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  const box = size * (1 - margin * 2);
  const scale = Math.min(box / bitmap.width, box / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  bitmap.close();
  return canvasToBlob(canvas, "image/jpeg", 0.9);
}
