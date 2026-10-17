/** Troque a implementação (ex.: Photoroom) sem mexer no resto do app. */
export interface BackgroundRemover {
  /** Recebe a foto e devolve um PNG com fundo transparente. */
  remove(image: Blob): Promise<Blob>;
}

type Config = { model?: "isnet" | "isnet_fp16" | "isnet_quint8"; device?: "cpu" | "gpu" };

const isMobile = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

/** Modelo menor e processamento na CPU: usa bem menos memória (celulares costumam falhar com o padrão). */
const LEVE: Config = { model: "isnet_quint8", device: "cpu" };
const PADRAO: Config = {};

/** Gratuito: roda no navegador (WASM). O modelo é baixado na 1ª vez. No celular começa pela configuração leve. */
export const browserRemover: BackgroundRemover = {
  async remove(image) {
    const { removeBackground } = await import("@imgly/background-removal");
    const tentativas = isMobile() ? [LEVE, PADRAO] : [PADRAO, LEVE];
    let ultimo: unknown;
    for (const config of tentativas) {
      try {
        return await removeBackground(image, { ...config, output: { format: "image/png" } });
      } catch (e) {
        ultimo = e;
      }
    }
    throw ultimo instanceof Error ? ultimo : new Error("falha ao remover o fundo");
  },
};
