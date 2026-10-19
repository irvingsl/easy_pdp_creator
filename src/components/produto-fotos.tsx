"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/images/compress";
import { deletePhoto, keepOriginal, makeMain, processPending, reprocessPhoto, saveOriginal } from "@/lib/photos";
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

export function ProdutoFotos({ produtoId, userId, fotos, sensibilidadeInicial = 50, fotoBuscaInicial = null }: { produtoId: string; userId: string; fotos: FotoView[]; sensibilidadeInicial?: number; fotoBuscaInicial?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null); // texto de progresso
  const [error, setError] = useState("");
  // Sensibilidade do recorte: guardada na conta (vale para todos os produtos e aparelhos)
  const [sens, setSens] = useState(sensibilidadeInicial);
  const [sensMsg, setSensMsg] = useState("");
  const sensRef = useRef(sensibilidadeInicial);
  async function salvarSens(v: number) {
    sensRef.current = v;
    const { error } = await createClient().auth.updateUser({ data: { limiar_fundo: v } });
    setSensMsg(error ? "Não consegui salvar na conta" : "Salvo na sua conta ✓");
  }
  // Foto que o vendedor escolheu para a busca por imagem (vale para a próxima identificação)
  const [fotoBusca, setFotoBusca] = useState<string | null>(fotoBuscaInicial);
  async function escolherFotoBusca(id: string) {
    const supabase = createClient();
    const { data } = await supabase.from("produtos").select("dados_confirmados").eq("id", produtoId).maybeSingle();
    const { error } = await supabase.from("produtos").update({ dados_confirmados: { ...((data?.dados_confirmados as object) ?? {}), foto_busca: id } }).eq("id", produtoId);
    if (error) return setError(error.message);
    setFotoBusca(id);
  }

  // teste forçado da busca por imagem (SerpApi) numa foto
  const [lensTxt, setLensTxt] = useState<Record<string, string>>({});
  async function testarLens(id: string) {
    setLensTxt((p) => ({ ...p, [id]: "Consultando a busca por imagem… (pode levar até ~50 s)" }));
    try {
      const res = await fetch("/api/lens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fotoId: id }) });
      const t = await res.text();
      let out = t;
      try {
        out = JSON.stringify(JSON.parse(t), null, 2);
      } catch {
        out = res.status === 504 ? "Demorou demais (504)." : `Resposta inesperada (${res.status}): ${t.slice(0, 300)}`;
      }
      setLensTxt((p) => ({ ...p, [id]: out }));
    } catch (e) {
      setLensTxt((p) => ({ ...p, [id]: e instanceof Error ? e.message : "falha" }));
    }
  }
  const [zoom, setZoom] = useState<{ src: string; label: string } | null>(null);

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoom(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  // Remove o fundo das fotos pendentes, uma de cada vez, assim que a página abre (ou quando entram fotos novas).
  // Se o vendedor sair antes de terminar, o resto continua na próxima visita.
  const processando = useRef(false);
  const pendentesKey = fotos.filter((f) => f.status === "pendente").map((f) => f.id).join(",");
  useEffect(() => {
    if (!pendentesKey || processando.current) return;
    processando.current = true;
    const ids = pendentesKey.split(",");
    (async () => {
      const supabase = createClient();
      const erros: string[] = [];
      try {
        for (const [i, id] of ids.entries()) {
          const f = fotos.find((x) => x.id === id);
          if (!f) continue;
          setBusy(`Removendo o fundo da foto ${i + 1} de ${ids.length}...`);
          const r = await processPending(supabase, { userId, produtoId, fotoId: f.id, pathOriginal: f.pathOriginal, step: (s: string) => setBusy(`Foto ${i + 1} de ${ids.length}: ${s}...`), sensibilidade: sensRef.current });
          if (r.erro) erros.push(`foto ${i + 1}: ${r.erro}`);
          router.refresh();
        }
      } finally {
        processando.current = false;
        setBusy(null);
        if (erros.length) setError(`Não consegui remover o fundo de ${erros.length} foto(s) (${erros.join("; ")}). Use "Refazer fundo".`);
        router.refresh();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendentesKey]);

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
        // só salva o original: a remoção do fundo roda sozinha logo depois (efeito abaixo)
        setBusy(`Foto ${i + 1} de ${files.length}: enviando...`);
        await saveOriginal(supabase, { userId, produtoId, small, ordem: ordem++ });
      }
      if (skipped.length) throw new Error(`Não consegui abrir: ${skipped.join("; ")}`);
    });
  }

  const disabled = busy !== null;
  // A principal é a primeira com versão processada; o ML exige fundo branco nela, então só vale "fundo branco" (não a original)
  const elegivel = (f: FotoView) => f.status === "ok" && !!f.processadaUrl && !f.manterOriginal;
  // pode ser principal qualquer foto com imagem pronta; com a original, o ML recomenda fundo branco (aviso)
  const podeSerPrincipal = (f: FotoView) => f.status === "ok" && !!f.processadaUrl;
  const principal = fotos.find((f) => f.processadaUrl);
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
      <div className="flex flex-col gap-1 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-800">
        <label htmlFor="sens" className="font-medium">
          Sensibilidade do recorte: {sens} {sens === 50 ? "(padrão)" : ""}
        </label>
        <input
          id="sens"
          type="range"
          min={0}
          max={100}
          step={5}
          value={sens}
          onChange={(e) => {
            setSens(Number(e.target.value));
            setSensMsg("");
          }}
          onPointerUp={() => salvarSens(sens)}
          onKeyUp={() => salvarSens(sens)}
          onBlur={() => sensRef.current !== sens && salvarSens(sens)}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>Remove mais fundo</span>
          <span>Mantém mais da peça</span>
        </div>
        <p className="text-xs text-gray-500">
          Se o recorte comeu partes finas (prisioneiros, bordas), aumente: acima de 50 o app também recupera o que tem cor diferente do fundo, perto da peça. Se sobrou fundo, diminua. Vale para as próximas fotos e para o botão Refazer fundo de cada uma. {sensMsg}
        </p>
      </div>
      {principal && !elegivel(principal) && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          A foto principal está com o fundo original. O Mercado Livre recomenda fundo branco na primeira foto: a escolha é sua, mas o anúncio pode perder qualidade na busca. Para trocar, use Tornar principal em outra foto ou Voltar ao fundo branco.
        </p>
      )}
      {busy && <p className="text-sm text-gray-500">{busy}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fotos.map((f, i) =>
          f.status === "pendente" ? (
            // Enquanto o fundo não foi removido, só o original (sem comparação nem botões)
            <li key={f.id} className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
              <div className="text-sm font-medium">
                Foto {i + 1} · <span className="font-normal text-gray-500">{STATUS_LABEL.pendente}</span>
              </div>
              <div className="relative">
                {f.originalUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.originalUrl} alt={`Original ${i + 1}`} className="aspect-square w-full rounded border border-gray-100 object-cover opacity-80 dark:border-gray-800" />
                ) : (
                  <div className="aspect-square w-full rounded bg-gray-100 dark:bg-gray-900" />
                )}
                <span className="absolute inset-x-2 bottom-2 rounded bg-black/70 px-2 py-1 text-center text-xs text-white">Removendo o fundo…</span>
              </div>
            </li>
          ) : (
          <li key={f.id} className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <div className="text-sm font-medium">
              Foto {i + 1} · <span className="font-normal text-gray-500">{STATUS_LABEL[f.status]}</span>
              {principal?.id === f.id && <span className="ml-2 rounded bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">Principal</span>}
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
              {principal?.id !== f.id && podeSerPrincipal(f) && (
                <button
                  type="button"
                  disabled={disabled}
                  className={smallBtn}
                  onClick={() => {
                    if (!elegivel(f) && !window.confirm("Esta foto está com o fundo original. O Mercado Livre recomenda fundo branco na foto principal; o anúncio pode perder qualidade na busca. Usar mesmo assim?")) return;
                    run("Definindo a principal", () => makeMain(createClient(), { fotoId: f.id, ordemAtual: fotos.map((x) => ({ id: x.id, ordem: x.ordem })) }));
                  }}
                >
                  Tornar principal
                </button>
              )}
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
                      sensibilidade: sensRef.current,
                      step: (s) => setBusy(`Foto ${i + 1}: ${s}...`),
                    }),
                  )
                }
              >
                {f.manterOriginal ? "Voltar ao fundo branco" : "Refazer fundo"}
              </button>
              <button type="button" className={smallBtn} onClick={() => escolherFotoBusca(f.id)} disabled={fotoBusca === f.id}>
                {fotoBusca === f.id ? "✓ Foto da busca por imagem" : "Usar na busca por imagem"}
              </button>
              {f.originalUrl && (
                // abre o Google Lens no navegador do vendedor (conexão e sessão dele): gratuito e sem raspagem
                <a
                  className={smallBtn}
                  href={`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(f.originalUrl)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Buscar no Google Lens
                </a>
              )}
              <button type="button" className={smallBtn} onClick={() => testarLens(f.id)}>
                Testar busca por imagem (SerpApi)
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
            {lensTxt[f.id] && <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs dark:bg-gray-900">{lensTxt[f.id]}</pre>}
          </li>
          ),
        )}
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
