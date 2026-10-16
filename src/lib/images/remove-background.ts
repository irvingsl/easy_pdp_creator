/** Troque a implementação (ex.: Photoroom) sem mexer no resto do app. */
export interface BackgroundRemover {
  /** Recebe a foto e devolve um PNG com fundo transparente. */
  remove(image: Blob): Promise<Blob>;
}

/** Gratuito: roda no navegador (WASM). O modelo (~40 MB) é baixado na 1ª vez. */
export const browserRemover: BackgroundRemover = {
  async remove(image) {
    const { removeBackground } = await import("@imgly/background-removal");
    return removeBackground(image, { output: { format: "image/png" } });
  },
};
