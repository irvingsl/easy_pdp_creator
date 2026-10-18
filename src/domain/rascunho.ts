/** Rascunho de anúncio (independente de marketplace); o vendedor revisa e edita antes de publicar. */
/** Campo da ficha técnica da categoria do ML, com o valor que o app (ou o vendedor) preencheu. */
export type CampoFicha = {
  id: string;
  nome: string;
  tipo: string;
  valor: string;
  /** para campos de lista: id da opção escolhida */
  valor_id?: string;
  origem?: "confirmado" | "lido_no_item" | "contado_na_foto" | "medido" | "vendedor";
  obrigatorio?: boolean;
  opcoes?: { id: string; name: string }[];
  unidades?: string[];
};

export type Rascunho = {
  titulo: string;
  descricao: string;
  compatibilidade: { veiculo: string; anos: string | null; origem: "confirmado" | "sugerido_web" }[];
  atributos: { nome: string; valor: string; origem: "confirmado" | "lido_no_item" | "contado_na_foto" | "web" }[];
  preco: number | null;
  preco_faixa: { minimo: number; maximo: number } | null;
  avisos: string[];
  ficha?: CampoFicha[];
  /** oferecer frete grátis por conta do vendedor (onde o ML não o exige); o ML impõe quando obrigatório */
  frete_gratis?: boolean;
  /** escolhas do vendedor para o Mercado Livre */
  categoria_id?: string;
  condicao?: "new" | "used";
  /** garantia oferecida pelo vendedor; sem isso o anúncio sai "sem garantia" */
  garantia?: { tipo: "vendedor" | "fabrica" | "sem"; dias?: string };
  embalagem?: { altura: string; largura: string; comprimento: string; peso: string };
  geradoEm?: string;
};

/** Limite de caracteres do título no Mercado Livre. */
export const TITULO_MAX = 60;

/** Garantia legal (CDC art. 26): 90 dias para bens duráveis. Usada quando o vendedor não escolhe outra. */
export const GARANTIA_PADRAO = { tipo: "vendedor", dias: "90" } as const;
