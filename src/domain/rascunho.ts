/** Rascunho de anúncio (independente de marketplace); o vendedor revisa e edita antes de publicar. */
export type Rascunho = {
  titulo: string;
  descricao: string;
  compatibilidade: { veiculo: string; anos: string | null; origem: "confirmado" | "sugerido_web" }[];
  atributos: { nome: string; valor: string; origem: "confirmado" | "lido_no_item" | "contado_na_foto" | "web" }[];
  preco: number | null;
  preco_faixa: { minimo: number; maximo: number } | null;
  avisos: string[];
  /** escolhas do vendedor para o Mercado Livre */
  categoria_id?: string;
  condicao?: "new" | "used";
  embalagem?: { altura: string; largura: string; comprimento: string; peso: string };
  geradoEm?: string;
};

/** Limite de caracteres do título no Mercado Livre. */
export const TITULO_MAX = 60;
