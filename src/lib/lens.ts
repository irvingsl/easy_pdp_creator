/**
 * Busca por imagem (Google Lens) via SerpApi: compara a foto com anúncios de lojas e acha peças pelo formato,
 * onde a pesquisa por texto não chega (coxins, buchas, juntas). Desligada sem SERPAPI_KEY.
 */
export type LensMatch = { titulo: string; fonte: string | null; preco: string | null };

export const lensAtivo = () => !!process.env.SERPAPI_KEY;

export async function buscaLens(imageUrl: string, timeoutMs = 25000): Promise<{ matches: LensMatch[]; erro?: string } | null> {
  const key = process.env.SERPAPI_KEY;
  if (!key) return null;
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
      visual_matches?: { title?: string; source?: string; price?: { value?: string; extracted_value?: number } | string }[];
    } | null;
    if (!res.ok || body?.error) return { matches: [], erro: body?.error ?? `HTTP ${res.status}` };
    const matches = (body?.visual_matches ?? [])
      .filter((m) => m.title)
      .slice(0, 10)
      .map((m) => ({
        titulo: String(m.title),
        fonte: m.source ?? null,
        preco: typeof m.price === "string" ? m.price : m.price?.value ?? null,
      }));
    return { matches };
  } catch (e) {
    return { matches: [], erro: e instanceof Error ? e.message : "falha na busca por imagem" };
  }
}

/** Texto que acompanha a pesquisa na web: títulos de anúncios parecidos (pistas, nunca confirmação). */
export const textoLens = (matches: LensMatch[]) =>
  matches.length
    ? `Resultados da busca por imagem do Google (anúncios com fotos parecidas; podem ser de peças diferentes, são só pistas):\n${matches
        .map((m) => `- ${m.titulo}${m.fonte ? ` (${m.fonte})` : ""}${m.preco ? ` ${m.preco}` : ""}`)
        .join("\n")}`
    : "";
