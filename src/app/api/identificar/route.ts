import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { identifyPart } from "@/lib/gemini";
import { getAccessToken } from "@/marketplaces/mercadolivre/accounts";
import { lookupPartNumber, type CatalogHit } from "@/marketplaces/mercadolivre/catalog";
import { BUCKET_ORIGINAIS } from "@/domain/types";
import { notasParaIA, type DadosConfirmados } from "@/domain/dados-confirmados";
import { buscaPorImagem, evidenciasParaIA, type VisaoResult } from "@/lib/vision";

export const maxDuration = 60;

const MAX_PHOTOS = 4;

const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/** Palavra que caracteriza o tipo de peça (a mais longa), p.ex. "embreagem". */
const keyword = (tipo: string | null) => norm(tipo ?? "").split(/[^a-z0-9]+/).filter((w) => w.length >= 5).sort((a, b) => b.length - a.length)[0];
const significant = (code: string) => code.replace(/[^0-9a-z]/gi, "").length >= 6;

function certainty(sources: number, catalogHits: number, mainFound: boolean, imagePages = 0) {
  const reasons: string[] = [];
  if (mainFound) reasons.push("O número principal existe no catálogo do Mercado Livre");
  else if (catalogHits) reasons.push(`${catalogHits} número(s) equivalente(s) existem no catálogo do Mercado Livre`);
  if (sources) reasons.push(`${sources} fonte(s) da web consultada(s) pela IA`);
  if (imagePages) reasons.push(`${imagePages} página(s) com imagens parecidas na busca por imagem do Google`);
  const level = (mainFound && sources >= 1) || (catalogHits >= 1 && sources >= 2) ? "alta" : mainFound || catalogHits || sources >= 2 ? "média" : "baixa";
  return { level, reasons };
}

export async function POST(request: NextRequest) {
  const { produtoId, cego } = (await request.json().catch(() => ({}))) as { produtoId?: string; cego?: boolean };
  if (!produtoId) return NextResponse.json({ error: "produtoId obrigatório" }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });

  const { data: produto } = await supabase
    .from("produtos")
    .select("id, oem_code, dados_confirmados, produto_fotos(path_original, ordem)")
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
    // Teste às cegas: ignora o que o vendedor já confirmou, para ver se dá para identificar só pelas fotos
    const confirmados = cego ? undefined : notasParaIA(produto.oem_code, produto.dados_confirmados as DadosConfirmados | null);

    // Busca por imagem (Cloud Vision): as primeiras fotos; se falhar, segue sem ela
    let visao: VisaoResult | null = null;
    try {
      visao = await buscaPorImagem(images.slice(0, 3));
    } catch (e) {
      visao = { palpites: [], entidades: [], paginas: [], erro: e instanceof Error ? e.message : "falha na busca por imagem" };
    }

    const notas = [confirmados, evidenciasParaIA(visao)].filter(Boolean).join("\n\n") || undefined;
    const gem = await identifyPart(images, notas);
    if (!gem.analysis) {
      return NextResponse.json({ error: "A IA não devolveu um JSON válido", raw: gem.text, sources: gem.sources }, { status: 502 });
    }

    // Confere cada número encontrado no catálogo do ML (evidência independente do Google)
    const a = gem.analysis;
    // Só números de peça e equivalentes; códigos de processo (lote, data...) não vão ao catálogo
    const codes = [
      ...new Set(
        [
          a.numero_peca_principal,
          ...(a.codigos ?? []).filter((c) => c.classe === "numero_de_peca" || c.classe === "equivalente").map((c) => c.codigo),
        ].filter((c): c is string => !!c && significant(c)),
      ),
    ].slice(0, 6);
    let catalog: CatalogHit[] = [];
    const token = await getAccessToken(supabase);
    if (token) catalog = await Promise.all(codes.map((c) => lookupPartNumber(token, c.replace(/\s+/g, ""))));

    // Só vale o que o ML reconhece como número de peça E é do mesmo tipo de peça
    const kw = keyword(a.tipo_item);
    catalog = catalog.map((c) => {
      const relevante = c.exact && (!kw || c.products.some((p) => norm(p.name).includes(kw)));
      return { ...c, relevante, ignorado: c.exact && !relevante ? "existe no catálogo, mas é outro tipo de peça (ignorado)" : undefined };
    });

    const mainFound = catalog.some((c) => c.relevante && c.code === a.numero_peca_principal?.replace(/\s+/g, ""));
    const result = {
      analysis: a,
      narrativa: gem.narrativa,
      visao,
      cego: !!cego,
      sources: gem.sources,
      catalog,
      certeza: certainty(gem.sources.length, catalog.filter((c) => c.relevante).length, mainFound, visao?.paginas.length ?? 0),
      model: gem.model,
      buscaWeb: gem.pesquisou,
      consultas: gem.consultas,
      tentativas: gem.tentativas,
      geradoEm: new Date().toISOString(),
    };
    await supabase.from("produtos").update({ identificacao: result, identificado_em: result.geradoEm }).eq("id", produtoId);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "falha" }, { status: 500 });
  }
}
