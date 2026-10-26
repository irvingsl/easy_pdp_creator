import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { usoStore } from "@/lib/uso";
import { getAccessToken } from "@/marketplaces/mercadolivre/accounts";
import { montarPrevia } from "@/marketplaces/mercadolivre/compat-previa";
import { compatibilidadesDoItem, enviarFamilias, type Familia as FamiliaML } from "@/marketplaces/mercadolivre/compat";

export const maxDuration = 60;

const MAX_FAMILIAS = 400;

type Familia = { marca: string; modelo: string; ano: number };

export const POST = (request: NextRequest) => usoStore.run([], () => tratar(request));

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
      const p = await montarPrevia(supabase, token, produtoId);
      if ("error" in p) return NextResponse.json({ error: p.error }, { status: p.http });
      return NextResponse.json(p);
    }

    // enviar
    if (!itemId || !/^MLB\d+$/.test(itemId) || !familias?.length) return NextResponse.json({ error: "anúncio e combinações obrigatórios" }, { status: 400 });
    const { data: anuncio } = await supabase.from("anuncios").select("id").eq("produto_id", produtoId).eq("external_id", itemId).maybeSingle();
    if (!anuncio) return NextResponse.json({ error: "anúncio não encontrado neste produto" }, { status: 404 });
    const envio = await enviarFamilias(token, itemId, familias.slice(0, MAX_FAMILIAS) as FamiliaML[]);
    const depois = await compatibilidadesDoItem(token, itemId).catch(() => null);
    return NextResponse.json({ ok: envio.ok, status: envio.erro?.status ?? 200, resposta: envio.erro?.corpo ?? envio.chamadas, enviadas: envio.criadas, grandesDemais: envio.grandesDemais, noML: depois });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "falha" }, { status: 500 });
  }
}
