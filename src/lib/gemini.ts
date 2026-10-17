const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";

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
};

const PROMPT = `Você é especialista em autopeças brasileiras. As fotos mostram a MESMA peça automotiva, de estoque antigo, sem informação nenhuma sobre ela.
Leia o que está gravado ou impresso na peça, pesquise na web (anúncios, catálogos de fabricantes) e identifique-a.

Regras:
- Não invente códigos, medidas nem aplicações. Se não souber, use null ou [].
- "confirmado" em cada aplicação só pode ser true se uma fonte da web sustenta isso.
- Preço: faixa de mercado para a peça AVULSA nova (não kit), em reais; use null se não achar.
- Diferencie número de peça do fabricante de códigos de lote/composto gravados na peça.

Responda SOMENTE com um JSON válido (sem texto antes ou depois) neste formato:
{
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

function extractJson(text: string): PartAnalysis | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    return JSON.parse(candidate) as PartAnalysis;
  } catch {
    return null;
  }
}

async function generate(images: { mime: string; data: string }[], notes: string | undefined, grounded: boolean) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Defina GEMINI_API_KEY");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: notes ? `${PROMPT}\n\nInformação do vendedor: ${notes}` : PROMPT },
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

export async function identifyPart(images: { mime: string; data: string }[], notes?: string): Promise<GeminiResult> {
  let grounded = true;
  let { res, body } = await generate(images, notes, true);
  if (res.status === 429) {
    // Sem cota para busca na web: tenta só com as fotos
    grounded = false;
    ({ res, body } = await generate(images, notes, false));
  }
  if (!res.ok) {
    const quota = res.status === 429 ? " Cota do Gemini esgotada para este modelo; veja https://ai.dev/rate-limit ou defina GEMINI_MODEL." : "";
    throw new Error(`Gemini ${res.status}: ${JSON.stringify(body?.error ?? body).slice(0, 500)}${quota}`);
  }

  const cand = body?.candidates?.[0];
  const text: string = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  const sources = ((cand?.groundingMetadata?.groundingChunks ?? []) as { web?: { uri: string; title: string } }[])
    .filter((c) => c.web)
    .map((c) => ({ title: c.web!.title, uri: c.web!.uri }));
  return { analysis: extractJson(text), text, sources, model: MODEL, grounded };
}
