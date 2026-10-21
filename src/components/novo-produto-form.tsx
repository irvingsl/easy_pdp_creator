"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/images/compress";
import { criarProdutoNaFila } from "@/lib/novo-produto";
import { dispararFila } from "./fila-painel";
import { btnPrimary, btnSecondary, inputBase } from "./ui";

type Progress = { done: number; total: number; step: string };

export function NovoProdutoForm() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [oem, setOem] = useState("");
  const [marca, setMarca] = useState("");
  const [veiculo, setVeiculo] = useState("");
  const [qtd, setQtd] = useState("1");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  function addFiles(list: FileList | null) {
    if (list?.length) setFiles((prev) => [...prev, ...Array.from(list)]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!files.length) return;
    setError("");
    setNotice("");
    const supabase = createClient();
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user!.id;

      // Valida/reduz todas as fotos antes de criar qualquer registro; foto ruim é ignorada
      const smalls: Blob[] = [];
      const skipped: string[] = [];
      for (const [i, file] of files.entries()) {
        setProgress({ done: i, total: files.length, step: "Reduzindo foto" });
        try {
          smalls.push(await compressImage(file));
        } catch (err) {
          skipped.push(err instanceof Error ? err.message : file.name);
        }
      }
      if (!smalls.length) throw new Error("Nenhuma das fotos pôde ser aberta. Use JPG, PNG, WebP ou HEIC.");

      const quantidade = Math.max(0, Math.floor(Number(qtd) || 0));
      setProgress({ done: 0, total: smalls.length, step: "Enviando fotos" });
      let enviadas = 0;
      // salva os originais, cria o produto e o põe na fila: o servidor identifica e monta o rascunho sozinho, mesmo com o app fechado
      await criarProdutoNaFila(supabase, userId, smalls, { oem, marca, veiculo, quantidade }, () => {
        enviadas += 1;
        setProgress({ done: enviadas, total: smalls.length, step: "Enviando fotos" });
      });
      await dispararFila(2);
      if (skipped.length) alert(`Não consegui abrir: ${skipped.join("; ")}`);
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

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">O que você já sabe <span className="font-normal text-gray-500">(opcional, ajuda a IA)</span></h2>
        <label className="flex flex-col gap-1 text-sm">
          Código gravado na peça / fabricante
          <input value={oem} onChange={(e) => setOem(e.target.value)} disabled={busy} className={inputBase} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Marca
            <input value={marca} onChange={(e) => setMarca(e.target.value)} disabled={busy} className={inputBase} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Quantidade em estoque
            <input value={qtd} onChange={(e) => setQtd(e.target.value.replace(/\D/g, ""))} inputMode="numeric" disabled={busy} className={inputBase} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          Veículo / aplicação
          <input value={veiculo} onChange={(e) => setVeiculo(e.target.value)} disabled={busy} className={inputBase} />
        </label>
      </section>

      <button disabled={busy || !files.length} className={btnPrimary}>
        {busy
          ? progress!.step === "Enviando fotos"
            ? `Enviando fotos: ${progress!.done} de ${progress!.total}...`
            : `Foto ${Math.min(progress!.done + 1, progress!.total)} de ${progress!.total}: ${progress!.step}...`
          : files.length
            ? `Seguir com ${files.length} foto${files.length > 1 ? "s" : ""}`
            : "Escolha ao menos uma foto"}
      </button>
      {notice && (
        <p className="text-sm text-amber-700">
          {notice} <Link href="/produtos" className="underline">Ver produtos</Link>
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
