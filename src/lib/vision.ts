/** Busca por imagem do Google (Cloud Vision, Web Detection): acha páginas e anúncios com imagens parecidas. */

export type VisaoResult = {
  palpites: string[];
  entidades: { descricao: string; score: number }[];
  paginas: { titulo: string; url: string; fotos: number }[];
  erro?: string;
};

const MAX_PAGINAS = 25;
const stripTags = (t: string) => t.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

type WebDetection = {
  webEntities?: { description?: string; score?: number }[];
  bestGuessLabels?: { label?: string }[];
  pagesWithMatchingImages?: { url: string; pageTitle?: string }[];
};

export async function buscaPorImagem(images: { data: string }[]): Promise<VisaoResult | null> {
  const key = process.env.GOOGLE_VISION_API_KEY;
  if (!key) return null;

  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requests: images.map((i) => ({ image: { content: i.data }, features: [{ type: "WEB_DETECTION", maxResults: 20 }] })),
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    return { palpites: [], entidades: [], paginas: [], erro: `Vision ${res.status}: ${JSON.stringify(body?.error?.message ?? body).slice(0, 300)}` };
  }

  const palpites = new Set<string>();
  const entidades = new Map<string, number>();
  const paginas = new Map<string, { titulo: string; fotos: number }>();

  for (const r of (body?.responses ?? []) as { webDetection?: WebDetection; error?: { message?: string } }[]) {
    const w = r.webDetection;
    if (!w) continue;
    w.bestGuessLabels?.forEach((b) => b.label && palpites.add(b.label));
    w.webEntities?.forEach((e) => {
      if (e.description) entidades.set(e.description, Math.max(entidades.get(e.description) ?? 0, e.score ?? 0));
    });
    w.pagesWithMatchingImages?.forEach((p) => {
      const atual = paginas.get(p.url);
      paginas.set(p.url, { titulo: stripTags(p.pageTitle ?? "") || atual?.titulo || "", fotos: (atual?.fotos ?? 0) + 1 });
    });
  }

  return {
    palpites: [...palpites],
    entidades: [...entidades].map(([descricao, score]) => ({ descricao, score })).sort((a, b) => b.score - a.score).slice(0, 12),
    // páginas que casam com mais de uma foto vêm primeiro
    paginas: [...paginas].map(([url, v]) => ({ url, ...v })).sort((a, b) => b.fotos - a.fotos).slice(0, MAX_PAGINAS),
  };
}

/** Texto que entra no pedido à IA, com a ressalva de que são pistas e não verdades. */
export function evidenciasParaIA(v: VisaoResult | null): string | undefined {
  if (!v || v.erro || (!v.paginas.length && !v.palpites.length)) return undefined;
  const linhas = [
    "Evidências da busca por imagem do Google (páginas e anúncios com imagens PARECIDAS com as fotos). Use como pistas, não como verdade:",
    "podem ser de itens parecidos porém diferentes. Um identificador que aparece em várias páginas independentes e no mesmo tipo e formato de item é mais confiável;",
    "nunca copie um código de uma página sem verificar que ela se refere ao mesmo tipo de item e formato das fotos.",
  ];
  if (v.palpites.length) linhas.push(`Melhor palpite do Google: ${v.palpites.join("; ")}`);
  if (v.entidades.length) linhas.push(`Entidades associadas: ${v.entidades.map((e) => e.descricao).join("; ")}`);
  v.paginas.slice(0, 20).forEach((p) => linhas.push(`- ${p.titulo || "(sem título)"} — ${p.url}${p.fotos > 1 ? ` (casou com ${p.fotos} fotos)` : ""}`));
  return linhas.join("\n");
}
