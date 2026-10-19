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
  /** status HTTP e variantes tentadas, para diagnosticar buscas sem resultado */
  status?: number;
  variantes?: string[];
  /** o produto achado é do mesmo tipo de peça que a IA identificou (evita falsos positivos) */
  relevante?: boolean;
  ignorado?: string;
  products: { id: string; name: string; brand: string; partNumber: string; status: string; diameter: string; category: string }[];
};

const attr = (p: Prod, id: string) => p.attributes?.find((a) => a.id === id)?.value_name ?? "";

/** Escritas diferentes do mesmo número: "040.141.031.7", "040141031 7", "0401410317". */
const variantes = (code: string) => [...new Set([code.trim(), code.replace(/\s+/g, ""), code.replace(/[^0-9A-Za-z]/g, "")])].filter(Boolean);

async function buscar(token: string, code: string): Promise<CatalogHit> {
  const r = await mlGet(`/products/search?site_id=MLB&q=${encodeURIComponent(code)}&limit=5`, token);
  const b = r.body as { query_type?: string; paging?: { total?: number }; results?: Prod[] } | null;
  const exact = b?.query_type === "PART_NUMBER";
  return {
    code,
    status: r.status,
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

/** Busca um número de peça no catálogo do ML, tentando as variantes de escrita; `exact` só quando o ML o reconhece como PART_NUMBER. */
export async function lookupPartNumber(token: string, code: string): Promise<CatalogHit> {
  let ultimo: CatalogHit | null = null;
  for (const v of variantes(code)) {
    const hit = await buscar(token, v);
    if (hit.exact) return { ...hit, code, variantes: variantes(code) };
    ultimo = hit;
  }
  return { ...(ultimo as CatalogHit), code, variantes: variantes(code) };
}

/** Produtos do catálogo do ML para uma busca por palavras (ajuda com códigos curtos, que não se acham por número de peça). */
export async function buscarPorPalavras(token: string, q: string) {
  const r = await mlGet(`/products/search?site_id=MLB&q=${encodeURIComponent(q)}&limit=6`, token);
  const b = r.body as { results?: Prod[] } | null;
  return (b?.results ?? []).map((p) => ({ id: p.id, name: p.name, brand: attr(p, "BRAND"), partNumber: attr(p, "PART_NUMBER") }));
}

export type ModeloCatalogo = {
  codigoBuscado: string;
  produtoId: string;
  nome: string;
  marca: string;
  dominio: string | null;
  categoria: string | null;
  /** atributos preenchidos do produto do catálogo (a base para a ficha técnica) */
  atributos: { id: string; nome: string; valor: string }[];
  /** campos que a resposta do ML trouxe, para sabermos o que mais dá para aproveitar (compatibilidade etc.) */
  chaves: string[];
};

/** Detalhes completos de um produto do catálogo: serve de modelo (ficha técnica) para uma peça idêntica de outra marca/código. */
export async function modeloDoCatalogo(token: string, hit: CatalogHit): Promise<ModeloCatalogo | null> {
  const p = hit.products[0];
  if (!p) return null;
  const r = await mlGet(`/products/${encodeURIComponent(p.id)}`, token);
  const b = r.body as { name?: string; domain_id?: string; category_id?: string; attributes?: { id: string; name?: string; value_name?: string }[] } | null;
  if (!r.ok || !b) return null;
  return {
    codigoBuscado: hit.code,
    produtoId: p.id,
    nome: b.name ?? p.name,
    marca: p.brand,
    dominio: b.domain_id ?? null,
    categoria: b.category_id ?? p.category ?? null,
    atributos: (b.attributes ?? []).filter((a) => a.value_name).map((a) => ({ id: a.id, nome: a.name ?? a.id, valor: String(a.value_name) })),
    chaves: Object.keys(b),
  };
}
