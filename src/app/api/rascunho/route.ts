import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { gerarRascunho } from "@/lib/gemini";
import { fatosDoProduto, type Identificacao } from "@/lib/fatos";
import type { DadosConfirmados } from "@/domain/dados-confirmados";
import { gravarUso, usoStore } from "@/lib/uso";
import { hashTexto } from "@/lib/hash";
import { TITULO_MAX, type Rascunho } from "@/domain/rascunho";

export const maxDuration = 60;

export const POST = (request: NextRequest) => usoStore.run([], () => tratar(request));

async function tratar(request: NextRequest) {
  const { produtoId, forcar } = (await request.json().catch(() => ({}))) as { produtoId?: string; forcar?: boolean };
  if (!produtoId) return NextResponse.json({ error: "produtoId obrigatório" }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });

  const { data: produto } = await supabase.from("produtos").select("id, oem_code, dados_confirmados, identificacao, rascunho").eq("id", produtoId).maybeSingle();
  if (!produto) return NextResponse.json({ error: "produto não encontrado" }, { status: 404 });

  const analysis = (produto.identificacao as Identificacao | null)?.analysis;
  const fatos = fatosDoProduto(produto.oem_code, produto.dados_confirmados as DadosConfirmados | null, analysis);
  if (!fatos) return NextResponse.json({ error: "identifique o produto ou preencha os dados confirmados primeiro" }, { status: 400 });

  // nada mudou desde o último rascunho: devolve o que já existe, sem gastar IA (o botão "Gerar de novo" força)
  const hash = hashTexto(fatos);
  const existente = produto.rascunho as Rascunho | null;
  if (!forcar && existente?.titulo && existente.fatos_hash === hash) return NextResponse.json({ rascunho: existente, reaproveitado: true });

  const r = await gerarRascunho(fatos);
  await gravarUso(supabase, produtoId, "rascunho").catch(() => {});
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
    fatos_hash: hash,
    // a categoria do produto equivalente do catálogo é a melhor sugestão (mesma peça)
    categoria_id: existente?.categoria_id ?? (produto.identificacao as Identificacao | null)?.modeloCatalogo?.categoria ?? undefined,
  };
  await supabase.from("produtos").update({ rascunho }).eq("id", produtoId);
  return NextResponse.json({ rascunho });
}
