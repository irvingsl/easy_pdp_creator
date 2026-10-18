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
/** Placa de vídeo (WebGPU): várias vezes mais rápido onde o navegador permite; cai para a CPU se falhar. */
const GPU: Config = { model: "isnet_fp16", device: "gpu" };

const CHAVE = "bgConfig";
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
  const base = isMobile() ? [GPU, LEVE, PADRAO] : [GPU, PADRAO, LEVE];
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
const indiceBase = (c: Config) => (isMobile() ? [GPU, LEVE, PADRAO] : [GPU, PADRAO, LEVE]).indexOf(c);

/** Mesma configuração em toda chamada: a biblioteca guarda a sessão do modelo e só a 1ª foto paga a inicialização. */
const completa = (config: Config) => ({
  ...config,
  // reaproveita o que já está no cache do navegador, sem perguntar ao servidor se mudou (menos viagens na rede)
  fetchArgs: { cache: "force-cache" },
  output: { format: "image/png" as const },
});

/** Gratuito: roda no navegador (WASM/WebGPU). O modelo é baixado na 1ª vez e fica em cache. */
export const browserRemover: BackgroundRemover = {
  async remove(image) {
    const { removeBackground } = await import("@imgly/background-removal");
    let ultimo: unknown;
    for (const config of tentativas()) {
      try {
        marcarTentativa(indiceBase(config));
        const r = await removeBackground(image, completa(config));
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
