import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizarVeiculos } from "@/lib/gemini";
import { gravarUso } from "@/lib/uso";
import { mlPost } from "./oauth";
import { DOMINIO, type Familia } from "./compat";
import type { Rascunho } from "@/domain/rascunho";

const MAX_FAMILIAS = 400;

const attrs = (f: { marca: string; modelo: string; ano: number }) => [
  { id: "BRAND", value_name: f.marca },
  { id: "MODEL", value_name: f.modelo },
  { id: "VEHICLE_YEAR", value_name: String(f.ano) },
];

export type Previa = { existentes: (Familia & { count: number })[]; ausentes: Familia[]; semAno: string[]; modelosNaoEncontrados: string[]; truncado: boolean };

/** Transforma a lista de veículos CONFIRMADOS do rascunho em combinações marca/modelo/ano e confere cada uma no catálogo do ML. */
export async function montarPrevia(supabase: SupabaseClient, token: string, produtoId: string): Promise<Previa | { error: string; http: number }> {
  const { data: produto } = await supabase.from("produtos").select("rascunho").eq("id", produtoId).maybeSingle();
  const r = produto?.rascunho as Rascunho | null;
  const linhas = (r?.compatibilidade ?? []).filter((c) => c.origem === "confirmado").map((c) => `${c.veiculo}${c.anos ? ` ${c.anos}` : ""}`);
  if (!linhas.length) return { error: "confirme ao menos um veículo na lista de compatibilidade do rascunho (e salve o rascunho)", http: 400 };
  const norm = await normalizarVeiculos(linhas);
  await gravarUso(supabase, produtoId, "compatibilidade").catch(() => {});
  if (!norm) return { error: "A IA não conseguiu interpretar a lista, tente de novo", http: 502 };

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
  // O catálogo escreve o modelo à sua maneira ("Tl", "Karmann Ghia Tc"...): para cada modelo, descobre uma grafia que exista
  const semAcento = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const cap = (t: string) => t.toLowerCase().replace(/(^|\s|-)\S/g, (c) => c.toUpperCase());
  const grafias = new Map<string, string>();
  const modelosPedidos = [...new Set([...todas.values()].map((f) => `${f.marca}|${f.modelo}`))];
  for (const chave of modelosPedidos) {
    const [marca, modelo] = chave.split("|");
    const base = [modelo, semAcento(modelo), cap(modelo), cap(semAcento(modelo)), modelo.toUpperCase(), `${cap(modelo)} Tc`];
    // variações de escrita do catálogo: "F-75" x "F75" x "F 75"; geração romana ("Corcel I", "Corcel II")
    const extras = base.flatMap((m) => [m.replace(/-/g, ""), m.replace(/-/g, " "), `${m} I`, `${m} II`]);
    const candidatos = [...new Set([...base, ...extras])];
    for (const c of candidatos) {
      const r = await mlPost("/catalog_compatibilities/products_search/count_family_products", token, { domain_id: DOMINIO, attributes: [{ id: "BRAND", value_name: marca }, { id: "MODEL", value_name: c }] });
      if (((r.body as { count?: number } | null)?.count ?? 0) > 0) {
        grafias.set(`${marca}|${modelo}`, c);
        break;
      }
    }
  }
  const modelosNaoEncontrados = modelosPedidos.filter((k) => !grafias.has(k)).map((k) => k.replace("|", " "));
  const lista = [...todas.values()]
    .filter((f) => grafias.has(`${f.marca}|${f.modelo}`))
    .map((f) => ({ ...f, modelo: grafias.get(`${f.marca}|${f.modelo}`)! }))
    .slice(0, MAX_FAMILIAS);
  // confere no catálogo (em lotes, para respeitar o tempo)
  const existentes: (Familia & { count: number })[] = [];
  const ausentes: Familia[] = [];
  for (let i = 0; i < lista.length; i += 20) {
    const lote = lista.slice(i, i + 20);
    const res = await Promise.all(lote.map((f) => mlPost("/catalog_compatibilities/products_search/count_family_products", token, { domain_id: DOMINIO, attributes: attrs(f) })));
    res.forEach((x, j) => {
      const count = (x.body as { count?: number } | null)?.count ?? 0;
      if (count > 0) existentes.push({ ...lote[j], count });
      else ausentes.push(lote[j]);
    });
  }
  return { existentes, ausentes, semAno: sem, modelosNaoEncontrados, truncado: todas.size > MAX_FAMILIAS };
}
