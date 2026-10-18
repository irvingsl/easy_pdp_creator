import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccessToken } from "@/marketplaces/mercadolivre/accounts";
import { mlGet, mlPost } from "@/marketplaces/mercadolivre/oauth";

export const maxDuration = 60;

/**
 * Exploração (somente leitura/consulta): testa como a API do ML trata compatibilidade de veículos,
 * para sabermos o formato certo antes de construir o envio. Não altera nenhum anúncio.
 */
export async function POST(request: NextRequest) {
  const { itemId } = (await request.json().catch(() => ({}))) as { itemId?: string };
  if (!itemId || !/^MLB\d+$/.test(itemId)) return NextResponse.json({ error: "ID de anúncio inválido" }, { status: 400 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const token = await getAccessToken(supabase);
  if (!token) return NextResponse.json({ error: "conta do Mercado Livre não conectada" }, { status: 400 });

  const resumo = (r: { status: number; body: unknown }) => ({ status: r.status, body: JSON.stringify(r.body).length > 3000 ? `${JSON.stringify(r.body).slice(0, 3000)}…(cortado)` : r.body });
  const dominios = ["MLB-CARS_AND_VANS", "MLB-CARS_AND_VANS_FOR_COMPATIBILITIES"];
  const testes: { nome: string; resultado: unknown }[] = [];

  testes.push({ nome: `GET /items/${itemId}/compatibilities`, resultado: resumo(await mlGet(`/items/${itemId}/compatibilities`, token)) });
  for (const d of dominios) {
    testes.push({
      nome: `POST count_family_products ${d} marca Volkswagen`,
      resultado: resumo(await mlPost("/catalog_compatibilities/products_search/count_family_products", token, { domain_id: d, attributes: [{ id: "BRAND", value_name: "Volkswagen" }] })),
    });
    testes.push({
      nome: `POST count_family_products ${d} Volkswagen + modelo Fusca`,
      resultado: resumo(await mlPost("/catalog_compatibilities/products_search/count_family_products", token, { domain_id: d, attributes: [{ id: "BRAND", value_name: "Volkswagen" }, { id: "CAR_AND_VAN_MODEL", value_name: "Fusca" }] })),
    });
  }
  for (const caminho of [`/catalog_domains/MLB-CARS_AND_VANS`, `/catalog_domains/MLB-CARS_AND_VANS/attributes`, `/catalog_compatibilities/domains/MLB-CARS_AND_VANS`]) {
    testes.push({ nome: `GET ${caminho}`, resultado: resumo(await mlGet(caminho, token)) });
  }
  return NextResponse.json({ testes });
}
