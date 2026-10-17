import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { gerarRascunho, type PartAnalysis } from "@/lib/gemini";
import { notasParaIA, type DadosConfirmados } from "@/domain/dados-confirmados";
import { TITULO_MAX, type Rascunho } from "@/domain/rascunho";

export const maxDuration = 60;

type Identificacao = { analysis?: PartAnalysis };

/** Reúne os fatos do produto, separando o que o vendedor confirmou do que veio da IA/web. */
function fatosDoProduto(oemCode: string | null, conf: DadosConfirmados | null, a: PartAnalysis | undefined) {
  const linhas: string[] = [];
  const confirmados = notasParaIA(oemCode, conf);
  if (confirmados) linhas.push(confirmados);
  if (a) {
    linhas.push(`Tipo de item: ${a.tipo_item ?? "?"}; formato de venda: ${a.formato_de_venda ?? "?"}`);
    if (a.marca?.valor) linhas.push(`Marca (${a.marca.origem}, confiança ${a.marca.confianca}): ${a.marca.valor}`);
    if (a.numero_peca_principal) linhas.push(`Número de peça principal (gravado no item): ${a.numero_peca_principal}`);
    for (const c of a.caracteristicas ?? []) linhas.push(`Característica (${c.origem}, confiança ${c.confianca}): ${c.nome} = ${c.valor}${c.unidade ? ` ${c.unidade}` : ""}`);
    for (const c of (a.codigos ?? []).filter((c) => c.classe === "equivalente" && c.confianca !== "baixa")) linhas.push(`Código equivalente (${c.origem}): ${c.marca ?? ""} ${c.codigo}`);
    for (const ap of a.aplicacoes ?? []) linhas.push(`Aplicação (${ap.origem}, não confirmada pelo vendedor): ${ap.descricao}${ap.anos ? ` ${ap.anos}` : ""}`);
    if (a.preco?.minimo != null) linhas.push(`Faixa de preço vista na web: R$ ${a.preco.minimo} a R$ ${a.preco.maximo} (${a.preco.formato_de_referencia ?? "unidade"})`);
  }
  return linhas.join("\n");
}

export async function POST(request: NextRequest) {
  const { produtoId } = (await request.json().catch(() => ({}))) as { produtoId?: string };
  if (!produtoId) return NextResponse.json({ error: "produtoId obrigatório" }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });

  const { data: produto } = await supabase.from("produtos").select("id, oem_code, dados_confirmados, identificacao").eq("id", produtoId).maybeSingle();
  if (!produto) return NextResponse.json({ error: "produto não encontrado" }, { status: 404 });

  const analysis = (produto.identificacao as Identificacao | null)?.analysis;
  const fatos = fatosDoProduto(produto.oem_code, produto.dados_confirmados as DadosConfirmados | null, analysis);
  if (!fatos) return NextResponse.json({ error: "identifique o produto ou preencha os dados confirmados primeiro" }, { status: 400 });

  const r = await gerarRascunho(fatos);
  if (!r.rascunho) return NextResponse.json({ error: "A IA não devolveu um rascunho válido, tente de novo" }, { status: 502 });

  const x = r.rascunho as Partial<Rascunho>;
  const rascunho: Rascunho = {
    titulo: String(x.titulo ?? "").slice(0, TITULO_MAX),
    descricao: String(x.descricao ?? ""),
    compatibilidade: Array.isArray(x.compatibilidade) ? x.compatibilidade : [],
    atributos: Array.isArray(x.atributos) ? x.atributos : [],
    preco: null,
    preco_faixa: x.preco_faixa ?? null,
    avisos: Array.isArray(x.avisos) ? x.avisos : [],
    geradoEm: new Date().toISOString(),
  };
  await supabase.from("produtos").update({ rascunho }).eq("id", produtoId);
  return NextResponse.json({ rascunho });
}
