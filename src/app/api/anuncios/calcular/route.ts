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
  // list_cost = o que o vendedor paga (já com o desconto do ML); a tabela cheia vem em discount.promoted_amount
  let fretePago: number | null = null;
  let freteTabela: number | null = null;
  let descontoFrete: { taxa: number; tipo: string | null } | null = null;
  if (e?.altura && e.largura && e.comprimento && e.peso) {
    const n = (v: string) => v.replace(",", ".").trim();
    const dim = `${n(e.altura)}x${n(e.largura)}x${n(e.comprimento)},${n(e.peso)}`;
    const q = new URLSearchParams({ dimensions: dim, item_price: String(r.preco), listing_type_id: tipo, mode: "me2", condition: r.condicao ?? "new", verbose: "true" });
    envio = await mlGet(`/users/${conta.external_user_id}/shipping_options/free?${q}`, token);
    const cov = (envio.body as { coverage?: { all_country?: { list_cost?: number; discount?: { rate?: number; type?: string; promoted_amount?: number } } } } | null)?.coverage?.all_country;
    if (typeof cov?.list_cost === "number") {
      fretePago = cov.list_cost;
      const d = cov.discount;
      if (d && typeof d.rate === "number" && d.rate > 0 && d.rate < 1) {
        descontoFrete = { taxa: d.rate, tipo: d.type ?? null };
        freteTabela = typeof d.promoted_amount === "number" ? d.promoted_amount : Math.round((cov.list_cost / (1 - d.rate)) * 100) / 100;
      } else {
        freteTabela = cov.list_cost;
      }
    }
  }

  // Reputação do vendedor (define o desconto de frete) e campos numéricos de custo/desconto que o ML devolver no envio
  const usuario = await mlGet(`/users/${conta.external_user_id}`, token);
  const reputacao = (usuario.body as { seller_reputation?: { level_id?: string | null; power_seller_status?: string | null } } | null)?.seller_reputation;
  const candidatosFrete: { campo: string; valor: number }[] = [];
  const varrer = (no: unknown, caminho: string) => {
    if (Array.isArray(no)) no.forEach((n, i) => varrer(n, `${caminho}[${i}]`));
    else if (no && typeof no === "object") for (const [k, v] of Object.entries(no)) varrer(v, caminho ? `${caminho}.${k}` : k);
    else if (typeof no === "number" && /discount|seller|cost|charge|fee|price/i.test(caminho)) candidatosFrete.push({ campo: caminho, valor: no });
  };
  if (envio?.body) varrer(envio.body, "");

  return NextResponse.json({
    reputacao: reputacao ? { nivel: reputacao.level_id ?? null, status: reputacao.power_seller_status ?? null } : null,
    candidatosFrete,
    preco: r.preco,
    comissao: fee?.sale_fee_amount ?? null,
    detalhes: fee?.sale_fee_details ?? null,
    freteTabela,
    fretePago,
    descontoFrete,
    brutos: { taxas: { status: taxas.status, body: taxas.body }, envio },
  });
}
