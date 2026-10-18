import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccessToken, getAccount } from "@/marketplaces/mercadolivre/accounts";
import { mlPost } from "@/marketplaces/mercadolivre/oauth";
import { analisarValidacao, descricaoFinal } from "@/marketplaces/mercadolivre/listing";
import { prepararAnuncio } from "@/marketplaces/mercadolivre/preparar";

export const maxDuration = 60;

/**
 * Publica no Mercado Livre. Só roda com confirmação explícita; valida de novo antes e
 * cria o anúncio pausado quando `pausado` (recomendado no primeiro teste).
 */
export async function POST(request: NextRequest) {
  const { produtoId, confirmar, pausado = true, precoOverride, freteGratisOverride } = (await request.json().catch(() => ({}))) as { produtoId?: string; confirmar?: boolean; pausado?: boolean; precoOverride?: number; freteGratisOverride?: boolean };
  if (!produtoId) return NextResponse.json({ error: "produtoId obrigatório" }, { status: 400 });
  if (confirmar !== true) return NextResponse.json({ error: "publicação precisa de confirmação explícita" }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const token = await getAccessToken(supabase);
  const conta = await getAccount(supabase);
  if (!token || !conta) return NextResponse.json({ error: "conta do Mercado Livre não conectada" }, { status: 400 });

  try {
    const p = await prepararAnuncio(supabase, token, produtoId);
    if ("erro" in p) return NextResponse.json({ error: p.erro }, { status: p.http });
    if ("categorias" in p) return NextResponse.json({ error: "escolha uma categoria antes de publicar" }, { status: 400 });
    const { rascunho: r, payload } = p;
    if (!(p.estoque > 0)) return NextResponse.json({ error: "defina o estoque do produto (maior que zero) antes de publicar" }, { status: 400 });
    // segunda opção de venda do mesmo produto: outro preço e/ou outra condição de frete
    const preco = typeof precoOverride === "number" && precoOverride > 0 ? Math.round(precoOverride * 100) / 100 : r.preco;
    if (typeof precoOverride === "number" && precoOverride > 0) payload.price = preco ?? 0;
    if (typeof freteGratisOverride === "boolean") payload.shipping.free_shipping = freteGratisOverride;
    if (!preco || preco <= 0) return NextResponse.json({ error: "informe o preço" }, { status: 400 });
    if (!p.fotoPrincipalOk) return NextResponse.json({ error: "a foto principal precisa ser a versão com fundo branco: use \"Tornar principal\" em uma foto processada" }, { status: 400 });
    if (!payload.pictures.length) return NextResponse.json({ error: "o produto precisa de ao menos uma foto processada" }, { status: 400 });

    const v = await mlPost("/items/validate", token, payload);
    if (!analisarValidacao(v).aceito) return NextResponse.json({ error: "o Mercado Livre não aceitou o anúncio", etapa: "validacao", status: v.status, resposta: v.body }, { status: 422 });

    const criado = await mlPost("/items", token, payload);
    const item = criado.body as { id?: string; permalink?: string; status?: string; pictures?: unknown[] } | null;
    if (!criado.ok || !item?.id) return NextResponse.json({ error: "falha ao criar o anúncio", etapa: "criacao", status: criado.status, resposta: criado.body }, { status: 502 });

    // descrição em texto simples; se falhar, o anúncio já existe e o vendedor é avisado
    const desc = await mlPost(`/items/${item.id}/description`, token, { plain_text: descricaoFinal(r) });
    let status = item.status ?? "active";
    if (pausado) {
      const pa = await mlPost(`/items/${item.id}`, token, { status: "paused" }, "PUT");
      if (pa.ok) status = "paused";
    }

    await supabase.from("anuncios").insert({
      produto_id: produtoId,
      conta_id: conta.id,
      marketplace: "mercadolivre",
      external_id: item.id,
      preco,
      status,
      resposta_criacao: criado.body,
      ultimo_sync_em: new Date().toISOString(),
    });
    await supabase.from("produtos").update({ status: "ativo" }).eq("id", produtoId);

    return NextResponse.json({
      ok: true,
      id: item.id,
      link: item.permalink ?? null,
      status,
      respostaCriacao: criado.body,
      fotosEnviadas: payload.pictures.length,
      fotosNoML: item.pictures?.length ?? null,
      avisoDescricao: desc.ok ? null : { status: desc.status, resposta: desc.body },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "falha" }, { status: 500 });
  }
}
