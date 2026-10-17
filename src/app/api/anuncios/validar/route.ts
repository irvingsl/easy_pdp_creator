import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccessToken } from "@/marketplaces/mercadolivre/accounts";
import { mlPost } from "@/marketplaces/mercadolivre/oauth";
import { prepararAnuncio } from "@/marketplaces/mercadolivre/preparar";

export const maxDuration = 60;

/** Valida o anúncio no ML (/items/validate): só aponta erros, nada é criado na conta. */
export async function POST(request: NextRequest) {
  const { produtoId, sugerir } = (await request.json().catch(() => ({}))) as { produtoId?: string; sugerir?: boolean };
  if (!produtoId) return NextResponse.json({ error: "produtoId obrigatório" }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const token = await getAccessToken(supabase);
  if (!token) return NextResponse.json({ error: "conta do Mercado Livre não conectada" }, { status: 400 });

  try {
    const p = await prepararAnuncio(supabase, token, produtoId, !!sugerir);
    if ("erro" in p) return NextResponse.json({ error: p.erro }, { status: p.http });
    if ("categorias" in p) return NextResponse.json({ categorias: p.categorias });
    const res = await mlPost("/items/validate", token, p.payload);
    const obrigatorios = p.atributosCategoria
      .filter((a) => a.tags?.required || a.tags?.catalog_required)
      .map((a) => ({ id: a.id, nome: a.name, enviado: p.payload.attributes.some((x) => x.id === a.id) }));
    return NextResponse.json({ status: res.status, ok: res.ok, resposta: res.body ?? "(sem corpo: validação passou)", obrigatorios, payload: p.payload });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "falha" }, { status: 500 });
  }
}
