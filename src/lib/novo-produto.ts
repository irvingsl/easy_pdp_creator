import type { SupabaseClient } from "@supabase/supabase-js";
import { saveOriginal } from "@/lib/photos";

type Dados = { oem?: string; marca?: string; veiculo?: string; quantidade: number };

/** Cria o produto com as fotos já reduzidas, grava os originais e o põe na fila do servidor. Devolve o id. */
export async function criarProdutoNaFila(supabase: SupabaseClient, userId: string, smalls: Blob[], dados: Dados, onFoto?: () => void) {
  const { data: produto, error } = await supabase
    .from("produtos")
    .insert({
      oem_code: dados.oem?.trim() || null,
      // o que o vendedor já sabe entra como fato confirmado e guia a identificação
      dados_confirmados: {
        ...(dados.marca?.trim() ? { marca: dados.marca.trim() } : {}),
        ...(dados.oem?.trim() ? { numero_peca: dados.oem.trim() } : {}),
        ...(dados.veiculo?.trim() ? { veiculo: dados.veiculo.trim() } : {}),
      },
    })
    .select("id")
    .single();
  if (error) throw error;
  try {
    if (dados.quantidade > 0) await supabase.from("movimentacoes_estoque").insert({ produto_id: produto.id, delta: dados.quantidade, motivo: "cadastro", origem: "manual" });
    await Promise.all(
      smalls.map(async (small, i) => {
        await saveOriginal(supabase, { userId, produtoId: produto.id, small, ordem: i });
        onFoto?.();
      }),
    );
  } catch (e) {
    // não deixa um produto vazio para trás se nenhuma foto chegou a ser salva
    const { count } = await supabase.from("produto_fotos").select("id", { count: "exact", head: true }).eq("produto_id", produto.id);
    if (!count) await supabase.from("produtos").delete().eq("id", produto.id);
    throw e;
  }
  await supabase.from("produtos").update({ fila_etapa: "identificar", fila_passo: null, fila_erro: null, fila_atualizado_em: new Date().toISOString() }).eq("id", produto.id);
  return produto.id as string;
}

/**
 * Separa fotos em produtos pelo horário em que foram tiradas: quem fotografa uma peça por vez deixa um intervalo
 * entre uma peça e outra. Com `quantos`, corta nos maiores intervalos; sem, corta intervalos maiores que `limiteSeg`.
 */
export function agruparPorHorario(arquivos: File[], quantos: number | null, limiteSeg = 75): File[][] {
  const ordenado = [...arquivos].sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name));
  if (ordenado.length <= 1) return ordenado.length ? [ordenado] : [];
  const intervalos = ordenado.slice(1).map((f, i) => ({ i: i + 1, seg: (f.lastModified - ordenado[i].lastModified) / 1000 }));
  const cortes = new Set(
    quantos && quantos > 1
      ? [...intervalos].sort((a, b) => b.seg - a.seg).slice(0, quantos - 1).map((x) => x.i)
      : intervalos.filter((x) => x.seg > limiteSeg).map((x) => x.i),
  );
  const grupos: File[][] = [[]];
  ordenado.forEach((f, i) => {
    if (cortes.has(i)) grupos.push([]);
    grupos[grupos.length - 1].push(f);
  });
  return grupos;
}
