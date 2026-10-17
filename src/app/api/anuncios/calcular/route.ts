import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccessToken, getAccount } from "@/marketplaces/mercadolivre/accounts";
import { mlGet } from "@/marketplaces/mercadolivre/oauth";
import type { Rascunho } from "@/domain/rascunho";

export const maxDuration = 30;

type Fee = { sale_fee_amount?: number; listing_type_id?: string; sale_fee_details?: { percentage_fee?: number; fixed_fee?: number; financing_add_on_fee?: number; gross_amount?: number } };

/** Quanto sobra ao vendedor: preço - comissão do ML - custo de envio (frete grátis obrigatório). */
export async function POST(request: NextRequest) {
  const { produtoId } = (await request.json().catch(() => ({}))) as { produtoId?: string };
  if (!produtoId) return NextResponse.json({ error: "produtoId obrigatório" }, { status: 400 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const token = await getAccessToken(supabase);
  const conta = await getAccount(supabase);
  if (!token || !conta) return NextResponse.json({ error: "conta do Mercado Livre não conectada" }, { status: 400 });

  const { data: produto } = await supabase.from("produtos").select("rascunho").eq("id", produtoId).maybeSingle();
  const r = produto?.rascunho as Rascunho | null;
  if (!r?.preco || !r.categoria_id) return NextResponse.json({ error: "informe o preço e a categoria e salve o rascunho" }, { status: 400 });

  const tipo = "gold_special";
  const taxas = await mlGet(`/sites/MLB/listing_prices?price=${r.preco}&category_id=${r.categoria_id}&listing_type_id=${tipo}`, token);
  const fee = (Array.isArray(taxas.body) ? taxas.body[0] : taxas.body) as Fee | null;

  const e = r.embalagem;
  let envio: { status: number; body: unknown } | null = null;
  let freteTabela: number | null = null;
  if (e?.altura && e.largura && e.comprimento && e.peso) {
    const n = (v: string) => v.replace(",", ".").trim();
    const dim = `${n(e.altura)}x${n(e.largura)}x${n(e.comprimento)},${n(e.peso)}`;
    const q = new URLSearchParams({ dimensions: dim, item_price: String(r.preco), listing_type_id: tipo, mode: "me2", condition: r.condicao ?? "new", verbose: "true" });
    envio = await mlGet(`/users/${conta.external_user_id}/shipping_options/free?${q}`, token);
    const cov = (envio.body as { coverage?: { all_country?: { list_cost?: number } } } | null)?.coverage?.all_country;
    if (typeof cov?.list_cost === "number") freteTabela = cov.list_cost;
  }

  return NextResponse.json({
    preco: r.preco,
    comissao: fee?.sale_fee_amount ?? null,
    detalhes: fee?.sale_fee_details ?? null,
    freteTabela,
    brutos: { taxas: { status: taxas.status, body: taxas.body }, envio },
  });
}
