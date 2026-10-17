import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccessToken, getAccount } from "@/marketplaces/mercadolivre/accounts";
import { mlPost } from "@/marketplaces/mercadolivre/oauth";
import { prepararAnuncio } from "@/marketplaces/mercadolivre/preparar";

export const maxDuration = 60;

/**
 * Publica no Mercado Livre. Só roda com confirmação explícita; valida de novo antes e
 * cria o anúncio pausado quando `pausado` (recomendado no primeiro teste).
 */
export async function POST(request: NextRequest) {
  const { produtoId, confirmar, pausado = true } = (await request.json().catch(() => ({}))) as { produtoId?: string; confirmar?: boolean; pausado?: boolean };
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
    if (!r.preco || r.preco <= 0) return NextResponse.json({ error: "informe o preço" }, { status: 400 });
    if (!p.fotoPrincipalOk) return NextResponse.json({ error: "a foto principal precisa ser a versão com fundo branco: use \"Tornar principal\" em uma foto processada" }, { status: 400 });
    if (!payload.pictures.length) return NextResponse.json({ error: "o produto precisa de ao menos uma foto processada" }, { status: 400 });
    if (r.compatibilidade.some((c) => c.origem !== "confirmado")) {
      return NextResponse.json({ error: "há compatibilidades sugeridas pela web sem confirmar: confirme ou remova antes de publicar" }, { status: 400 });
    }

    const v = await mlPost("/items/validate", token, payload);
    if (!v.ok) return NextResponse.json({ error: "o Mercado Livre não aceitou o anúncio", etapa: "validacao", status: v.status, resposta: v.body }, { status: 422 });

    const criado = await mlPost("/items", token, payload);
    const item = criado.body as { id?: string; permalink?: string; status?: string } | null;
    if (!criado.ok || !item?.id) return NextResponse.json({ error: "falha ao criar o anúncio", etapa: "criacao", status: criado.status, resposta: criado.body }, { status: 502 });

    // descrição em texto simples; se falhar, o anúncio já existe e o vendedor é avisado
    const desc = await mlPost(`/items/${item.id}/description`, token, { plain_text: r.descricao });
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
      preco: r.preco,
      status,
      ultimo_sync_em: new Date().toISOString(),
    });
    await supabase.from("produtos").update({ status: "ativo" }).eq("id", produtoId);

    return NextResponse.json({
      ok: true,
      id: item.id,
      link: item.permalink ?? null,
      status,
      avisoDescricao: desc.ok ? null : { status: desc.status, resposta: desc.body },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "falha" }, { status: 500 });
  }
}
