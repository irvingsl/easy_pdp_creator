export class UnsupportedImageError extends Error {
  constructor(file: File) {
    const mb = (file.size / 1e6).toFixed(1);
    super(`${file.name} (${file.type || "tipo desconhecido"}, ${mb} MB)`);
  }
}

/** Lê só as dimensões (sem decodificar a imagem inteira). */
function readSize(file: Blob): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      reject(new Error("sem dimensões"));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/**
 * Fotos de 50-108 MP estouram a memória do Chrome no Android se abertas inteiras.
 * Pedimos ao navegador que já reduza na decodificação.
 */
async function toBitmap(file: Blob, maxSide: number): Promise<ImageBitmap> {
  const base = { imageOrientation: "from-image" } as const;
  try {
    const { w, h } = await readSize(file);
    if (Math.max(w, h) > maxSide) {
      const resize = w >= h ? { resizeWidth: maxSide } : { resizeHeight: maxSide };
      return await createImageBitmap(file, { ...base, ...resize, resizeQuality: "medium" });
    }
  } catch {
    // segue para a abertura direta
  }
  try {
    return await createImageBitmap(file, base);
  } catch {
    return createImageBitmap(file);
  }
}

/** Abre a foto; se o navegador não decodifica (ex.: HEIC no Chrome), converte para JPEG antes. */
async function decode(file: File, maxSide: number): Promise<ImageBitmap> {
  try {
    return await toBitmap(file, maxSide);
  } catch {
    try {
      const { heicTo, isHeic } = await import("heic-to");
      if (!(await isHeic(file))) throw new Error("not heic");
      const jpeg = await heicTo({ blob: file, type: "image/jpeg", quality: 0.9 });
      return await toBitmap(jpeg, maxSide);
    } catch {
      throw new UnsupportedImageError(file);
    }
  }
}

/** Reduz a foto no navegador antes do upload (economiza storage e banda). */
export async function compressImage(file: File, maxSide = 2000, quality = 0.85): Promise<Blob> {
  const bitmap = await decode(file, maxSide);
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
