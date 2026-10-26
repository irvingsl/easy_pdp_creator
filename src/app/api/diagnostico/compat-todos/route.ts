import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { usoStore } from "@/lib/uso";
import { getAccessToken } from "@/marketplaces/mercadolivre/accounts";
import { compatibilidadesDoItem, enviarFamilias } from "@/marketplaces/mercadolivre/compat";
import { montarPrevia } from "@/marketplaces/mercadolivre/compat-previa";

export const maxDuration = 60;

export const GET = (request: NextRequest) => usoStore.run([], () => tratar(request));

/**
 * Envia a compatibilidade (veículos confirmados do rascunho) de TODOS os anúncios publicados que ainda não foram enviados por aqui.
 * Cabe ~45 s por chamada: abra de novo até "restantes" chegar a 0. `?refazer=1` repete os já enviados.
 */
async function tratar(request: NextRequest) {
  const refazer = request.nextUrl.searchParams.get("refazer") === "1";
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const token = await getAccessToken(supabase);
  if (!token) return NextResponse.json({ error: "conta do ML não conectada" }, { status: 400 });

  const { data: produtos } = await supabase
    .from("produtos")
    .select("id, sku, anuncios(external_id, status)")
    .order("sku", { ascending: true });
  const alvos = (produtos ?? [])
    .map((p) => ({ id: p.id as string, sku: p.sku as string, item: (p.anuncios ?? []).find((a) => a.external_id && a.status !== "deleted" && a.status !== "closed")?.external_id as string | undefined }))
    .filter((p): p is { id: string; sku: string; item: string } => !!p.item);

  const { data: feitos } = await supabase.from("diagnosticos").select("dados").eq("tipo", "compat-envio");
  const jaOk = new Set((feitos ?? []).filter((d) => (d.dados as { ok?: boolean }).ok).map((d) => (d.dados as { sku: string }).sku));

  const ini = Date.now();
  const resultados: Record<string, unknown>[] = [];
  let restantes = 0;
  for (const alvo of alvos) {
    if (!refazer && jaOk.has(alvo.sku)) continue;
    if (Date.now() - ini > 40000) {
      restantes++;
      continue;
    }
    const r: Record<string, unknown> = { sku: alvo.sku, item: alvo.item };
    try {
      const previa = await montarPrevia(supabase, token, alvo.id);
      if ("error" in previa) {
        Object.assign(r, { ok: false, motivo: previa.error });
      } else {
        const envio = previa.existentes.length ? await enviarFamilias(token, alvo.item, previa.existentes) : null;
        const depois = await compatibilidadesDoItem(token, alvo.item).catch(() => null);
        Object.assign(r, {
          ok: !!envio?.ok && (envio.criadas > 0 || (depois?.entradas ?? 0) > 0),
          enviadas: envio?.criadas ?? 0,
          semAno: previa.semAno,
          modelosNaoEncontrados: previa.modelosNaoEncontrados,
          ausentes: previa.ausentes.length,
          grandesDemais: envio?.grandesDemais.map((g) => `${g.marca} ${g.modelo} ${g.ano}`) ?? [],
          erro: envio?.erro,
          noML: depois,
          motivo: previa.existentes.length ? undefined : "nenhuma combinação marca/modelo/ano achada no catálogo",
        });
      }
    } catch (e) {
      Object.assign(r, { ok: false, motivo: e instanceof Error ? e.message : "falha" });
    }
    resultados.push(r);
    await supabase.from("diagnosticos").insert({ tipo: "compat-envio", dados: r });
  }
  return NextResponse.json({
    processados: resultados.length,
    restantes,
    aviso: restantes ? "Ainda há anúncios: abra este endereço de novo." : "Terminou.",
    resumo: resultados.map((r) => ({ sku: r.sku, ok: r.ok, enviadas: r.enviadas, motivo: r.motivo, noML: (r.noML as { entradas?: number } | null)?.entradas })),
  });
}
