"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/images/compress";
import { browserRemover } from "@/lib/images/remove-background";
import { composeOnWhite } from "@/lib/images/whiten";
import { BUCKET_ORIGINAIS, BUCKET_PROCESSADAS } from "@/domain/types";
import { btnPrimary, btnSecondary, inputBase } from "./ui";

type Progress = { done: number; total: number; step: string };

export function NovoProdutoForm() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [oem, setOem] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  function addFiles(list: FileList | null) {
    if (list?.length) setFiles((prev) => [...prev, ...Array.from(list)]);
  }

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
          step("Removendo fundo (a 1ª vez baixa o modelo)");
          const cutout = await browserRemover.remove(small);
          step("Aplicando fundo branco");
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
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Fotos da peça</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className={`${btnSecondary} ${busy ? "pointer-events-none opacity-50" : ""}`}>
            📷 Tirar foto
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <label className={`${btnSecondary} ${busy ? "pointer-events-none opacity-50" : ""}`}>
            🖼️ Escolher da galeria
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <p className="text-sm text-gray-500">Dica: inclua o número gravado na peça, se tiver.</p>

        {previews.length > 0 && (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {previews.map((src, i) => (
              <li key={src} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Foto ${i + 1}`} className="aspect-square w-full rounded-lg object-cover" />
                {!busy && (
                  <button
                    type="button"
                    aria-label={`Remover foto ${i + 1}`}
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <label className="flex flex-col gap-1">
        <span className="font-medium">Código OEM / fabricante <span className="font-normal text-gray-500">(opcional)</span></span>
        <input value={oem} onChange={(e) => setOem(e.target.value)} disabled={busy} className={inputBase} />
      </label>

      <button disabled={busy || !files.length} className={btnPrimary}>
        {busy
          ? `Foto ${progress!.done + 1} de ${progress!.total}: ${progress!.step}...`
          : files.length
            ? `Salvar ${files.length} foto${files.length > 1 ? "s" : ""}`
            : "Escolha ao menos uma foto"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
