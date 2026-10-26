import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccessToken, getAccount } from "@/marketplaces/mercadolivre/accounts";
import { mlGet } from "@/marketplaces/mercadolivre/oauth";

export const maxDuration = 30;

const corta = (b: unknown, n = 6000) => {
  const t = JSON.stringify(b);
  return t && t.length > n ? `${t.slice(0, n)}… (cortado, ${t.length} caracteres)` : b;
};

/**
 * Diagnóstico (só leitura): como o ML enxerga a compatibilidade de um anúncio. Grava o resultado na tabela
 * `diagnosticos` para análise; abra /api/diagnostico/compat?sku=AP-000011 logado.
 */
export async function GET(request: NextRequest) {
  const sku = request.nextUrl.searchParams.get("sku");
  if (!sku) return NextResponse.json({ error: "use ?sku=AP-000011" }, { status: 400 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const token = await getAccessToken(supabase);
  const conta = await getAccount(supabase);
  if (!token || !conta) return NextResponse.json({ error: "conta do ML não conectada" }, { status: 400 });

  const { data: p } = await supabase.from("produtos").select("id, rascunho, anuncios(external_id, status)").eq("sku", sku).maybeSingle();
  const item = (p?.anuncios ?? []).find((a) => a.external_id && a.status !== "deleted")?.external_id;
  if (!item) return NextResponse.json({ error: "produto sem anúncio publicado" }, { status: 404 });

  const testes: Record<string, unknown> = {};
  const rodar = async (nome: string, caminho: string) => {
    try {
      const r = await mlGet(caminho, token);
      testes[nome] = { caminho, status: r.status, corpo: corta(r.body) };
    } catch (e) {
      testes[nome] = { caminho, erro: e instanceof Error ? e.message : "falha" };
    }
  };
  await rodar("item", `/items/${item}?attributes=id,status,sub_status,tags,category_id,health,warnings`);
  await rodar("compatibilidades", `/items/${item}/compatibilities`);
  await rodar("compatibilidades_extendido", `/items/${item}/compatibilities?extended=true`);
  await rodar("sugestoes_a", `/items/${item}/compatibilities/suggestions`);
  await rodar("sugestoes_b", `/items/${item}/suggested_compatibilities`);
  await rodar("pendentes", `/users/${conta.external_user_id}/items/search?tags=pending_compatibilities&limit=50`);
  await rodar("incompletos", `/users/${conta.external_user_id}/items/search?tags=incomplete_compatibilities&limit=50`);

  // o frete que a calculadora pede ao ML (o ML mostra "a pagar" diferente do que a calculadora devolveu)
  const r = p?.rascunho as { preco?: number; condicao?: string; embalagem?: { altura: string; largura: string; comprimento: string; peso: string } } | null;
  const e = r?.embalagem;
  if (e?.altura && e.largura && e.comprimento && e.peso && r?.preco) {
    const n = (v: string) => v.replace(",", ".").trim();
    const q = new URLSearchParams({ dimensions: `${n(e.altura)}x${n(e.largura)}x${n(e.comprimento)},${n(e.peso)}`, item_price: String(r.preco), listing_type_id: "gold_special", mode: "me2", condition: r.condicao ?? "new", verbose: "true" });
    await rodar("frete_calculadora", `/users/${conta.external_user_id}/shipping_options/free?${q}`);
    testes.embalagem_usada = e;
  }

  const dados = { sku, item, testes };
  await supabase.from("diagnosticos").insert({ tipo: "compat", dados });
  return NextResponse.json({ ok: true, aviso: "Resultado guardado para análise.", item, resumo: Object.fromEntries(Object.entries(testes).map(([k, v]) => [k, (v as { status?: number }).status ?? "erro"])) });
}
