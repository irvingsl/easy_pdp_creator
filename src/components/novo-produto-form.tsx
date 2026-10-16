"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/images/compress";
import { browserRemover } from "@/lib/images/remove-background";
import { composeOnWhite } from "@/lib/images/whiten";
import { BUCKET_ORIGINAIS, BUCKET_PROCESSADAS } from "@/domain/types";

type Progress = { done: number; total: number; step: string };

export function NovoProdutoForm() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [oem, setOem] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!files.length) return;
    setError("");
    const supabase = createClient();
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user!.id;

      const { data: produto, error: pErr } = await supabase
        .from("produtos")
        .insert({ oem_code: oem.trim() || null })
        .select("id")
        .single();
      if (pErr) throw pErr;

      for (const [i, file] of files.entries()) {
        const base = `${userId}/${produto.id}/${crypto.randomUUID()}`;
        const step = (s: string) => setProgress({ done: i, total: files.length, step: s });

        step("Reduzindo foto");
        const small = await compressImage(file);
        const pathOriginal = `${base}.jpg`;
        const up1 = await supabase.storage.from(BUCKET_ORIGINAIS).upload(pathOriginal, small, { contentType: "image/jpeg" });
        if (up1.error) throw up1.error;

        const { data: foto, error: fErr } = await supabase
          .from("produto_fotos")
          .insert({ produto_id: produto.id, path_original: pathOriginal, ordem: i })
          .select("id")
          .single();
        if (fErr) throw fErr;

        try {
          step("Removendo fundo (1ª vez baixa o modelo)");
          const cutout = await browserRemover.remove(small);
          step("Fundo branco");
          const white = await composeOnWhite(cutout);
          const pathProcessada = `${base}.jpg`;
          const up2 = await supabase.storage.from(BUCKET_PROCESSADAS).upload(pathProcessada, white, { contentType: "image/jpeg" });
          if (up2.error) throw up2.error;
          await supabase
            .from("produto_fotos")
            .update({ path_processada: pathProcessada, status_processamento: "ok" })
            .eq("id", foto.id);
        } catch {
          await supabase.from("produto_fotos").update({ status_processamento: "erro" }).eq("id", foto.id);
        }
      }
      router.push("/produtos");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
      setProgress(null);
    }
  }

  const busy = progress !== null;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm">Fotos (câmera ou galeria)</span>
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
        <span className="text-xs text-gray-500">Dica: inclua o número gravado na peça, se tiver.</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm">Código OEM / fabricante (opcional)</span>
        <input
          value={oem}
          onChange={(e) => setOem(e.target.value)}
          disabled={busy}
          className="rounded border border-gray-300 bg-transparent p-3"
        />
      </label>
      <button
        disabled={busy || !files.length}
        className="rounded bg-gray-900 p-3 text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
      >
        {busy ? `Foto ${progress!.done + 1}/${progress!.total}: ${progress!.step}...` : `Salvar ${files.length || ""} foto(s)`}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
