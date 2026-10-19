/** Dados que o vendedor conferiu com o item na mão; têm prioridade sobre o que a IA ou a web disseram. */
export type DadosConfirmados = {
  marca?: string;
  numero_peca?: string;
  /** veículo/aplicação que o vendedor já sabe (ajuda muito a pesquisa) */
  veiculo?: string;
  /** id da foto que o vendedor escolheu para a busca por imagem */
  foto_busca?: string;
  caracteristicas?: { nome: string; valor: string; unidade?: string }[];
};

/** Texto que entra no pedido à IA como fato. */
export function notasParaIA(oemCode: string | null, d: DadosConfirmados | null): string | undefined {
  const linhas: string[] = [];
  if (d?.marca) linhas.push(`marca: ${d.marca}`);
  if (d?.veiculo) linhas.push(`veículo/aplicação informado: ${d.veiculo}`);
  const numero = d?.numero_peca || oemCode;
  if (numero) linhas.push(`número de peça gravado no item: ${numero}`);
  for (const c of d?.caracteristicas ?? []) linhas.push(`${c.nome}: ${c.valor}${c.unidade ? ` ${c.unidade}` : ""}`);
  return linhas.length
    ? `Fatos confirmados pelo vendedor com o item na mão (são verdadeiros; se uma fonte da web discordar, a fonte está errada ou é de outra variante):\n- ${linhas.join("\n- ")}`
    : undefined;
}
