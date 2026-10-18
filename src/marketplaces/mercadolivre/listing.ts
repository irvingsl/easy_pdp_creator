import { mlGet } from "./oauth";
import { GARANTIA_PADRAO, type CampoFicha, type Rascunho } from "@/domain/rascunho";
import type { DadosConfirmados } from "@/domain/dados-confirmados";

export type CategoriaSugerida = { id: string; nome: string; caminho: string };

/** Categorias que o ML sugere para o texto (domain_discovery), com o caminho completo. */
export async function sugerirCategorias(token: string, texto: string): Promise<CategoriaSugerida[]> {
  const r = await mlGet(`/sites/MLB/domain_discovery/search?limit=4&q=${encodeURIComponent(texto)}`, token);
  const lista = (Array.isArray(r.body) ? r.body : []) as { category_id: string; category_name: string }[];
  return Promise.all(
    lista.map(async (d) => {
      const c = await mlGet(`/categories/${d.category_id}`, token);
      const path = (c.body as { path_from_root?: { name: string }[] } | null)?.path_from_root;
      return { id: d.category_id, nome: d.category_name, caminho: path?.map((p) => p.name).join(" > ") ?? d.category_name };
    }),
  );
}

export type AtributoCategoria = { id: string; name: string; value_type?: string; tags?: Record<string, boolean>; values?: { id: string; name: string }[]; allowed_units?: { id: string; name: string }[]; default_unit?: string };

export async function atributosDaCategoria(token: string, categoria: string): Promise<AtributoCategoria[]> {
  const r = await mlGet(`/categories/${categoria}/attributes`, token);
  return Array.isArray(r.body) ? (r.body as AtributoCategoria[]) : [];
}

const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const achar = (r: Rascunho, ...nomes: string[]) => r.atributos.find((a) => nomes.some((n) => norm(a.nome).includes(n)))?.valor;

/**
 * Monta o corpo do anúncio (modelo "User Products": o ML monta o título a partir do family_name).
 * Só entra o que o vendedor confirmou ou o item mostra; atributos obrigatórios que faltarem
 * aparecem na resposta de /items/validate.
 */
export function montarAnuncio(opts: {
  rascunho: Rascunho;
  conf: DadosConfirmados | null;
  oemCode: string | null;
  categoria: string;
  atributosCategoria: AtributoCategoria[];
  fotos: string[];
}) {
  const { rascunho: r, conf, categoria, atributosCategoria } = opts;
  const e = r.embalagem;
  const attrs: { id: string; value_name?: string; value_id?: string }[] = [];
  const marca = conf?.marca || achar(r, "marca");
  const numero = conf?.numero_peca || opts.oemCode || achar(r, "numero");
  if (marca) attrs.push({ id: "BRAND", value_name: marca });
  if (numero) attrs.push({ id: "PART_NUMBER", value_name: numero });
  const tipoVeiculo = atributosCategoria.find((a) => a.id === "VEHICLE_TYPE")?.values?.find((v) => /carro|caminhonete/.test(norm(v.name)));
  if (tipoVeiculo) attrs.push({ id: "VEHICLE_TYPE", value_id: tipoVeiculo.id });
  // Embalagem do vendedor: o ML ignora PACKAGE_* ("not modifiable") e guarda em SELLER_PACKAGE_*
  const num = (v: string) => v.replace(",", ".").trim();
  if (e?.altura && e.largura && e.comprimento && e.peso) {
    attrs.push(
      { id: "SELLER_PACKAGE_HEIGHT", value_name: `${num(e.altura)} cm` },
      { id: "SELLER_PACKAGE_WIDTH", value_name: `${num(e.largura)} cm` },
      { id: "SELLER_PACKAGE_LENGTH", value_name: `${num(e.comprimento)} cm` },
      { id: "SELLER_PACKAGE_WEIGHT", value_name: `${num(e.peso)} g` },
    );
  }
  // ficha técnica preenchida (só campos com valor e que ainda não foram enviados acima)
  for (const f of r.ficha ?? []) {
    if (!f.valor.trim() || attrs.some((a) => a.id === f.id)) continue;
    attrs.push(f.tipo === "list" && f.valor_id ? { id: f.id, value_id: f.valor_id } : { id: f.id, value_name: f.valor.trim() });
  }
  const g = r.garantia ?? GARANTIA_PADRAO;
  const sale_terms = g && g.tipo !== "sem"
    ? [
        { id: "WARRANTY_TYPE", value_name: g.tipo === "fabrica" ? "Garantia de fábrica" : "Garantia do vendedor" },
        ...(g.dias?.trim() ? [{ id: "WARRANTY_TIME", value_name: `${g.dias.trim()} dias` }] : []),
      ]
    : [];
  return {
    ...(sale_terms.length ? { sale_terms } : {}),
    family_name: r.titulo.trim(),
    category_id: categoria,
    price: r.preco ?? 0,
    currency_id: "BRL",
    available_quantity: 1,
    buying_mode: "buy_it_now",
    condition: r.condicao ?? "new",
    listing_type_id: "gold_special",
    pictures: opts.fotos.map((source) => ({ source })),
    attributes: attrs,
    shipping: { mode: "me2", local_pick_up: false, free_shipping: r.frete_gratis === true },
  };
}

type Causa = { type?: string; code?: string; message?: string };

/** /items/validate responde HTTP 400 mesmo quando só há avisos: só "error" reprova. */
export function analisarValidacao(res: { ok: boolean; status: number; body: unknown }) {
  const causas = ((res.body as { cause?: Causa[] } | null)?.cause ?? []).filter((c) => c && typeof c === "object");
  const erros = causas.filter((c) => c.type === "error").map((c) => c.message ?? c.code ?? "erro");
  const avisos = causas.filter((c) => c.type !== "error").map((c) => c.message ?? c.code ?? "aviso");
  // sem causas legíveis e com status de erro: reprovado por segurança
  const aceito = res.ok || (causas.length > 0 && erros.length === 0);
  return { aceito, erros, avisos };
}

const FORA_DA_FICHA = /^(BRAND|PART_NUMBER|VEHICLE_TYPE|ITEM_CONDITION|SELLER_SKU|(SELLER_)?PACKAGE_.*|GTIN|EAN|MPN)$/;

/** Campos da ficha técnica que o vendedor pode preencher (fora os que o app já trata à parte). */
export function camposDaFicha(atributos: AtributoCategoria[]): Omit<CampoFicha, "valor">[] {
  return atributos
    .filter((a) => !FORA_DA_FICHA.test(a.id) && !a.tags?.hidden && !a.tags?.read_only && !a.tags?.fixed)
    .map((a) => ({
      id: a.id,
      nome: a.name,
      tipo: a.value_type ?? "string",
      obrigatorio: !!(a.tags?.required || a.tags?.catalog_required),
      ...(a.value_type === "list" && a.values?.length ? { opcoes: a.values.slice(0, 80) } : {}),
      ...(a.allowed_units?.length ? { unidades: a.allowed_units.map((u) => u.name) } : {}),
    }));
}

/** Descrição final: o texto do vendedor mais a lista de compatibilidade confirmada (se o texto ainda não a trouxer). */
export function descricaoFinal(r: Rascunho) {
  const confirmadas = r.compatibilidade.filter((c) => c.origem === "confirmado");
  if (!confirmadas.length || /compat[ií]vel|compatibilidade/i.test(r.descricao)) return r.descricao;
  const linhas = confirmadas.map((c) => `- ${c.veiculo}${c.anos ? ` ${c.anos}` : ""}`);
  return `${r.descricao.trim()}\n\nCompatível com:\n${linhas.join("\n")}`;
}
