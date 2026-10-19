import { notasParaIA, type DadosConfirmados } from "@/domain/dados-confirmados";
import type { PartAnalysis } from "@/lib/gemini";

export type Identificacao = {
  analysis?: PartAnalysis;
  modeloCatalogo?: { nome: string; marca: string; codigoBuscado: string; categoria: string | null; atributos: { id: string; nome: string; valor: string }[] } | null;
};

/** O que é identidade do produto de outra marca (não se herda): marca, números, códigos, estado. */
const NAO_HERDAR = /^(BRAND|PART_NUMBER|OEM|GTIN|EAN|MPN|SELLER_SKU|ITEM_CONDITION|MODEL|ALPHANUMERIC_MODEL|LINE|MANUFACTURER)$/;

/** Reúne os fatos do produto, separando o que o vendedor confirmou do que veio da IA/web. */
export function fatosDoProduto(oemCode: string | null, conf: DadosConfirmados | null, a: PartAnalysis | undefined, modelo?: Identificacao["modeloCatalogo"]) {
  const linhas: string[] = [];
  const confirmados = notasParaIA(oemCode, conf);
  if (confirmados) linhas.push(confirmados);
  // Número confirmado pelo vendedor: é o único válido. Leituras gravadas parciais ou diferentes ficam de fora.
  const alnum = (t?: string | null) => (t ?? "").replace(/[^0-9a-z]/gi, "").toLowerCase();
  const numeroConfirmado = conf?.numero_peca || oemCode || null;
  if (numeroConfirmado) {
    linhas.push(`NÚMERO DE PEÇA CORRETO, confirmado pelo vendedor: ${numeroConfirmado}. Use sempre este número no título, nos atributos e na descrição. Qualquer leitura diferente ou menor (por exemplo, parte do número gravada na peça) está incompleta e deve ser ignorada.`);
  }
  const ehLeituraDoNumero = (t?: string | null) => {
    const x = alnum(t);
    const n = alnum(numeroConfirmado);
    return !!numeroConfirmado && !!x && (x === n || n.endsWith(x) || n.startsWith(x));
  };
  if (a) {
    linhas.push(`Tipo de item: ${a.tipo_item ?? "?"}; formato de venda: ${a.formato_de_venda ?? "?"}`);
    if (a.marca?.valor) linhas.push(`Marca (${a.marca.origem}, confiança ${a.marca.confianca}): ${a.marca.valor}`);
    if (a.numero_peca_principal && !numeroConfirmado) linhas.push(`Número de peça principal (gravado no item): ${a.numero_peca_principal}`);
    for (const t of (a.textos_gravados ?? []).filter((t) => !ehLeituraDoNumero(t.texto))) linhas.push(`Texto gravado no item${t.foto ? ` (foto ${t.foto})` : ""}: ${t.texto}`);
    for (const c of a.caracteristicas ?? []) linhas.push(`Característica (${c.origem}, confiança ${c.confianca}): ${c.nome} = ${c.valor}${c.unidade ? ` ${c.unidade}` : ""}`);
    for (const c of (a.codigos ?? []).filter((c) => c.classe === "equivalente" && c.confianca !== "baixa")) linhas.push(`Código equivalente (${c.origem}): ${c.marca ?? ""} ${c.codigo}`);
    for (const ap of a.aplicacoes ?? []) linhas.push(`Aplicação (${ap.origem}, não confirmada pelo vendedor): ${ap.descricao}${ap.anos ? ` ${ap.anos}` : ""}`);
    if (a.preco?.minimo != null) linhas.push(`Faixa de preço vista na web: R$ ${a.preco.minimo} a R$ ${a.preco.maximo} (${a.preco.formato_de_referencia ?? "unidade"})`);
  }
  if (modelo) {
    for (const at of modelo.atributos) {
      if (NAO_HERDAR.test(at.id)) continue;
      linhas.push(`Atributo do catálogo do ML (produto equivalente "${modelo.nome}", outra marca/código; vale se for a mesma peça): ${at.nome} = ${at.valor}`);
    }
  }
  return linhas.join("\n");
}
