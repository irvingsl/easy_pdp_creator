export class UnsupportedImageError extends Error {
  constructor(name: string) {
    super(`Não consegui abrir a foto "${name}". Use JPG, PNG, WebP ou HEIC.`);
  }
}

async function toBitmap(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return createImageBitmap(file);
  }
}

/** Abre a foto; se o navegador não decodifica (ex.: HEIC no Chrome), converte para JPEG antes. */
async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await toBitmap(file);
  } catch {
    try {
      const { heicTo, isHeic } = await import("heic-to");
      if (!(await isHeic(file))) throw new Error("not heic");
      const jpeg = await heicTo({ blob: file, type: "image/jpeg", quality: 0.9 });
      return await toBitmap(jpeg);
    } catch {
      throw new UnsupportedImageError(file.name);
    }
  }
}

/** Reduz a foto no navegador antes do upload (economiza storage e banda). */
export async function compressImage(file: File, maxSide = 2000, quality = 0.85): Promise<Blob> {
  const bitmap = await decode(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvasToBlob(canvas, "image/jpeg", quality);
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("falha ao gerar imagem"))), type, quality),
  );
}
