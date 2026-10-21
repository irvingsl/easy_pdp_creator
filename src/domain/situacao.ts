export type Situacao = {
  cor: "verde" | "amarelo" | "vermelho" | "cinza";
  titulo: string;
};

type Entrada = {
  fila_etapa: string | null;
  fila_erro: string | null;
  estoque: number;
  anuncios: { status: string | null; external_id: string | null }[];
  fotos: { status_processamento: string }[];
  tem_rascunho: boolean;
  preco: number | null;
};

/**
 * Situação de um produto para a bolinha da lista:
 *  vermelho = deu erro ou o estoque acabou num produto publicado;  amarelo = precisa de algo seu;
 *  verde = publicado no Mercado Livre;  cinza = o servidor ainda está trabalhando.
 */
export function situacaoDoProduto(p: Entrada): Situacao {
  const publicado = p.anuncios.some((a) => a.external_id && a.status !== "deleted" && a.status !== "closed");
  if (p.fila_etapa === "erro") return { cor: "vermelho", titulo: "Deu erro no processamento" };
  if (publicado && p.estoque <= 0) return { cor: "vermelho", titulo: "Publicado, mas sem estoque" };
  if (p.fila_etapa === "identificar" || p.fila_etapa === "rascunho") return { cor: "cinza", titulo: "O servidor está processando" };
  if (p.fotos.some((f) => f.status_processamento === "erro")) return { cor: "amarelo", titulo: "Uma foto falhou: refaça o fundo ou use o original" };
  if (publicado) return { cor: "verde", titulo: "Publicado no Mercado Livre" };
  if (p.estoque <= 0) return { cor: "amarelo", titulo: "Informe o estoque" };
  if (p.fila_erro) return { cor: "amarelo", titulo: p.fila_erro };
  if (!p.tem_rascunho) return { cor: "amarelo", titulo: "Falta gerar o rascunho" };
  if (p.fotos.some((f) => f.status_processamento === "pendente")) return { cor: "amarelo", titulo: "Fotos ainda com o fundo original" };
  if (p.preco == null) return { cor: "amarelo", titulo: "Falta o preço e conferir os dados" };
  return { cor: "amarelo", titulo: "Pronto para publicar" };
}

export const COR_BOLINHA: Record<Situacao["cor"], string> = {
  verde: "bg-green-500",
  amarelo: "bg-amber-400",
  vermelho: "bg-red-500",
  cinza: "bg-gray-400 animate-pulse",
};
