/**
 * Busca por imagem (Google Lens) via SerpApi: compara a foto com anúncios de lojas e acha peças pelo formato,
 * onde a pesquisa por texto não chega (coxins, buchas, juntas). Desligada sem SERPAPI_KEY.
 */
export type LensMatch = { titulo: string; fonte: string | null; preco: string | null };

/** Texto da "visão geral por IA" do Google, quando a resposta o traz (a estrutura varia). */
function textoOverview(o: unknown): string {
  if (!o) return "";
  if (typeof o === "string") return o;
  const blocos = (o as { text_blocks?: { snippet?: string; list?: { snippet?: string }[] }[] }).text_blocks;
  if (Array.isArray(blocos)) {
    return blocos.map((b) => [b.snippet, ...(b.list ?? []).map((l) => l.snippet)].filter(Boolean).join(" ")).filter(Boolean).join("\n");
  }
  const t = (o as { text?: string; snippet?: string }).text ?? (o as { snippet?: string }).snippet;
  return typeof t === "string" ? t : "";
}

export const lensAtivo = () => !!process.env.SERPAPI_KEY;

export async function buscaLens(imageUrl: string, timeoutMs = 42000): Promise<{ matches: LensMatch[]; overview?: string; erro?: string; chaves?: string[]; ms?: number } | null> {
  const key = process.env.SERPAPI_KEY;
  if (!key) return null;
  const t0 = Date.now();
  try {
    const u = new URL("https://serpapi.com/search.json");
    u.searchParams.set("engine", "google_lens");
    u.searchParams.set("url", imageUrl);
    u.searchParams.set("hl", "pt-br");
    u.searchParams.set("country", "br");
    u.searchParams.set("api_key", key);
    const res = await fetch(u, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      ai_overview?: unknown;
      visual_matches?: { title?: string; source?: string; price?: { value?: string; extracted_value?: number } | string }[];
    } | null;
    if (!res.ok || body?.error) return { matches: [], erro: body?.error ?? `HTTP ${res.status}`, chaves: Object.keys(body ?? {}), ms: Date.now() - t0 };
    const matches = (body?.visual_matches ?? [])
      .filter((m) => m.title)
      .slice(0, 10)
      .map((m) => ({
        titulo: String(m.title),
        fonte: m.source ?? null,
        preco: typeof m.price === "string" ? m.price : m.price?.value ?? null,
      }));
    return { matches, overview: textoOverview(body?.ai_overview).slice(0, 1500) || undefined, chaves: Object.keys(body ?? {}), ms: Date.now() - t0 };
  } catch (e) {
    return { matches: [], erro: e instanceof Error ? e.message : "falha na busca por imagem", ms: Date.now() - t0 };
  }
}

/** Texto que acompanha a pesquisa na web: títulos de anúncios parecidos (pistas, nunca confirmação). */
export const textoLens = (matches: LensMatch[], overview?: string) =>
  matches.length || overview
    ? `${overview ? `Resumo do Google para a imagem: ${overview}\n\n` : ""}Resultados da busca por imagem do Google (anúncios com fotos parecidas; podem ser de peças diferentes, são só pistas):\n${matches
        .map((m) => `- ${m.titulo}${m.fonte ? ` (${m.fonte})` : ""}${m.preco ? ` ${m.preco}` : ""}`)
        .join("\n")}`
    : "";
