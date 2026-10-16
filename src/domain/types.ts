export type Produto = {
  id: string;
  user_id: string;
  sku: string;
  oem_code: string | null;
  titulo_base: string | null;
  descricao_base: string | null;
  estoque: number;
  status: "rascunho" | "ativo" | "arquivado";
  criado_em: string;
};

export type ProdutoFoto = {
  id: string;
  produto_id: string;
  path_original: string;
  path_processada: string | null;
  status_processamento: "pendente" | "ok" | "erro";
  ordem: number;
};

export type Anuncio = {
  id: string;
  produto_id: string;
  conta_id: string | null;
  marketplace: string;
  external_id: string | null;
  preco: number | null;
  status: string;
  ultimo_sync_em: string | null;
};

export const BUCKET_ORIGINAIS = "originais";
export const BUCKET_PROCESSADAS = "processadas";
