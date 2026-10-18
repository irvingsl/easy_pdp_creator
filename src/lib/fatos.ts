import { notasParaIA, type DadosConfirmados } from "@/domain/dados-confirmados";
import type { PartAnalysis } from "@/lib/gemini";

export type Identificacao = { analysis?: PartAnalysis };

/** Reúne os fatos do produto, separando o que o vendedor confirmou do que veio da IA/web. */
export function fatosDoProduto(oemCode: string | null, conf: DadosConfirmados | null, a: PartAnalysis | undefined) {
  const linhas: string[] = [];
  const confirmados = notasParaIA(oemCode, conf);
  if (confirmados) linhas.push(confirmados);
  if (a) {
    linhas.push(`Tipo de item: ${a.tipo_item ?? "?"}; formato de venda: ${a.formato_de_venda ?? "?"}`);
    if (a.marca?.valor) linhas.push(`Marca (${a.marca.origem}, confiança ${a.marca.confianca}): ${a.marca.valor}`);
    if (a.numero_peca_principal) linhas.push(`Número de peça principal (gravado no item): ${a.numero_peca_principal}`);
    for (const t of a.textos_gravados ?? []) linhas.push(`Texto gravado no item${t.foto ? ` (foto ${t.foto})` : ""}: ${t.texto}`);
    for (const c of a.caracteristicas ?? []) linhas.push(`Característica (${c.origem}, confiança ${c.confianca}): ${c.nome} = ${c.valor}${c.unidade ? ` ${c.unidade}` : ""}`);
    for (const c of (a.codigos ?? []).filter((c) => c.classe === "equivalente" && c.confianca !== "baixa")) linhas.push(`Código equivalente (${c.origem}): ${c.marca ?? ""} ${c.codigo}`);
    for (const ap of a.aplicacoes ?? []) linhas.push(`Aplicação (${ap.origem}, não confirmada pelo vendedor): ${ap.descricao}${ap.anos ? ` ${ap.anos}` : ""}`);
    if (a.preco?.minimo != null) linhas.push(`Faixa de preço vista na web: R$ ${a.preco.minimo} a R$ ${a.preco.maximo} (${a.preco.formato_de_referencia ?? "unidade"})`);
  }
  return linhas.join("\n");
}
