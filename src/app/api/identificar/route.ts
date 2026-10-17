import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { identifyPart } from "@/lib/gemini";
import { getAccessToken } from "@/marketplaces/mercadolivre/accounts";
import { lookupPartNumber, type CatalogHit } from "@/marketplaces/mercadolivre/catalog";
import { BUCKET_ORIGINAIS } from "@/domain/types";

export const maxDuration = 60;

const MAX_PHOTOS = 4;

function certainty(sources: number, catalogHits: number, mainFound: boolean) {
  const reasons: string[] = [];
  if (mainFound) reasons.push("O número principal existe no catálogo do Mercado Livre");
  else if (catalogHits) reasons.push(`${catalogHits} número(s) equivalente(s) existem no catálogo do Mercado Livre`);
  if (sources) reasons.push(`${sources} fonte(s) da web consultada(s) pela IA`);
  const level = (mainFound && sources >= 1) || (catalogHits >= 1 && sources >= 2) ? "alta" : mainFound || catalogHits || sources >= 2 ? "média" : "baixa";
  return { level, reasons };
}

export async function POST(request: NextRequest) {
  const { produtoId } = (await request.json().catch(() => ({}))) as { produtoId?: string };
  if (!produtoId) return NextResponse.json({ error: "produtoId obrigatório" }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });

  const { data: produto } = await supabase
    .from("produtos")
    .select("id, oem_code, produto_fotos(path_original, ordem)")
    .eq("id", produtoId)
    .maybeSingle();
  if (!produto) return NextResponse.json({ error: "produto não encontrado" }, { status: 404 });

  const paths = [...produto.produto_fotos].sort((a, b) => a.ordem - b.ordem).slice(0, MAX_PHOTOS).map((f) => f.path_original);
  if (!paths.length) return NextResponse.json({ error: "o produto não tem fotos" }, { status: 400 });

  try {
    const images = await Promise.all(
      paths.map(async (p) => {
        const { data, error } = await supabase.storage.from(BUCKET_ORIGINAIS).download(p);
        if (error) throw error;
        return { mime: "image/jpeg", data: Buffer.from(await data.arrayBuffer()).toString("base64") };
      }),
    );
    const gem = await identifyPart(images, produto.oem_code ? `Código informado: ${produto.oem_code}` : undefined);
    if (!gem.analysis) {
      return NextResponse.json({ error: "A IA não devolveu um JSON válido", raw: gem.text, sources: gem.sources }, { status: 502 });
    }

    // Confere cada número encontrado no catálogo do ML (evidência independente do Google)
    const a = gem.analysis;
    const codes = [...new Set([a.numero_peca_principal, ...(a.outros_numeros ?? []).map((n) => n.numero)].filter((c): c is string => !!c))].slice(0, 6);
    let catalog: CatalogHit[] = [];
    const token = await getAccessToken(supabase);
    if (token) catalog = await Promise.all(codes.map((c) => lookupPartNumber(token, c.replace(/\s+/g, ""))));

    const mainFound = catalog.some((c) => c.exact && c.code === a.numero_peca_principal?.replace(/\s+/g, ""));
    const result = {
      analysis: a,
      sources: gem.sources,
      catalog,
      certeza: certainty(gem.sources.length, catalog.filter((c) => c.exact).length, mainFound),
      model: gem.model,
      buscaWeb: gem.grounded,
      geradoEm: new Date().toISOString(),
    };
    await supabase.from("produtos").update({ identificacao: result, identificado_em: result.geradoEm }).eq("id", produtoId);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "falha" }, { status: 500 });
  }
}
