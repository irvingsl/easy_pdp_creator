import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccessToken } from "@/marketplaces/mercadolivre/accounts";
import { mlPost } from "@/marketplaces/mercadolivre/oauth";
import { atributosDaCategoria, montarAnuncio, sugerirCategorias } from "@/marketplaces/mercadolivre/listing";
import { BUCKET_PROCESSADAS } from "@/domain/types";
import type { Rascunho } from "@/domain/rascunho";
import type { DadosConfirmados } from "@/domain/dados-confirmados";

export const maxDuration = 60;

/** Valida o anúncio no ML (/items/validate): só aponta erros, nada é criado na conta. */
export async function POST(request: NextRequest) {
  const { produtoId, sugerir } = (await request.json().catch(() => ({}))) as { produtoId?: string; sugerir?: boolean };
  if (!produtoId) return NextResponse.json({ error: "produtoId obrigatório" }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });

  const { data: produto } = await supabase
    .from("produtos")
    .select("id, oem_code, dados_confirmados, rascunho, produto_fotos(path_processada, ordem)")
    .eq("id", produtoId)
    .maybeSingle();
  if (!produto) return NextResponse.json({ error: "produto não encontrado" }, { status: 404 });
  const r = produto.rascunho as Rascunho | null;
  if (!r?.titulo) return NextResponse.json({ error: "gere e salve o rascunho primeiro" }, { status: 400 });

  const token = await getAccessToken(supabase);
  if (!token) return NextResponse.json({ error: "conta do Mercado Livre não conectada" }, { status: 400 });

  try {
    if (sugerir || !r.categoria_id) {
      const categorias = await sugerirCategorias(token, r.titulo);
      if (sugerir || !categorias.length) return NextResponse.json({ categorias });
      r.categoria_id = categorias[0].id;
    }
    const atributosCategoria = await atributosDaCategoria(token, r.categoria_id);
    const fotos = produto.produto_fotos
      .filter((f) => f.path_processada)
      .sort((a, b) => a.ordem - b.ordem)
      .map((f) => supabase.storage.from(BUCKET_PROCESSADAS).getPublicUrl(f.path_processada!).data.publicUrl);
    const payload = montarAnuncio({
      rascunho: r,
      conf: produto.dados_confirmados as DadosConfirmados | null,
      oemCode: produto.oem_code,
      categoria: r.categoria_id,
      atributosCategoria,
      fotos,
    });
    const res = await mlPost("/items/validate", token, payload);
    const obrigatorios = atributosCategoria
      .filter((a) => a.tags?.required || a.tags?.catalog_required)
      .map((a) => ({ id: a.id, nome: a.name, enviado: payload.attributes.some((x) => x.id === a.id) }));
    return NextResponse.json({ status: res.status, ok: res.ok, resposta: res.body ?? "(sem corpo: validação passou)", obrigatorios, payload });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "falha" }, { status: 500 });
  }
}
