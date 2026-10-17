import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKET_ORIGINAIS, BUCKET_PROCESSADAS } from "@/domain/types";
import { browserRemover } from "@/lib/images/remove-background";
import { composeOnWhite } from "@/lib/images/whiten";

export type Step = (label: string) => void;

async function makeWhite(small: Blob, step?: Step): Promise<Blob> {
  step?.("Removendo fundo (a 1ª vez baixa o modelo)");
  const cutout = await browserRemover.remove(small);
  step?.("Recortando e aplicando fundo branco");
  return composeOnWhite(cutout);
}

/** Envia o original, cria o registro e gera a versão com fundo branco. */
export async function addPhoto(
  supabase: SupabaseClient,
  p: { userId: string; produtoId: string; small: Blob; ordem: number; step?: Step },
) {
  const base = `${p.userId}/${p.produtoId}/${crypto.randomUUID()}`;
  const pathOriginal = `${base}.jpg`;
  const up = await supabase.storage.from(BUCKET_ORIGINAIS).upload(pathOriginal, p.small, { contentType: "image/jpeg" });
  if (up.error) throw up.error;

  const { data: foto, error } = await supabase
    .from("produto_fotos")
    .insert({ produto_id: p.produtoId, path_original: pathOriginal, ordem: p.ordem })
    .select("id")
    .single();
  if (error) throw error;

  try {
    const white = await makeWhite(p.small, p.step);
    const pathProcessada = `${base}.jpg`;
    const up2 = await supabase.storage.from(BUCKET_PROCESSADAS).upload(pathProcessada, white, { contentType: "image/jpeg" });
    if (up2.error) throw up2.error;
    await supabase
      .from("produto_fotos")
      .update({ path_processada: pathProcessada, status_processamento: "ok" })
      .eq("id", foto.id);
  } catch (e) {
    await supabase.from("produto_fotos").update({ status_processamento: "erro" }).eq("id", foto.id);
    return { erro: e instanceof Error ? e.message : String(e) };
  }
  return {};
}

/** Refaz o fundo branco a partir do original já salvo. */
export async function reprocessPhoto(
  supabase: SupabaseClient,
  p: { userId: string; produtoId: string; fotoId: string; pathOriginal: string; pathProcessada: string | null; step?: Step },
) {
  const { data: original, error } = await supabase.storage.from(BUCKET_ORIGINAIS).download(p.pathOriginal);
  if (error) throw error;
  const white = await makeWhite(original, p.step);
  const novo = `${p.userId}/${p.produtoId}/${crypto.randomUUID()}.jpg`;
  const up = await supabase.storage.from(BUCKET_PROCESSADAS).upload(novo, white, { contentType: "image/jpeg" });
  if (up.error) throw up.error;
  await supabase
    .from("produto_fotos")
    .update({ path_processada: novo, status_processamento: "ok", manter_original: false })
    .eq("id", p.fotoId);
  if (p.pathProcessada) await supabase.storage.from(BUCKET_PROCESSADAS).remove([p.pathProcessada]);
}

export async function deletePhoto(
  supabase: SupabaseClient,
  p: { fotoId: string; pathOriginal: string; pathProcessada: string | null },
) {
  await supabase.storage.from(BUCKET_ORIGINAIS).remove([p.pathOriginal]);
  if (p.pathProcessada) await supabase.storage.from(BUCKET_PROCESSADAS).remove([p.pathProcessada]);
  const { error } = await supabase.from("produto_fotos").delete().eq("id", p.fotoId);
  if (error) throw error;
}

/**
 * Usa a foto original no anúncio no lugar da versão com fundo branco (quando o recorte estragou a peça).
 * O ML precisa baixar a imagem, então a cópia vai para o bucket público.
 */
export async function keepOriginal(
  supabase: SupabaseClient,
  p: { userId: string; produtoId: string; fotoId: string; pathOriginal: string; pathProcessada: string | null },
) {
  const { data: original, error } = await supabase.storage.from(BUCKET_ORIGINAIS).download(p.pathOriginal);
  if (error) throw error;
  const novo = `${p.userId}/${p.produtoId}/${crypto.randomUUID()}.jpg`;
  const up = await supabase.storage.from(BUCKET_PROCESSADAS).upload(novo, original, { contentType: "image/jpeg" });
  if (up.error) throw up.error;
  await supabase
    .from("produto_fotos")
    .update({ path_processada: novo, status_processamento: "ok", manter_original: true })
    .eq("id", p.fotoId);
  if (p.pathProcessada) await supabase.storage.from(BUCKET_PROCESSADAS).remove([p.pathProcessada]);
}
