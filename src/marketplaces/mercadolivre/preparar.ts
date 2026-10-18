import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKET_PROCESSADAS } from "@/domain/types";
import type { Rascunho } from "@/domain/rascunho";
import type { DadosConfirmados } from "@/domain/dados-confirmados";
import { atributosDaCategoria, montarAnuncio, sugerirCategorias } from "./listing";

/** Lê o rascunho salvo do produto e monta o corpo do anúncio do ML (usado pela validação e pela publicação). */
export async function prepararAnuncio(supabase: SupabaseClient, token: string, produtoId: string, sugerir = false) {
  const { data: produto } = await supabase
    .from("produtos")
    .select("id, oem_code, estoque, dados_confirmados, rascunho, produto_fotos(path_processada, ordem, manter_original, status_processamento)")
    .eq("id", produtoId)
    .maybeSingle();
  if (!produto) return { erro: "produto não encontrado", http: 404 } as const;
  const r = produto.rascunho as Rascunho | null;
  if (!r?.titulo) return { erro: "gere e salve o rascunho primeiro", http: 400 } as const;

  if (sugerir || !r.categoria_id) {
    const categorias = await sugerirCategorias(token, r.titulo);
    if (sugerir || !categorias.length) return { categorias } as const;
    r.categoria_id = categorias[0].id;
  }
  const atributosCategoria = await atributosDaCategoria(token, r.categoria_id);
  const comProcessada = produto.produto_fotos.filter((f) => f.path_processada).sort((a, b) => a.ordem - b.ordem);
  // O ML exige fundo branco na foto principal: a primeira precisa ser a versão processada, não a original mantida
  const fotoPrincipalOk = !!comProcessada[0] && comProcessada[0].status_processamento === "ok" && !comProcessada[0].manter_original;
  const fotos = comProcessada.map((f) => supabase.storage.from(BUCKET_PROCESSADAS).getPublicUrl(f.path_processada!).data.publicUrl);
  const payload = montarAnuncio({
    rascunho: r,
    conf: produto.dados_confirmados as DadosConfirmados | null,
    oemCode: produto.oem_code,
    categoria: r.categoria_id,
    atributosCategoria,
    fotos,
    quantidade: produto.estoque,
  });
  return { rascunho: r, payload, atributosCategoria, fotoPrincipalOk, estoque: produto.estoque as number } as const;
}
