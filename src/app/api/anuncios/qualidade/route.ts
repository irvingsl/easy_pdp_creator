import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccessToken } from "@/marketplaces/mercadolivre/accounts";
import { mlGet } from "@/marketplaces/mercadolivre/oauth";

export const maxDuration = 30;

type Pendencia = { grupo: string; titulo: string; status?: string; regras?: string[] };

/** Percorre a resposta de /performance atrás de itens ainda não concluídos (a estrutura exata pode variar). */
function pendencias(no: unknown, grupo = "", out: Pendencia[] = []): Pendencia[] {
  if (Array.isArray(no)) no.forEach((n) => pendencias(n, grupo, out));
  else if (no && typeof no === "object") {
    const o = no as Record<string, unknown>;
    const titulo = (o.title ?? o.name) as string | undefined;
    const status = o.status as string | undefined;
    const g = typeof o.name === "string" || typeof o.title === "string" ? String(titulo) : grupo;
    if (titulo && status && status !== "COMPLETED") {
      const regras = Array.isArray(o.rules) ? (o.rules as { wordings?: { title?: string }; title?: string; status?: string }[]).filter((r) => r.status !== "COMPLETED").map((r) => r.wordings?.title ?? r.title ?? "").filter(Boolean) : undefined;
      out.push({ grupo, titulo, status, regras });
    }
    for (const v of Object.values(o)) if (v && typeof v === "object") pendencias(v, g, out);
  }
  return out;
}

export async function POST(request: NextRequest) {
  const { itemId } = (await request.json().catch(() => ({}))) as { itemId?: string };
  if (!itemId || !/^MLB\d+$/.test(itemId)) return NextResponse.json({ error: "ID de anúncio inválido" }, { status: 400 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const token = await getAccessToken(supabase);
  if (!token) return NextResponse.json({ error: "conta do Mercado Livre não conectada" }, { status: 400 });

  const [perf, item] = await Promise.all([mlGet(`/items/${itemId}/performance`, token), mlGet(`/items/${itemId}`, token)]);
  const it = item.body as { category_id?: string; attributes?: { id: string }[]; status?: string; sub_status?: string[]; pictures?: { size?: string }[]; descriptions?: unknown[] } | null;
  const cat = it?.category_id ? await mlGet(`/categories/${it.category_id}/attributes`, token) : null;
  const preenchidos = new Set((it?.attributes ?? []).map((a) => a.id));
  const faltando = (Array.isArray(cat?.body) ? (cat!.body as { id: string; name: string; tags?: Record<string, boolean>; value_type?: string }[]) : [])
    .filter((a) => !preenchidos.has(a.id) && !a.tags?.hidden && !a.tags?.read_only && !a.tags?.fixed)
    .map((a) => ({ id: a.id, nome: a.name, tipo: a.value_type, obrigatorio: !!(a.tags?.required || a.tags?.catalog_required), recomendado: !!(a.tags?.relevant || a.tags?.catalog_listing_required) }));

  return NextResponse.json({
    status: it?.status,
    sub_status: it?.sub_status,
    fotos: it?.pictures?.length ?? 0,
    descricoes: it?.descriptions?.length ?? 0,
    pendencias: perf.ok ? pendencias(perf.body) : [],
    atributosFaltando: faltando,
    brutos: { performance: { status: perf.status, body: perf.body } },
  });
}
