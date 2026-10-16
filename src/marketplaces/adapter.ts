import type { Anuncio, Produto, ProdutoFoto } from "@/domain/types";

/** Contrato que cada marketplace (Mercado Livre, Shopee, ...) implementa. */
export interface MarketplaceAdapter {
  readonly id: string;
  authenticate(code: string): Promise<{ externalUserId: string }>;
  findCategory(query: string): Promise<{ id: string; name: string }[]>;
  getRequiredAttributes(categoryId: string): Promise<{ id: string; name: string; required: boolean }[]>;
  publish(produto: Produto, fotos: ProdutoFoto[], preco: number): Promise<Anuncio>;
  getStock(anuncio: Anuncio): Promise<number>;
  updateStock(anuncio: Anuncio, qty: number): Promise<void>;
}
