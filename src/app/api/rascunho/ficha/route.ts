import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { preencherFicha } from "@/lib/gemini";
import { fatosDoProduto, type Identificacao } from "@/lib/fatos";
import { gravarUso, usoStore } from "@/lib/uso";
import { hashTexto } from "@/lib/hash";
import { getAccessToken } from "@/marketplaces/mercadolivre/accounts";
import { atributosDaCategoria, camposDaFicha } from "@/marketplaces/mercadolivre/listing";
import type { CampoFicha, Rascunho } from "@/domain/rascunho";
import type { DadosConfirmados } from "@/domain/dados-confirmados";

export const maxDuration = 60;

export const POST = (request: NextRequest) => usoStore.run([], () => tratar(request));

/** Preenche a ficha técnica da categoria escolhida com os fatos do produto (sem usar o que veio só da web). */
async function tratar(request: NextRequest) {
  const { produtoId, forcar } = (await request.json().catch(() => ({}))) as { produtoId?: string; forcar?: boolean };
  if (!produtoId) return NextResponse.json({ error: "produtoId obrigatório" }, { status: 400 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const token = await getAccessToken(supabase);
  if (!token) return NextResponse.json({ error: "conta do Mercado Livre não conectada" }, { status: 400 });

  const { data: produto } = await supabase.from("produtos").select("id, oem_code, dados_confirmados, identificacao, rascunho").eq("id", produtoId).maybeSingle();
  const r = produto?.rascunho as Rascunho | null;
  if (!produto || !r?.categoria_id) return NextResponse.json({ error: "escolha a categoria e salve o rascunho antes" }, { status: 400 });

  try {
    const campos = camposDaFicha(await atributosDaCategoria(token, r.categoria_id));
    const fatos = fatosDoProduto(produto.oem_code, produto.dados_confirmados as DadosConfirmados | null, (produto.identificacao as Identificacao | null)?.analysis, (produto.identificacao as Identificacao | null)?.modeloCatalogo);
    // medidas do rascunho que o vendedor preencheu à mão também são fatos
    const extras = (r.atributos ?? []).filter((a) => a.origem !== "web").map((a) => `Atributo do rascunho (${a.origem}): ${a.nome} = ${a.valor}`);
    const entrada = [fatos, ...extras].filter(Boolean).join("\n");
    // mesmos fatos e mesma categoria da última vez: não paga a IA de novo
    const hash = hashTexto(`${r.categoria_id}|${entrada}|${campos.map((c) => c.id).join(",")}`);
    if (!forcar && r.ficha?.length && r.ficha_hash === hash) return NextResponse.json({ ficha: r.ficha, reaproveitado: true });
    const ia = await preencherFicha(entrada, campos);
    await gravarUso(supabase, produtoId, "ficha").catch(() => {});
    if (!ia.itens) return NextResponse.json({ error: "A IA não devolveu a ficha, tente de novo" }, { status: 502 });

    // mantém o que o vendedor já digitou; o resto vem da IA
    const atual = new Map((r.ficha ?? []).map((f) => [f.id, f]));
    const ficha: CampoFicha[] = campos.map((c) => {
      const feito = atual.get(c.id);
      if (feito?.valor) return { ...c, ...feito };
      const sug = ia.itens!.find((i) => i.id === c.id && i.valor?.toString().trim());
      const opcao = sug && c.opcoes ? c.opcoes.find((o) => o.id === sug.valor_id) : undefined;
      return {
        ...c,
        valor: sug ? String(opcao?.name ?? sug.valor) : "",
        ...(opcao ? { valor_id: opcao.id } : {}),
        ...(sug?.origem ? { origem: sug.origem as CampoFicha["origem"] } : {}),
      };
    });
    const novo: Rascunho = { ...r, ficha, ficha_hash: hash };
    await supabase.from("produtos").update({ rascunho: novo }).eq("id", produtoId);
    return NextResponse.json({ ficha });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "falha" }, { status: 500 });
  }
}
