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

/** Ordem natural pelo nome (IMG_9 antes de IMG_10): a câmera numera em sequência. */
const porNome = (a: File, b: File) => a.name.localeCompare(b.name, undefined, { numeric: true });

/**
 * Separa fotos em produtos. Quem fotografa uma peça por vez deixa um intervalo de tempo entre uma peça e outra; mas há celulares/galerias
 * que não guardam a hora da foto direito (todas parecem do mesmo instante). Por isso:
 *  - com `quantos`: corta nos maiores intervalos SE eles se destacam dos demais; senão divide em partes iguais pela ordem do nome;
 *  - sem `quantos`: corta nos intervalos maiores que `limiteSeg`.
 */
export function agruparPorHorario(arquivos: File[], quantos: number | null, limiteSeg = 75): { grupos: File[][]; aviso?: string } {
  const ordenado = [...arquivos].sort((a, b) => a.lastModified - b.lastModified || porNome(a, b));
  if (ordenado.length <= 1) return { grupos: ordenado.length ? [ordenado] : [] };
  const intervalos = ordenado.slice(1).map((f, i) => ({ i: i + 1, seg: (f.lastModified - ordenado[i].lastModified) / 1000 }));
  const cortar = (cortes: Set<number>) => {
    const grupos: File[][] = [[]];
    ordenado.forEach((f, i) => {
      if (cortes.has(i)) grupos.push([]);
      grupos[grupos.length - 1].push(f);
    });
    return grupos;
  };
  if (quantos && quantos > 1) {
    const q = Math.min(quantos, ordenado.length);
    const desc = [...intervalos].sort((a, b) => b.seg - a.seg);
    const escolhidos = desc.slice(0, q - 1);
    const resto = desc.slice(q - 1);
    const menorEscolhido = escolhidos[escolhidos.length - 1]?.seg ?? 0;
    const maiorResto = resto[0]?.seg ?? 0;
    // os cortes "se destacam" quando o menor deles é bem maior que o maior intervalo que ficou dentro de um produto
    if (menorEscolhido > 0 && menorEscolhido >= Math.max(maiorResto * 2, 1)) return { grupos: cortar(new Set(escolhidos.map((x) => x.i))) };
    // horários sem diferença confiável: divide em partes iguais, na ordem do nome do arquivo
    const porOrdem = [...arquivos].sort(porNome);
    const base = Math.floor(porOrdem.length / q);
    const extra = porOrdem.length % q;
    const grupos: File[][] = [];
    let pos = 0;
    for (let g = 0; g < q; g++) {
      const n = base + (g < extra ? 1 : 0);
      grupos.push(porOrdem.slice(pos, pos + n));
      pos += n;
    }
    return { grupos, aviso: `Os horários das fotos não permitem separar com segurança: dividi em ${q} produtos de ${base}${extra ? " ou " + (base + 1) : ""} foto(s), pela ordem dos arquivos. Ajuste abaixo se algum ficou errado.` };
  }
  return { grupos: cortar(new Set(intervalos.filter((x) => x.seg > limiteSeg).map((x) => x.i))) };
}
