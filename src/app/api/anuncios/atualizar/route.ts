import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccessToken } from "@/marketplaces/mercadolivre/accounts";
import { mlPost } from "@/marketplaces/mercadolivre/oauth";
import { descricaoFinal } from "@/marketplaces/mercadolivre/listing";
import { prepararAnuncio } from "@/marketplaces/mercadolivre/preparar";

export const maxDuration = 60;

/** Atualiza um anúncio já publicado com o rascunho atual (preço, atributos, garantia e descrição), sem criar outro. */
export async function POST(request: NextRequest) {
  const { produtoId, itemId, confirmar } = (await request.json().catch(() => ({}))) as { produtoId?: string; itemId?: string; confirmar?: boolean };
  if (!produtoId || !itemId || !/^MLB\d+$/.test(itemId)) return NextResponse.json({ error: "produto e anúncio obrigatórios" }, { status: 400 });
  if (confirmar !== true) return NextResponse.json({ error: "atualização precisa de confirmação explícita" }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  // só atualiza anúncios que o app publicou para este produto
  const { data: anuncio } = await supabase.from("anuncios").select("id").eq("produto_id", produtoId).eq("external_id", itemId).maybeSingle();
  if (!anuncio) return NextResponse.json({ error: "anúncio não encontrado neste produto" }, { status: 404 });
  const token = await getAccessToken(supabase);
  if (!token) return NextResponse.json({ error: "conta do Mercado Livre não conectada" }, { status: 400 });

  try {
    const p = await prepararAnuncio(supabase, token, produtoId);
    if ("erro" in p) return NextResponse.json({ error: p.erro }, { status: p.http });
    if ("categorias" in p) return NextResponse.json({ error: "escolha uma categoria" }, { status: 400 });
    const { rascunho: r, payload } = p;
    if (!r.preco || r.preco <= 0) return NextResponse.json({ error: "informe o preço" }, { status: 400 });

    // campos que o ML deixa alterar; família, categoria e condição ficam como foram criados
    const corpo = {
      price: r.preco,
      // o estoque do produto manda; com 0 não mexe (o ML pausa sozinho ao zerar)
      ...(p.estoque > 0 ? { available_quantity: p.estoque } : {}),
      attributes: payload.attributes,
      ...("sale_terms" in payload ? { sale_terms: payload.sale_terms } : {}),
      // só mexe no frete se o vendedor escolheu; onde o ML exige frete grátis ele mantém
      ...(r.frete_gratis !== undefined ? { shipping: { free_shipping: r.frete_gratis } } : {}),
    };
    const item = await mlPost(`/items/${itemId}`, token, corpo, "PUT");
    const desc = await mlPost(`/items/${itemId}/description`, token, { plain_text: descricaoFinal(r) }, "PUT");
    if (item.ok) await supabase.from("anuncios").update({ preco: r.preco, ultimo_sync_em: new Date().toISOString() }).eq("id", anuncio.id);
    return NextResponse.json({ ok: item.ok, item: { status: item.status, resposta: item.body }, descricao: { status: desc.status, ok: desc.ok, resposta: desc.ok ? null : desc.body } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "falha" }, { status: 500 });
  }
}
