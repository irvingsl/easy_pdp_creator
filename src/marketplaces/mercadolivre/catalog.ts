import { mlGet } from "./oauth";

type Prod = {
  id: string; name: string; status: string; domain_id: string; category_id: string;
  attributes?: { id: string; value_name?: string }[];
};

export type CatalogHit = {
  code: string;
  queryType: string | null;
  total: number;
  exact: boolean;
  /** o produto achado é do mesmo tipo de peça que a IA identificou (evita falsos positivos) */
  relevante?: boolean;
  ignorado?: string;
  products: { id: string; name: string; brand: string; partNumber: string; status: string; diameter: string; category: string }[];
};

const attr = (p: Prod, id: string) => p.attributes?.find((a) => a.id === id)?.value_name ?? "";

/** Busca um número de peça no catálogo do ML; `exact` só quando o ML o reconhece como PART_NUMBER. */
export async function lookupPartNumber(token: string, code: string): Promise<CatalogHit> {
  const r = await mlGet(`/products/search?site_id=MLB&q=${encodeURIComponent(code)}&limit=5`, token);
  const b = r.body as { query_type?: string; paging?: { total?: number }; results?: Prod[] } | null;
  const exact = b?.query_type === "PART_NUMBER";
  return {
    code,
    queryType: b?.query_type ?? null,
    total: b?.paging?.total ?? 0,
    exact,
    products: exact
      ? (b?.results ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          brand: attr(p, "BRAND"),
          partNumber: attr(p, "PART_NUMBER"),
          status: p.status,
          diameter: attr(p, "CLUTCH_DISC_DIAMETER") || attr(p, "DISC_DIAMETER"),
          category: p.category_id,
        }))
      : [],
  };
}
