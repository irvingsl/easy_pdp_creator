import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizarVeiculos } from "@/lib/gemini";
import { gravarUso, usoStore } from "@/lib/uso";
import { getAccessToken } from "@/marketplaces/mercadolivre/accounts";
import { mlPost } from "@/marketplaces/mercadolivre/oauth";
import type { Rascunho } from "@/domain/rascunho";

export const maxDuration = 60;

const DOMINIO = "MLB-CARS_AND_VANS";
const MAX_FAMILIAS = 150;

type Familia = { marca: string; modelo: string; ano: number };

export const POST = (request: NextRequest) => usoStore.run([], () => tratar(request));

const attrs = (f: Familia) => [
  { id: "BRAND", value_name: f.marca },
  { id: "MODEL", value_name: f.modelo },
  { id: "VEHICLE_YEAR", value_name: String(f.ano) },
];

/**
 * Compatibilidade de veículos do anúncio (domínio MLB-CARS_AND_VANS; atributos BRAND, MODEL e VEHICLE_YEAR).
 *  "previa": transforma a lista CONFIRMADA em combinações marca/modelo/ano e confere cada uma no catálogo do ML.
 *  "enviar": associa as combinações existentes ao anúncio.
 */
async function tratar(request: NextRequest) {
  const { acao, produtoId, itemId, familias } = (await request.json().catch(() => ({}))) as { acao?: "previa" | "enviar"; produtoId?: string; itemId?: string; familias?: Familia[] };
  if (!produtoId || !acao) return NextResponse.json({ error: "dados insuficientes" }, { status: 400 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const token = await getAccessToken(supabase);
  if (!token) return NextResponse.json({ error: "conta do Mercado Livre não conectada" }, { status: 400 });

  try {
    if (acao === "previa") {
      const { data: produto } = await supabase.from("produtos").select("rascunho").eq("id", produtoId).maybeSingle();
      const r = produto?.rascunho as Rascunho | null;
      const linhas = (r?.compatibilidade ?? []).filter((c) => c.origem === "confirmado").map((c) => `${c.veiculo}${c.anos ? ` ${c.anos}` : ""}`);
      if (!linhas.length) return NextResponse.json({ error: "confirme ao menos um veículo na lista de compatibilidade do rascunho (e salve o rascunho)" }, { status: 400 });
      const norm = await normalizarVeiculos(linhas);
      await gravarUso(supabase, produtoId, "compatibilidade").catch(() => {});
      if (!norm) return NextResponse.json({ error: "A IA não conseguiu interpretar a lista, tente de novo" }, { status: 502 });

      // combinações marca/modelo/ano (sem repetir); linhas sem ano ficam de fora e são avisadas
      const sem: string[] = [];
      const todas = new Map<string, Familia>();
      for (const n of norm) {
        if (!n.marca || !n.modelo) continue;
        if (n.ano_ini == null || n.ano_fim == null) {
          sem.push(`${n.marca} ${n.modelo}`);
          continue;
        }
        for (let a = Math.min(n.ano_ini, n.ano_fim); a <= Math.max(n.ano_ini, n.ano_fim) && a - Math.min(n.ano_ini, n.ano_fim) < 60; a++) {
          todas.set(`${n.marca}|${n.modelo}|${a}`, { marca: n.marca, modelo: n.modelo, ano: a });
        }
      }
      const lista = [...todas.values()].slice(0, MAX_FAMILIAS);
      // confere no catálogo (em lotes, para respeitar o tempo)
      const existentes: Familia[] = [];
      const ausentes: Familia[] = [];
      for (let i = 0; i < lista.length; i += 10) {
        const lote = lista.slice(i, i + 10);
        const res = await Promise.all(lote.map((f) => mlPost("/catalog_compatibilities/products_search/count_family_products", token, { domain_id: DOMINIO, attributes: attrs(f) })));
        res.forEach((x, j) => ((x.body as { count?: number } | null)?.count ?? 0) > 0 ? existentes.push(lote[j]) : ausentes.push(lote[j]));
      }
      return NextResponse.json({ existentes, ausentes, semAno: sem, truncado: todas.size > MAX_FAMILIAS });
    }

    // enviar
    if (!itemId || !/^MLB\d+$/.test(itemId) || !familias?.length) return NextResponse.json({ error: "anúncio e combinações obrigatórios" }, { status: 400 });
    const { data: anuncio } = await supabase.from("anuncios").select("id").eq("produto_id", produtoId).eq("external_id", itemId).maybeSingle();
    if (!anuncio) return NextResponse.json({ error: "anúncio não encontrado neste produto" }, { status: 404 });
    const corpo = { products_families: familias.slice(0, MAX_FAMILIAS).map((f) => ({ domain_id: DOMINIO, attributes: attrs(f) })) };
    const resp = await mlPost(`/items/${itemId}/compatibilities`, token, corpo);
    return NextResponse.json({ ok: resp.ok, status: resp.status, resposta: resp.body, enviadas: corpo.products_families.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "falha" }, { status: 500 });
  }
}
