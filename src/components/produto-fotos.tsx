"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/images/compress";
import { addPhoto, deletePhoto, keepOriginal, reprocessPhoto } from "@/lib/photos";
import { btnSecondary } from "./ui";

export type FotoView = {
  id: string;
  ordem: number;
  status: "pendente" | "ok" | "erro";
  pathOriginal: string;
  pathProcessada: string | null;
  originalUrl: string | null;
  processadaUrl: string | null;
  manterOriginal: boolean;
};

const STATUS_LABEL = { pendente: "Processando", ok: "Fundo branco pronto", erro: "Falhou" } as const;
const smallBtn =
  "rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800";

export function ProdutoFotos({ produtoId, userId, fotos }: { produtoId: string; userId: string; fotos: FotoView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null); // texto de progresso
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState<{ src: string; label: string } | null>(null);

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoom(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado");
    } finally {
      setBusy(null);
    }
  }

  async function onAdd(list: FileList | null) {
    if (!list?.length) return;
    const files = Array.from(list);
    await run("Enviando", async () => {
      const supabase = createClient();
      let ordem = Math.max(-1, ...fotos.map((f) => f.ordem)) + 1;
      const skipped: string[] = [];
      for (const [i, file] of files.entries()) {
        let small: Blob;
        try {
          small = await compressImage(file);
        } catch (e) {
          skipped.push(e instanceof Error ? e.message : file.name);
          continue;
        }
        await addPhoto(supabase, {
          userId,
          produtoId,
          small,
          ordem: ordem++,
          step: (s) => setBusy(`Foto ${i + 1} de ${files.length}: ${s}...`),
        });
      }
      if (skipped.length) throw new Error(`Não consegui abrir: ${skipped.join("; ")}`);
    });
  }

  const disabled = busy !== null;
  return (
    <section className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "📷 Tirar foto", capture: true },
          { label: "🖼️ Adicionar da galeria", capture: false },
        ].map(({ label, capture }) => (
          <label key={label} className={`${btnSecondary} ${disabled ? "pointer-events-none opacity-50" : ""}`}>
            {label}
            <input
              type="file"
              accept="image/*"
              multiple={!capture}
              {...(capture ? { capture: "environment" as const } : {})}
              className="sr-only"
              onChange={(e) => {
                onAdd(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        ))}
      </div>
      {busy && <p className="text-sm text-gray-500">{busy}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fotos.map((f, i) => (
          <li key={f.id} className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <div className="text-sm font-medium">
              Foto {i + 1} · <span className="font-normal text-gray-500">{STATUS_LABEL[f.status]}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {([["Original", f.originalUrl], [f.manterOriginal ? "No anúncio: original" : "Fundo branco", f.processadaUrl]] as const).map(([label, src]) => (
                <figure key={label} className="flex flex-col gap-1">
                  {src ? (
                    <button type="button" onClick={() => setZoom({ src, label: `${label} · foto ${i + 1}` })} className="cursor-zoom-in">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`${label} ${i + 1}`} className="aspect-square w-full rounded border border-gray-100 object-cover dark:border-gray-800" />
                    </button>
                  ) : (
                    <div className="aspect-square w-full rounded bg-gray-100 dark:bg-gray-900" />
                  )}
                  <figcaption className="text-xs text-gray-500">{label}</figcaption>
                </figure>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {!f.manterOriginal && (
                <button
                  type="button"
                  disabled={disabled}
                  className={smallBtn}
                  onClick={() =>
                    run(`Mantendo a original da foto ${i + 1}`, () =>
                      keepOriginal(createClient(), {
                        userId,
                        produtoId,
                        fotoId: f.id,
                        pathOriginal: f.pathOriginal,
                        pathProcessada: f.pathProcessada,
                      }),
                    )
                  }
                >
                  Manter original
                </button>
              )}
              <button
                type="button"
                disabled={disabled}
                className={smallBtn}
                onClick={() =>
                  run(`Reprocessando foto ${i + 1}`, () =>
                    reprocessPhoto(createClient(), {
                      userId,
                      produtoId,
                      fotoId: f.id,
                      pathOriginal: f.pathOriginal,
                      pathProcessada: f.pathProcessada,
                      step: (s) => setBusy(`Foto ${i + 1}: ${s}...`),
                    }),
                  )
                }
              >
                {f.manterOriginal ? "Voltar ao fundo branco" : "Refazer fundo"}
              </button>
              <button
                type="button"
                disabled={disabled}
                className={`${smallBtn} text-red-700 dark:text-red-400`}
                onClick={() => {
                  if (!confirm(`Excluir a foto ${i + 1}?`)) return;
                  run("Excluindo", () =>
                    deletePhoto(createClient(), { fotoId: f.id, pathOriginal: f.pathOriginal, pathProcessada: f.pathProcessada }),
                  );
                }}
              >
                Excluir foto
              </button>
            </div>
          </li>
        ))}
      </ul>

      {zoom && (
        <div
          role="dialog"
          aria-label={zoom.label}
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 flex cursor-zoom-out flex-col items-center justify-center gap-2 bg-gray-800/90 p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom.src} alt={zoom.label} className="max-h-[85vh] max-w-full rounded bg-white object-contain" />
          <span className="text-sm text-white">{zoom.label} · toque para fechar</span>
        </div>
      )}
    </section>
  );
}
