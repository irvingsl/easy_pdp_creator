/** Troque a implementação (ex.: Photoroom) sem mexer no resto do app. */
export interface BackgroundRemover {
  /** Recebe a foto e devolve um PNG com fundo transparente. */
  remove(image: Blob): Promise<Blob>;
}

type Config = { model?: "isnet" | "isnet_fp16" | "isnet_quint8"; device?: "cpu" | "gpu" };

const isMobile = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

/** Modelo menor e processamento na CPU: usa bem menos memória (celulares costumam falhar com o padrão). */
const LEVE: Config = { model: "isnet_quint8", device: "cpu" };
const PADRAO: Config = { device: "cpu" };
// chave nova: descarta a configuração (WebGPU) que ficou gravada e produzia máscaras estragadas
const CHAVE = "bgConfig2";
const marcarTentativa = (i: number | null) => {
  try {
    if (i == null) window.localStorage.removeItem("bgTentando");
    else window.localStorage.setItem("bgTentando", String(i));
  } catch {
    /* ignora */
  }
};
const lembrada = (): number | null => {
  try {
    const v = window.localStorage.getItem(CHAVE);
    return v == null ? null : Number(v);
  } catch {
    return null;
  }
};
const lembrar = (i: number) => {
  try {
    window.localStorage.setItem(CHAVE, String(i));
  } catch {
    /* sem armazenamento: só perde a otimização */
  }
};

/**
 * Ordem de tentativas. A que funcionou da última vez vai primeiro: evita baixar/iniciar de novo um modelo que falha.
 * O navegador reaproveita o modelo já baixado (cache), então só a primeira vez na vida do aparelho baixa de verdade.
 */
function tentativas(): Config[] {
  const base = isMobile() ? [LEVE, PADRAO] : [PADRAO, LEVE];
  // se a última tentativa de uma configuração nem terminou (aba travou/fechou por falta de memória), ela vai para o fim
  let travada: number | null = null;
  try {
    const t = window.localStorage.getItem("bgTentando");
    if (t != null) {
      travada = Number(t);
      window.localStorage.removeItem("bgTentando");
    }
  } catch {
    /* ignora */
  }
  const i = lembrada();
  let ordem = base.map((_, j) => j);
  if (i != null && base[i] && i !== travada) ordem = [i, ...ordem.filter((j) => j !== i)];
  if (travada != null && base[travada]) ordem = [...ordem.filter((j) => j !== travada), travada];
  return ordem.map((j) => base[j]);
}
const indiceBase = (c: Config) => (isMobile() ? [LEVE, PADRAO] : [PADRAO, LEVE]).indexOf(c);

/** Mesma configuração em toda chamada: a biblioteca guarda a sessão do modelo e só a 1ª foto paga a inicialização. */
const completa = (config: Config) => ({
  ...config,
  // reaproveita o que já está no cache do navegador, sem perguntar ao servidor se mudou (menos viagens na rede)
  fetchArgs: { cache: "force-cache" },
  output: { format: "image/png" as const },
});

/** O recorte parece válido? Uma máscara estragada deixa quase nada opaco (ou tudo). */
async function recorteValido(png: Blob): Promise<boolean> {
  try {
    const bmp = await createImageBitmap(png);
    const lado = 96;
    const c = document.createElement("canvas");
    c.width = c.height = lado;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, lado, lado);
    bmp.close();
    const { data } = ctx.getImageData(0, 0, lado, lado);
    let opacos = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 200) opacos++;
    const razao = opacos / (lado * lado);
    return razao > 0.05 && razao < 0.995;
  } catch {
    return true; // não conseguiu checar: não bloqueia
  }
}

/** Gratuito: roda no navegador (WASM/WebGPU). O modelo é baixado na 1ª vez e fica em cache. */
export const browserRemover: BackgroundRemover = {
  async remove(image) {
    const { removeBackground } = await import("@imgly/background-removal");
    let ultimo: unknown;
    for (const config of tentativas()) {
      try {
        marcarTentativa(indiceBase(config));
        const r = await removeBackground(image, completa(config));
        if (!(await recorteValido(r))) throw new Error("o recorte saiu vazio ou estragado");
        marcarTentativa(null);
        lembrar(indiceBase(config));
        return r;
      } catch (e) {
        marcarTentativa(null);
        ultimo = e;
      }
    }
    throw ultimo instanceof Error ? ultimo : new Error("falha ao remover o fundo");
  },
};

let aquecido = false;
/**
 * Baixa e inicia o modelo em segundo plano, antes de a primeira foto chegar, para a remoção do fundo não esperar.
 * Usa a mesma configuração que a remoção usará (a biblioteca só reaproveita a sessão se for idêntica).
 */
export async function aquecerModelo() {
  if (aquecido || typeof window === "undefined") return;
  aquecido = true;
  try {
    const { preload } = await import("@imgly/background-removal");
    for (const config of tentativas()) {
      try {
        await preload(completa(config));
        return;
      } catch {
        /* tenta a próxima configuração */
      }
    }
  } catch {
    aquecido = false;
  }
}
