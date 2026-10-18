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

  const cortar = (b: unknown, max = 2500) => {
    const t = JSON.stringify(b);
    return t.length > max ? `${t.slice(0, max)}…(cortado)` : b;
  };
  const testes: { nome: string; resultado: unknown }[] = [];
  const dominio = "MLB-CARS_AND_VANS";

  // 1) atributos do domínio de veículos (só id, nome e relevância; sem as listas de valores)
  const dom = await mlGet(`/catalog_domains/${dominio}`, token);
  const attrs = ((dom.body as { attributes?: { id: string; name: string; tags?: { hierarchy?: string; relevance?: number } }[] } | null)?.attributes ?? []).map((a) => ({ id: a.id, nome: a.name, hierarquia: a.tags?.hierarchy, relevancia: a.tags?.relevance }));
  testes.push({ nome: `GET /catalog_domains/${dominio} (atributos)`, resultado: { status: dom.status, atributos: attrs } });

  // 2) qual atributo guarda o modelo? testa contagens com marca + cada candidato
  const candidatos = attrs.filter((a) => a.id !== "BRAND" && /MODEL|VERSION|TRIM|YEAR|SUBMODEL|VEHICLE/i.test(`${a.id} ${a.nome}`)).slice(0, 6);
  for (const c of candidatos) {
    for (const valor of ["Fusca", "Gol"]) {
      const r = await mlPost("/catalog_compatibilities/products_search/count_family_products", token, { domain_id: dominio, attributes: [{ id: "BRAND", value_name: "Volkswagen" }, { id: c.id, value_name: valor }] });
      testes.push({ nome: `count ${dominio}: Volkswagen + ${c.id}=${valor}`, resultado: { status: r.status, body: cortar(r.body, 400) } });
    }
  }

  // 3) busca de produtos (veículos) do domínio, para ver o formato do que se associa ao anúncio
  const prod = await mlGet(`/products/search?status=active&site_id=MLB&domain_id=${dominio}&q=${encodeURIComponent("Volkswagen Fusca 1600")}&limit=3`, token);
  testes.push({ nome: "GET /products/search (veículos) Volkswagen Fusca 1600", resultado: { status: prod.status, body: cortar(prod.body, 3500) } });

  // 4) estado atual das compatibilidades do anúncio
  testes.push({ nome: `GET /items/${itemId}/compatibilities`, resultado: { status: (await mlGet(`/items/${itemId}/compatibilities`, token)).status } });
  return NextResponse.json({ testes });
}
