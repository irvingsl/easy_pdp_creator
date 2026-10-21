import sharp from "sharp";

/**
 * Remoção de fundo no servidor. Dois provedores, escolhidos pelas variáveis de ambiente:
 *  - REPLICATE_API_TOKEN: API do Replicate (paga por uso, centavos por foto); o fundo branco é aplicado aqui
 *  - FUNDO_URL (+ FUNDO_TOKEN): Space próprio no Hugging Face (pasta hf-space/)
 */
export const fundoNoServidorAtivo = () => !!process.env.REPLICATE_API_TOKEN || !!process.env.FUNDO_URL;

// dono/nome do modelo no Replicate (ex.: "men1scus/birefnet"); troque pela variável REPLICATE_MODELO, sem mexer no código
const MODELO_REPLICATE = process.env.REPLICATE_MODELO ?? "851-labs/background-remover";
let versaoEmCache: { modelo: string; id: string } | null = null;

/** Modelos da comunidade só aceitam chamada pelo identificador da versão: busca a mais recente. */
async function versaoDoModelo(cabecalho: Record<string, string>): Promise<string> {
  if (versaoEmCache?.modelo === MODELO_REPLICATE) return versaoEmCache.id;
  const r = await fetch(`https://api.replicate.com/v1/models/${MODELO_REPLICATE}`, { headers: cabecalho, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Replicate: modelo ${MODELO_REPLICATE} não encontrado (HTTP ${r.status})`);
  const id = ((await r.json()) as { latest_version?: { id?: string } }).latest_version?.id;
  if (!id) throw new Error(`Replicate: o modelo ${MODELO_REPLICATE} não tem versão publicada`);
  versaoEmCache = { modelo: MODELO_REPLICATE, id };
  return id;
}

type Resultado = { jpeg: Blob; area: number };

async function viaReplicate(original: Blob, sensibilidade: number, timeoutMs: number): Promise<Resultado> {
  const token = process.env.REPLICATE_API_TOKEN!;
  const cabecalho = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const dataUri = `data:image/jpeg;base64,${Buffer.from(await original.arrayBuffer()).toString("base64")}`;
  const ini = Date.now();
  const version = await versaoDoModelo(cabecalho);
  // Contas com pouco crédito têm limite baixo (6 pedidos por minuto): no 429 espera o tempo que o Replicate pede e tenta de novo
  let r: Response;
  for (let tentativa = 0; ; tentativa++) {
    r = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: { ...cabecalho, prefer: "wait=50" },
      body: JSON.stringify({ version, input: { image: dataUri } }),
      signal: AbortSignal.timeout(Math.max(5000, timeoutMs - (Date.now() - ini))),
    });
    if (r.status !== 429 || tentativa >= 2) break;
    const espera = Number(((await r.json().catch(() => ({}))) as { retry_after?: number }).retry_after);
    const ms = Math.min(15000, ((Number.isFinite(espera) ? espera : 8) + 1) * 1000);
    if (Date.now() - ini + ms > timeoutMs - 15000) break;
    await new Promise((ok) => setTimeout(ok, ms));
  }
  let p = (await r.json()) as { status: string; output?: string | string[]; error?: string; urls?: { get?: string } };
  while ((p.status === "starting" || p.status === "processing") && p.urls?.get && Date.now() - ini < timeoutMs) {
    await new Promise((ok) => setTimeout(ok, 1500));
    r = await fetch(p.urls.get, { headers: cabecalho, signal: AbortSignal.timeout(15000) });
    p = (await r.json()) as typeof p;
  }
  if (p.status !== "succeeded") throw new Error(`Replicate: ${p.status}${p.error ? ` (${p.error})` : ""}`);
  const url = Array.isArray(p.output) ? p.output[0] : p.output;
  if (!url) throw new Error("Replicate: sem imagem na resposta");
  const png = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(20000) })).arrayBuffer());
  // A sensibilidade ajusta a transparência das bordas do recorte do modelo (mesma curva do Space):
  // alta mantém mais do que o modelo deixou semitransparente; baixa limpa mais a borda. Parte que o modelo apagou por completo não volta.
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const limiar = 0.5 - (0.4 * (Math.max(0, Math.min(100, sensibilidade)) - 50)) / 50;
  let opacos = 0;
  for (let i = 3; i < data.length; i += 4) {
    const a = Math.max(0, Math.min(1, (data[i] / 255 - limiar) / 0.2 + 0.5));
    data[i] = Math.round(a * 255);
    if (a > 0.5) opacos++;
  }
  const jpeg = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer();
  return { jpeg: new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), area: opacos / (info.width * info.height || 1) };
}

async function viaSpace(original: Blob, sensibilidade: number, timeoutMs: number): Promise<Resultado> {
  const base = process.env.FUNDO_URL!.replace(/\/$/, "");
  const form = new FormData();
  form.append("imagem", original, "foto.jpg");
  form.append("sensibilidade", String(Math.round(sensibilidade)));
  const r = await fetch(`${base}/remover`, {
    method: "POST",
    headers: { "x-token": process.env.FUNDO_TOKEN ?? "" },
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`servidor de fundo: HTTP ${r.status}`);
  return { jpeg: new Blob([await r.arrayBuffer()], { type: "image/jpeg" }), area: Number(r.headers.get("x-area-recorte") ?? "1") };
}

/** Devolve o JPEG já com fundo branco e a fração da imagem que ficou como peça (para detectar recorte vazio). */
export const removerFundoNoServidor = (original: Blob, sensibilidade: number, timeoutMs = 50000): Promise<Resultado> =>
  process.env.REPLICATE_API_TOKEN ? viaReplicate(original, sensibilidade, timeoutMs) : viaSpace(original, sensibilidade, timeoutMs);
