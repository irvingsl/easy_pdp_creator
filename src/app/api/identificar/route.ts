import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { identifyPart, organizarPesquisa, pesquisaWeb, type PartAnalysis } from "@/lib/gemini";
import { getAccessToken } from "@/marketplaces/mercadolivre/accounts";
import { buscarPorPalavras, lookupPartNumber, type CatalogHit } from "@/marketplaces/mercadolivre/catalog";
import { BUCKET_ORIGINAIS } from "@/domain/types";
import { notasParaIA, type DadosConfirmados } from "@/domain/dados-confirmados";
import { gravarUso, usoStore } from "@/lib/uso";
import { buscaLens, textoLens } from "@/lib/lens";
import { buscaPorImagem, evidenciasParaIA, type VisaoResult } from "@/lib/vision";

export const maxDuration = 60;

const MAX_PHOTOS = 4;

const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/** Palavra que caracteriza o tipo de peça (a mais longa), p.ex. "embreagem". */
const keyword = (tipo: string | null) => norm(tipo ?? "").split(/[^a-z0-9]+/).filter((w) => w.length >= 5).sort((a, b) => b.length - a.length)[0];
const alnumN = (t?: string | null) => (t ?? "").replace(/[^0-9a-z]/gi, "").toLowerCase();

/** Pesquisa já feita para o mesmo número de peça em outro produto do vendedor: evita pagar de novo por busca e organização. */
async function pesquisaAnterior(supabase: Awaited<ReturnType<typeof createClient>>, produtoId: string, a: PartAnalysis): Promise<PartAnalysis | null> {
  const num = alnumN(a.numero_peca_principal);
  if (num.length < 6) return null;
  const { data } = await supabase
    .from("produtos")
    .select("id, analysis:identificacao->analysis, web:identificacao->buscaWeb")
    .neq("id", produtoId)
    .not("identificacao", "is", null)
    .order("identificado_em", { ascending: false })
    .limit(50);
  const achado = data?.find((x) => x.web === true && alnumN((x.analysis as PartAnalysis | null)?.numero_peca_principal) === num);
  return (achado?.analysis as PartAnalysis | undefined) ?? null;
}

/** Junta ao que as fotos mostraram o que veio da web na pesquisa anterior (equivalentes, aplicações, preço, medidas de fonte web). */
function mesclarPesquisa(atual: PartAnalysis, antigo: PartAnalysis): PartAnalysis {
  const codigos = [...(atual.codigos ?? [])];
  for (const c of antigo.codigos ?? []) {
    if (c.classe === "equivalente" && !codigos.some((x) => alnumN(x.codigo) === alnumN(c.codigo))) codigos.push(c);
  }
  const nomes = new Set((atual.caracteristicas ?? []).map((c) => norm(c.nome)));
  const caracteristicas = [...(atual.caracteristicas ?? [])];
  for (const c of antigo.caracteristicas ?? []) {
    if (c.origem === "fonte_web" && !nomes.has(norm(c.nome))) caracteristicas.push(c);
  }
  return {
    ...atual,
    codigos,
    caracteristicas,
    aplicacoes: atual.aplicacoes?.length ? atual.aplicacoes : antigo.aplicacoes ?? [],
    preco: atual.preco ?? antigo.preco ?? null,
  };
}

const significant = (code: string) => code.replace(/[^0-9a-z]/gi, "").length >= 6;

/**
 * Existir no catálogo do ML só prova que o número EXISTE, não que é o do item. A certeza só sobe quando o
 * número principal está gravado no item ou confirmado pelo vendedor (é o único que a IA pode pôr em
 * "numero_peca_principal"); números inferidos pela pesquisa ficam como candidatos.
 */
function certainty(sources: number, candidatos: number, principal: boolean, mainFound: boolean, imagePages = 0) {
  const reasons: string[] = [];
  if (principal && mainFound) reasons.push("O número de peça gravado/confirmado existe no catálogo do Mercado Livre");
  else if (principal) reasons.push("Número de peça gravado/confirmado, mas não localizado no catálogo do Mercado Livre");
  else if (candidatos) reasons.push(`${candidatos} candidato(s) inferido(s) pela pesquisa: vários modelos podem ter as mesmas medidas, confirme com o item`);
  else reasons.push("Nenhum número de peça identificado");
  if (sources) reasons.push(`${sources} fonte(s) da web consultada(s) pela IA`);
  if (imagePages) reasons.push(`${imagePages} página(s) com imagens parecidas na busca por imagem do Google`);
  const level = principal && mainFound ? "alta" : principal ? "média" : "baixa";
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
  textoPesquisa?: string;
  erroPesquisa?: string;
  /** etapas que realmente rodaram (ajuda a diagnosticar tela antiga em cache) */
  etapas?: string[];
  /** por que a pesquisa na web não foi feita (reaproveitada de outro produto ou dispensada pelo catálogo) */
  pesquisaDispensada?: string;
};

/**
 * A identificação roda em 3 etapas, cada uma numa chamada própria (o cliente as encadeia),
 * para que nenhuma estoure o tempo máximo da função:
 *  "fotos"    -> Gemini lê as fotos (com busca na web)
 *  "pesquisa" -> pesquisa focada, só se a 1ª etapa não pesquisou
 *  "final"    -> confere no catálogo do ML, calcula a certeza e salva
 */
export const POST = (request: NextRequest) => usoStore.run([], () => tratar(request));

async function tratar(request: NextRequest) {
  const { produtoId, cego, forcar, etapa = "fotos", parcial } = (await request.json().catch(() => ({}))) as {
    produtoId?: string;
    cego?: boolean;
    /** refazer a pesquisa na web mesmo que já exista (identificar de novo) */
    forcar?: boolean;
    etapa?: "fotos" | "pesquisa" | "organizar" | "final";
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
        pesquisou: gem.pesquisou, model: gem.model, grounded: gem.grounded, tentativas: gem.tentativas, visao, etapas: ["fotos"],
      };
      return NextResponse.json(out);
    }

    if (!parcial?.analysis) return NextResponse.json({ error: "faltam os dados da etapa anterior" }, { status: 400 });

    if (etapa === "pesquisa") {
      if (!forcar && !cego) {
        // 1) o mesmo número de peça já foi pesquisado em outro produto
        const ant = await pesquisaAnterior(supabase, produtoId, parcial.analysis);
        if (ant) {
          const out: Parcial = {
            ...parcial,
            analysis: mesclarPesquisa(parcial.analysis, ant),
            pesquisou: true,
            pesquisaDispensada: "Pesquisa reaproveitada de outro produto com o mesmo número de peça (sem custo). Use \"Identificar de novo\" para pesquisar outra vez.",
            perguntaPesquisa: "(reaproveitada)",
            etapas: [...(parcial.etapas ?? []), "pesquisa(reaproveitada)"],
          };
          return NextResponse.json(out);
        }
        // 2) o catálogo do ML já reconhece o número (e é o mesmo tipo de peça): dispensa a busca na web
        const code = parcial.analysis.numero_peca_principal;
        const token = code && significant(code) ? await getAccessToken(supabase) : null;
        if (token && code) {
          const hit = await lookupPartNumber(token, code);
          const kw = keyword(parcial.analysis.tipo_item);
          if (hit.exact && (!kw || hit.products.some((x) => norm(x.name).includes(kw)))) {
            const diam = hit.products.map((x) => x.diameter).find(Boolean);
            const caract = [...(parcial.analysis.caracteristicas ?? [])];
            if (diam && !caract.some((c) => /di[aâ]metro/i.test(c.nome))) {
              caract.push({ nome: "diâmetro", valor: diam.replace(/\s*mm$/i, ""), unidade: "mm", origem: "fonte_web", como: "Catálogo do Mercado Livre", confianca: "media" });
            }
            const out: Parcial = {
              ...parcial,
              analysis: { ...parcial.analysis, caracteristicas: caract },
              pesquisaDispensada: "O catálogo do Mercado Livre já reconhece este número de peça, então a busca na web foi dispensada (sem custo). Use \"Identificar de novo\" para pesquisar na web e trazer aplicações e preços.",
              perguntaPesquisa: "(dispensada)",
              etapas: [...(parcial.etapas ?? []), "pesquisa(dispensada)"],
            };
            return NextResponse.json(out);
          }
        }
      }
      // Busca por imagem (se houver chave) roda junto com a pesquisa por texto, sem somar tempo
      const primeira = [...produto.produto_fotos].sort((a, b) => a.ordem - b.ordem)[0];
      const lensP = (async () => {
        if (!primeira || !process.env.SERPAPI_KEY) return null;
        const { data: url } = await supabase.storage.from(BUCKET_ORIGINAIS).createSignedUrl(primeira.path_original, 300);
        return url?.signedUrl ? buscaLens(url.signedUrl) : null;
      })();
      // as duas primeiras fotos originais acompanham a pergunta: o modelo vê o formato da peça ao escolher o que pesquisar
      const imagens = await Promise.all(
        [...produto.produto_fotos].sort((a, b) => a.ordem - b.ordem).slice(0, 2).map(async (f) => {
          const { data, error } = await supabase.storage.from(BUCKET_ORIGINAIS).download(f.path_original);
          if (error || !data) return null;
          return { mime: "image/jpeg", data: Buffer.from(await data.arrayBuffer()).toString("base64") };
        }),
      );
      const [r, lens] = await Promise.all([
        pesquisaWeb(parcial.analysis, parcial.model, cego ? null : (produto.dados_confirmados as DadosConfirmados | null), undefined, imagens.filter((x): x is { mime: string; data: string } => !!x)),
        lensP,
      ]);
      const tentativas = [...parcial.tentativas, { model: "model" in r && r.model ? r.model : parcial.model, grounded: true, status: r.status }];
      if (!("texto" in r)) {
        return NextResponse.json({ ...parcial, tentativas, perguntaPesquisa: r.pergunta, erroPesquisa: r.erro, etapas: [...(parcial.etapas ?? []), "pesquisa(falhou)"] });
      }
      // Produtos parecidos no catálogo do ML (gratuito): nomes com veículo e código ajudam quando a web não achou
      let textoFinal = r.texto;
      try {
        const token = await getAccessToken(supabase);
        const an = parcial.analysis;
        const marca = (cego ? null : (produto.dados_confirmados as DadosConfirmados | null)?.marca) || an.marca?.valor;
        const codigo = an.numero_peca_principal;
        if (token && codigo) {
          const achados = await buscarPorPalavras(token, [an.tipo_item?.split(" ")[0], marca, codigo].filter(Boolean).join(" "));
          if (achados.length) textoFinal += `\n\nProdutos do catálogo do Mercado Livre para esta busca:\n${achados.map((x) => `- ${x.name}${x.brand ? ` (marca ${x.brand})` : ""}${x.partNumber ? ` [código ${x.partNumber}]` : ""}`).join("\n")}`;
        }
      } catch {
        /* o catálogo é um complemento: se falhar, segue só com a web */
      }
      if (lens?.matches.length) textoFinal += `\n\n${textoLens(lens.matches)}`;
      const out: Parcial = {
        ...parcial,
        textoPesquisa: textoFinal,
        narrativa: [parcial.narrativa, `— Pesquisa na web —\n${textoFinal}`].filter(Boolean).join("\n\n"),
        sources: r.sources,
        consultas: r.consultas,
        pesquisou: true,
        model: r.model,
        perguntaPesquisa: r.pergunta,
        tentativas,
        etapas: [...(parcial.etapas ?? []), lens ? (lens.erro ? "pesquisa+lens(erro)" : "pesquisa+lens") : "pesquisa"],
        ...(lens?.erro ? { erroPesquisa: `Busca por imagem: ${lens.erro}` } : {}),
      };
      return NextResponse.json(out);
    }

    if (etapa === "organizar") {
      // sem texto de pesquisa não há o que organizar: segue com a análise das fotos
      if (!parcial.textoPesquisa) return NextResponse.json(parcial);
      const r = await organizarPesquisa(parcial.analysis, confirmados, parcial.textoPesquisa, parcial.model);
      const { textoPesquisa: _omit, ...resto } = parcial;
      void _omit;
      return NextResponse.json({ ...resto, etapas: [...(parcial.etapas ?? []), "organizar"], analysis: r.analysis ?? parcial.analysis, tentativas: [...parcial.tentativas, { model: r.model, grounded: false, status: r.status }] });
    }

    // etapa "final": conferência no catálogo do ML, certeza e gravação
    let p: Parcial = parcial;
    if (!p.perguntaPesquisa) {
      // A pesquisa nunca rodou (ex.: o navegador ainda usa uma versão antiga da página, em cache): roda aqui,
      // com orçamento de tempo menor, para o resultado não sair sem ela.
      const r = await pesquisaWeb(p.analysis, p.model, cego ? null : (produto.dados_confirmados as DadosConfirmados | null), 30000);
      p = { ...p, perguntaPesquisa: r.pergunta, etapas: [...(p.etapas ?? []), "pesquisa-no-final"], tentativas: [...p.tentativas, { model: "model" in r && r.model ? r.model : p.model, grounded: true, status: r.status }] };
      if ("texto" in r) {
        p = { ...p, pesquisou: true, sources: r.sources, consultas: r.consultas, textoPesquisa: r.texto, narrativa: [p.narrativa, `— Pesquisa na web —\n${r.texto}`].filter(Boolean).join("\n\n") };
        const o = await organizarPesquisa(p.analysis, confirmados, r.texto, r.model, 14000);
        if (o.analysis) p = { ...p, analysis: o.analysis };
      } else {
        p = { ...p, erroPesquisa: r.erro };
      }
    }
    const a = p.analysis;
    // Dado vindo só da pesquisa e sem link da fonte não é verificável: não pode constar como confiança alta
    a.codigos = (a.codigos ?? []).map((c) => (c.origem === "inferido_pela_pesquisa" && !c.fonte_url && c.confianca === "alta" ? { ...c, confianca: "baixa" } : c));
    a.caracteristicas = (a.caracteristicas ?? []).map((c) => (c.origem === "fonte_web" && c.confianca === "alta" ? { ...c, confianca: "media" } : c));
    // Só números de peça e equivalentes; códigos de processo (lote, data...) não vão ao catálogo
    const codes = [
      ...new Set(
        [
          a.numero_peca_principal,
          ...(a.candidatos ?? []).map((c) => c.numero_de_peca),
          ...(a.codigos ?? []).filter((c) => c.classe === "numero_de_peca" || c.classe === "equivalente").map((c) => c.codigo),
        ].filter((c): c is string => !!c && significant(c)),
      ),
    ].slice(0, 8);
    let catalog: CatalogHit[] = [];
    const token = await getAccessToken(supabase);
    if (token) catalog = await Promise.all(codes.map((c) => lookupPartNumber(token, c)));

    // Só vale o que o ML reconhece como número de peça E é do mesmo tipo de peça
    const kw = keyword(a.tipo_item);
    catalog = catalog.map((c) => {
      const relevante = c.exact && (!kw || c.products.some((p) => norm(p.name).includes(kw)));
      return { ...c, relevante, ignorado: c.exact && !relevante ? "existe no catálogo, mas é outro tipo de peça (ignorado)" : undefined };
    });

    const alnum = (t?: string | null) => (t ?? "").replace(/[^0-9a-z]/gi, "").toLowerCase();
    const mainFound = catalog.some((c) => c.relevante && alnum(c.code) === alnum(a.numero_peca_principal));
    const result = {
      analysis: a,
      narrativa: p.narrativa,
      visao: p.visao ?? null,
      cego: !!cego,
      sources: p.sources,
      catalog,
      certeza: certainty(p.sources.length, a.candidatos?.length ?? 0, !!a.numero_peca_principal, mainFound, p.visao?.paginas.length ?? 0),
      model: p.model,
      buscaWeb: p.pesquisou,
      consultas: p.consultas,
      perguntaPesquisa: p.perguntaPesquisa,
      erroPesquisa: p.erroPesquisa,
      tentativas: p.tentativas,
      etapas: p.etapas,
      pesquisaDispensada: p.pesquisaDispensada,
      geradoEm: new Date().toISOString(),
    };
    await supabase.from("produtos").update({ identificacao: result, identificado_em: result.geradoEm }).eq("id", produtoId);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "falha" }, { status: 500 });
  } finally {
    await gravarUso(supabase, produtoId, `identificar:${etapa}`).catch(() => {});
  }
}
