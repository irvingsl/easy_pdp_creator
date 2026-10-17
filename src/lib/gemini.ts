const API = "https://generativelanguage.googleapis.com/v1beta";
/** Preferidos, na ordem; depois completamos com o que a própria chave enxerga. */
const PREFERRED = ["gemini-3.8-flash", "gemini-3.8-flash-lite", "gemini-2.5-flash-lite", "gemini-2.5-flash"];
const MAX_MODELS = 6;
let lastGood: string | null = null;

export type PartAnalysis = {
  tipo_peca: string | null;
  marca: string | null;
  textos_gravados: string[];
  numero_peca_principal: string | null;
  outros_numeros: { marca: string | null; numero: string; tipo: string | null }[];
  caracteristicas: { diametro_mm: number | null; estrias: number | null; outras: string | null };
  aplicacoes: { veiculo: string; motor: string | null; anos: string | null; confirmado: boolean }[];
  preco: { minimo: number | null; maximo: number | null; observacao: string | null };
  termos_busca: string[];
  categoria_sugerida_texto: string | null;
  duvidas: string[];
};

export type GeminiResult = {
  analysis: PartAnalysis | null;
  text: string;
  sources: { title: string; uri: string }[];
  model: string;
  /** false quando a busca na web ficou indisponível (cota) e a IA respondeu só pelas fotos */
  grounded: boolean;
  tentativas: { model: string; grounded: boolean; status: number }[];
};

const SCHEMA = `{
  "tipo_peca": string|null,
  "marca": string|null,
  "textos_gravados": string[],
  "numero_peca_principal": string|null,
  "outros_numeros": [{"marca": string|null, "numero": string, "tipo": "original"|"equivalente"|null}],
  "caracteristicas": {"diametro_mm": number|null, "estrias": number|null, "outras": string|null},
  "aplicacoes": [{"veiculo": string, "motor": string|null, "anos": string|null, "confirmado": boolean}],
  "preco": {"minimo": number|null, "maximo": number|null, "observacao": string|null},
  "termos_busca": string[],
  "categoria_sugerida_texto": string|null,
  "duvidas": string[]
}`;

function buildPrompt(grounded: boolean) {
  return `Você é especialista em autopeças brasileiras. As fotos mostram a MESMA peça automotiva, de estoque antigo, sem informação nenhuma sobre ela.

Regras gerais:
- Transcreva em "textos_gravados" tudo o que estiver gravado ou impresso na peça (marca, códigos, lote, composto da lona).
- Não invente códigos, medidas nem aplicações. Na dúvida, use null ou [].
- NÃO estime diâmetro e NÃO conte estrias a partir da foto: só informe esses valores se uma fonte confirmar; senão null.
- Códigos de lote, data ou composto da lona (ex.: "2050", "RD/77", "03 19") NÃO são número de peça: não os coloque em numero_peca_principal nem em outros_numeros.
${
  grounded
    ? `- Pesquise na web (anúncios, catálogos de fabricantes) para achar o número de peça do fabricante, os cruzamentos, as aplicações e o preço.
- "confirmado" em cada aplicação só pode ser true se uma fonte da web sustenta isso.
- Preço: faixa de mercado para a peça AVULSA nova (não kit), em reais; null se não achar.`
    : `- ATENÇÃO: nesta chamada você NÃO tem acesso à web. Responda só com o que é legível nas fotos.
- Deixe numero_peca_principal, outros_numeros, aplicacoes e preco vazios/null, a menos que o número de peça esteja gravado e legível na peça.
- Em "duvidas", liste o que precisaria ser pesquisado (número de peça, aplicação, medidas).`
}

Responda SOMENTE com um JSON válido (sem texto antes ou depois) neste formato:
${SCHEMA}`;
}

function extractJson(text: string): PartAnalysis | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    return JSON.parse(candidate) as PartAnalysis;
  } catch {
    return null;
  }
}

async function listModels(key: string): Promise<string[]> {
  try {
    const res = await fetch(`${API}/models?pageSize=100`, { headers: { "x-goog-api-key": key } });
    const body = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    return (body.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/image|tts|live|audio|embedding|thinking|exp/.test(n));
  } catch {
    return [];
  }
}

/** Todos os modelos de texto que a chave enxerga (para diagnóstico). */
export async function listAllModels(key: string): Promise<string[]> {
  const res = await fetch(`${API}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
  const body = (await res.json().catch(() => null)) as { models?: { name: string; supportedGenerationMethods?: string[] }[] } | null;
  return (body?.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => n.startsWith("gemini-") && !/image|tts|live|audio|embedding|robotics|computer|deep-research|vision/.test(n))
    .sort();
}

/** Uma pergunta curta que exige busca na web; diz se o modelo respondeu e se usou a busca. */
export async function probeGrounding(model: string) {
  const res = await fetch(`${API}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "Pesquise na web: qual é o número de peça LuK do disco de embreagem do Chevrolet Opala 4 cilindros? Responda em uma frase." }] }],
      tools: [{ google_search: {} }],
    }),
  });
  const body = await res.json().catch(() => null);
  const cand = body?.candidates?.[0];
  return {
    model,
    status: res.status,
    comBusca: !!(cand?.groundingMetadata?.groundingChunks?.length || cand?.groundingMetadata?.webSearchQueries?.length),
    fontes: cand?.groundingMetadata?.groundingChunks?.length ?? 0,
    resposta: ((cand?.content?.parts ?? []) as { text?: string }[]).map((p) => p.text ?? "").join("").slice(0, 200),
    erro: res.ok ? "" : String(body?.error?.message ?? "").slice(0, 200),
  };
}

async function candidateModels(key: string): Promise<string[]> {
  const set = new Set<string>();
  if (process.env.GEMINI_MODEL) set.add(process.env.GEMINI_MODEL);
  if (lastGood) set.add(lastGood);
  PREFERRED.forEach((m) => set.add(m));
  if (set.size < MAX_MODELS) (await listModels(key)).sort().reverse().forEach((m) => set.add(m));
  return [...set].slice(0, MAX_MODELS);
}

async function generate(model: string, images: { mime: string; data: string }[], notes: string | undefined, grounded: boolean) {
  const key = process.env.GEMINI_API_KEY!;
  const res = await fetch(`${API}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: notes ? `${buildPrompt(grounded)}\n\nInformação do vendedor: ${notes}` : buildPrompt(grounded) },
            ...images.map((i) => ({ inline_data: { mime_type: i.mime, data: i.data } })),
          ],
        },
      ],
      ...(grounded ? { tools: [{ google_search: {} }] } : {}),
      generationConfig: { temperature: 0.2 },
    }),
  });
  const body = await res.json().catch(() => null);
  return { res, body };
}

/**
 * Passo 1: tenta todos os modelos COM busca na web (qualquer um com cota serve).
 * Passo 2: só se nenhum tiver, tenta sem a busca, e a IA é instruída a não chutar.
 */
export async function identifyPart(images: { mime: string; data: string }[], notes?: string): Promise<GeminiResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Defina GEMINI_API_KEY");

  const models = await candidateModels(key);
  const dead = new Set<string>(); // 404/400: modelo indisponível
  const tentativas: GeminiResult["tentativas"] = [];
  let lastError = "";

  for (const grounded of [true, false]) {
    for (const model of models) {
      if (dead.has(model)) continue;
      const { res, body } = await generate(model, images, notes, grounded);
      tentativas.push({ model, grounded, status: res.status });
      if (res.ok) {
        lastGood = model;
        const cand = body?.candidates?.[0];
        const text: string = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
        const sources = ((cand?.groundingMetadata?.groundingChunks ?? []) as { web?: { uri: string; title: string } }[])
          .filter((c) => c.web)
          .map((c) => ({ title: c.web!.title, uri: c.web!.uri }));
        return { analysis: extractJson(text), text, sources, model, grounded, tentativas };
      }
      lastError = `Gemini ${res.status} (${model}): ${JSON.stringify(body?.error ?? body).slice(0, 300)}`;
      if (res.status !== 429) dead.add(model);
    }
  }
  throw new Error(`${lastError} | tentativas: ${tentativas.map((t) => `${t.model}${t.grounded ? "+web" : ""}=${t.status}`).join(", ")}. Veja https://ai.dev/rate-limit`);
}
