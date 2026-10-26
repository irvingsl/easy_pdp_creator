import { mlGet, mlPost } from "./oauth";

export const DOMINIO = "MLB-CARS_AND_VANS";
/** O ML aceita no máximo 200 produtos (versões de veículos) por chamada; cada família (marca/modelo/ano) vale a quantidade de produtos dela. */
export const MAX_PRODUTOS_POR_CHAMADA = 200;

export type Familia = { marca: string; modelo: string; ano: number; count?: number };

const attrs = (f: Familia) => [
  { id: "BRAND", value_name: f.marca },
  { id: "MODEL", value_name: f.modelo },
  { id: "VEHICLE_YEAR", value_name: String(f.ano) },
];

export async function contarFamilia(token: string, f: Familia): Promise<number> {
  const r = await mlPost("/catalog_compatibilities/products_search/count_family_products", token, { domain_id: DOMINIO, attributes: attrs(f) });
  return (r.body as { count?: number } | null)?.count ?? 0;
}

export type ResultadoEnvio = {
  ok: boolean;
  criadas: number;
  chamadas: { familias: number; produtos: number; status: number; corpo: unknown }[];
  /** famílias com mais de 200 produtos: não cabem numa chamada e precisam de filtro (versão/motor) no Gerenciador do ML */
  grandesDemais: Familia[];
  erro?: { status: number; corpo: unknown };
};

/**
 * Associa famílias (marca/modelo/ano) ao anúncio. Desde 15/07/2026 todo pedido exige `creation_source`,
 * e cada chamada só pode juntar até 200 produtos: as famílias são agrupadas por quantidade de produtos.
 */
export async function enviarFamilias(token: string, itemId: string, familias: Familia[]): Promise<ResultadoEnvio> {
  const comContagem: Familia[] = [];
  for (let i = 0; i < familias.length; i += 20) {
    const lote = familias.slice(i, i + 20);
    const cs = await Promise.all(lote.map((f) => (f.count != null ? Promise.resolve(f.count) : contarFamilia(token, f))));
    lote.forEach((f, j) => comContagem.push({ ...f, count: cs[j] }));
  }
  const grandesDemais = comContagem.filter((f) => (f.count ?? 0) > MAX_PRODUTOS_POR_CHAMADA);
  const utilizaveis = comContagem.filter((f) => (f.count ?? 0) > 0 && (f.count ?? 0) <= MAX_PRODUTOS_POR_CHAMADA);

  const grupos: Familia[][] = [];
  let atual: Familia[] = [];
  let soma = 0;
  for (const f of utilizaveis) {
    if (atual.length && soma + (f.count ?? 0) > MAX_PRODUTOS_POR_CHAMADA) {
      grupos.push(atual);
      atual = [];
      soma = 0;
    }
    atual.push(f);
    soma += f.count ?? 0;
  }
  if (atual.length) grupos.push(atual);

  const out: ResultadoEnvio = { ok: true, criadas: 0, chamadas: [], grandesDemais };
  for (const g of grupos) {
    const r = await mlPost(`/items/${itemId}/compatibilities`, token, {
      products_families: g.map((f) => ({ domain_id: DOMINIO, creation_source: "DEFAULT", attributes: attrs(f) })),
    });
    out.chamadas.push({ familias: g.length, produtos: g.reduce((s, f) => s + (f.count ?? 0), 0), status: r.status, corpo: r.body });
    if (!r.ok) {
      out.ok = false;
      out.erro = { status: r.status, corpo: r.body };
      break;
    }
    out.criadas += (r.body as { created_compatibilities_count?: number } | null)?.created_compatibilities_count ?? 0;
  }
  return out;
}

/** Quantas compatibilidades o ML mostra agora no anúncio (confere se o envio valeu). */
export async function compatibilidadesDoItem(token: string, itemId: string) {
  const r = await mlGet(`/items/${itemId}/compatibilities`, token);
  const produtos = ((r.body as { products?: { catalog_product_name?: string; total?: number; source?: string }[] } | null)?.products ?? []);
  return { status: r.status, entradas: produtos.length, total: produtos.reduce((s, p) => s + (p.total ?? 1), 0), amostra: produtos.slice(0, 5) };
}
