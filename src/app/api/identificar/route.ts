import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { identifyPart, pesquisaFocada, type PartAnalysis } from "@/lib/gemini";
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

type Parcial = {
  analysis: PartAnalysis;
  narrativa: string;
  sources: { title: string; uri: string }[];
  consultas: string[];
  pesquisou: boolean;
  model: string;
  grounded?: boolean;
  tentativas: { model: string; grounded: boolean; status: number }[];
  visao?: VisaoResult | null;
  perguntaPesquisa?: string;
};

/**
 * A identificação roda em 3 etapas, cada uma numa chamada própria (o cliente as encadeia),
 * para que nenhuma estoure o tempo máximo da função:
 *  "fotos"    -> Gemini lê as fotos (com busca na web)
 *  "pesquisa" -> pesquisa focada, só se a 1ª etapa não pesquisou
 *  "final"    -> confere no catálogo do ML, calcula a certeza e salva
 */
export async function POST(request: NextRequest) {
  const { produtoId, cego, etapa = "fotos", parcial } = (await request.json().catch(() => ({}))) as {
    produtoId?: string;
    cego?: boolean;
    etapa?: "fotos" | "pesquisa" | "final";
    parcial?: Parcial;
  };
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

  // Teste às cegas: ignora o que o vendedor já confirmou, para ver se dá para identificar só pelas fotos
  const confirmados = cego ? undefined : notasParaIA(produto.oem_code, produto.dados_confirmados as DadosConfirmados | null);

  try {
    if (etapa === "fotos") {
      const paths = [...produto.produto_fotos].sort((a, b) => a.ordem - b.ordem).slice(0, MAX_PHOTOS).map((f) => f.path_original);
      if (!paths.length) return NextResponse.json({ error: "o produto não tem fotos" }, { status: 400 });
      const images = await Promise.all(
        paths.map(async (p) => {
          const { data, error } = await supabase.storage.from(BUCKET_ORIGINAIS).download(p);
          if (error) throw error;
          return { mime: "image/jpeg", data: Buffer.from(await data.arrayBuffer()).toString("base64") };
        }),
      );

      // Busca por imagem (desligada por padrão); se falhar, segue sem ela
      let visao: VisaoResult | null = null;
      try {
        visao = await buscaPorImagem(images.slice(0, 3));
      } catch (e) {
        visao = { palpites: [], entidades: [], paginas: [], erro: e instanceof Error ? e.message : "falha na busca por imagem" };
      }

      const notas = [confirmados, evidenciasParaIA(visao)].filter(Boolean).join("\n\n") || undefined;
      // 1ª etapa só com as fotos (rápida, sem busca na web); a pesquisa vem na etapa seguinte
      const gem = await identifyPart(images, notas, [false]);
      if (!gem.analysis) {
        return NextResponse.json({ error: "A IA não devolveu um JSON válido", raw: gem.text, sources: gem.sources }, { status: 502 });
      }
      const out: Parcial = {
        analysis: gem.analysis, narrativa: gem.narrativa, sources: gem.sources, consultas: gem.consultas,
        pesquisou: gem.pesquisou, model: gem.model, grounded: gem.grounded, tentativas: gem.tentativas, visao,
      };
      return NextResponse.json(out);
    }

    if (!parcial?.analysis) return NextResponse.json({ error: "faltam os dados da etapa anterior" }, { status: 400 });

    if (etapa === "pesquisa") {
      const r = await pesquisaFocada(parcial.analysis, confirmados, parcial.model);
      const tentativas = [...parcial.tentativas, { model: "model" in r && r.model ? r.model : parcial.model, grounded: true, status: r.status }];
      if (!("analysis" in r) || !r.pesquisou) {
        return NextResponse.json({ ...parcial, tentativas, perguntaPesquisa: r.pergunta, erroPesquisa: "erro" in r ? r.erro : undefined });
      }
      const out: Parcial = {
        ...parcial,
        analysis: r.analysis ?? parcial.analysis,
        narrativa: [parcial.narrativa, r.narrativa && `— Pesquisa na web —\n${r.narrativa}`].filter(Boolean).join("\n\n"),
        sources: r.sources,
        consultas: r.consultas,
        pesquisou: true,
        model: r.model ?? parcial.model,
        perguntaPesquisa: r.pergunta,
        tentativas,
      };
      return NextResponse.json(out);
    }

    // etapa "final": conferência no catálogo do ML, certeza e gravação
    const a = parcial.analysis;
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
      narrativa: parcial.narrativa,
      visao: parcial.visao ?? null,
      cego: !!cego,
      sources: parcial.sources,
      catalog,
      certeza: certainty(parcial.sources.length, catalog.filter((c) => c.relevante).length, mainFound, parcial.visao?.paginas.length ?? 0),
      model: parcial.model,
      buscaWeb: parcial.pesquisou,
      consultas: parcial.consultas,
      perguntaPesquisa: parcial.perguntaPesquisa,
      erroPesquisa: (parcial as Parcial & { erroPesquisa?: string }).erroPesquisa,
      tentativas: parcial.tentativas,
      geradoEm: new Date().toISOString(),
    };
    await supabase.from("produtos").update({ identificacao: result, identificado_em: result.geradoEm }).eq("id", produtoId);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "falha" }, { status: 500 });
  }
}
