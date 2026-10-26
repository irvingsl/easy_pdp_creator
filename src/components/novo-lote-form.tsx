"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/images/compress";
import { agruparPorHorario, criarProdutoNaFila } from "@/lib/novo-produto";
import { dispararFila } from "./fila-painel";
import { btnPrimary, btnSecondary, inputBase } from "./ui";

const hora = (f: File) => new Date(f.lastModified).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Várias fotos de vários produtos de uma vez: separa por horário, o vendedor confere e cria todos na fila. */
export function NovoLoteForm() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [quantos, setQuantos] = useState("");
  const [qtd, setQtd] = useState("1");
  const [grupos, setGrupos] = useState<File[][]>([]);
  const [progresso, setProgresso] = useState("");
  const [error, setError] = useState("");

  const [aviso, setAviso] = useState("");
  const [lendo, setLendo] = useState(false);

  // Miniaturas pequenas (200 px), geradas uma de cada vez: abrir 14 fotos de 12 MP ao mesmo tempo estoura a memória do celular
  const [thumbs, setThumbs] = useState<Map<File, string>>(new Map());
  const feitas = useRef(new Set<File>()); // fotos que já tiveram miniatura (ou falharam)
  const urlsCriadas = useRef<string[]>([]);
  useEffect(() => {
    let cancelado = false;
    (async () => {
      for (const f of files) {
        if (cancelado) return;
        if (feitas.current.has(f)) continue;
        feitas.current.add(f);
        try {
          const bmp = await createImageBitmap(f, { resizeWidth: 200, resizeQuality: "low", imageOrientation: "from-image" });
          const c = document.createElement("canvas");
          c.width = bmp.width;
          c.height = bmp.height;
          c.getContext("2d")!.drawImage(bmp, 0, 0);
          bmp.close();
          const url = await new Promise<string>((ok, no) => c.toBlob((b) => (b ? ok(URL.createObjectURL(b)) : no(new Error("miniatura"))), "image/jpeg", 0.7));
          urlsCriadas.current.push(url);
          setThumbs((m) => new Map(m).set(f, url));
        } catch {
          setThumbs((m) => new Map(m).set(f, ""));
        }
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [files]);
  useEffect(() => {
    const urls = urlsCriadas.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  /** Lê cada foto para a memória logo ao escolher: arquivos da galeria do Android podem ficar ilegíveis depois. */
  async function escolher(list: FileList | null) {
    if (!list?.length) return;
    const novas = Array.from(list);
    setLendo(true);
    try {
      const lidas: File[] = [];
      for (const f of novas) lidas.push(new File([await f.arrayBuffer()], f.name, { type: f.type || "image/jpeg", lastModified: f.lastModified }));
      const todas = [...files, ...lidas];
      setFiles(todas);
      const r = agruparPorHorario(todas, Number(quantos) || null);
      setGrupos(r.grupos);
      setAviso(r.aviso ?? "");
    } finally {
      setLendo(false);
    }
  }

  function separar() {
    const r = agruparPorHorario(files, Number(quantos) || null);
    setGrupos(r.grupos);
    setAviso(r.aviso ?? "");
  }

  /** Move uma foto para outro produto ("novo" cria um produto; "remover" tira a foto). */
  function mover(de: number, f: File, para: string) {
    const sem = grupos.map((g, i) => (i === de ? g.filter((x) => x !== f) : g));
    if (para === "remover") setFiles((fs) => fs.filter((x) => x !== f));
    else if (para === "novo") sem.push([f]);
    else sem[Number(para)] = [...sem[Number(para)], f].sort((a, b) => a.lastModified - b.lastModified);
    setGrupos(sem.filter((g) => g.length));
  }

  async function criar() {
    setError("");
    const supabase = createClient();
    const erros: string[] = [];
    let criados = 0;
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user!.id;
      // quem está cadastrando tem ao menos 1 em mãos: vazio ou 0 vira 1
      const quantidade = Math.max(1, Math.floor(Number(qtd) || 0));
      for (const [i, grupo] of grupos.entries()) {
        setProgresso(`Produto ${i + 1} de ${grupos.length}: reduzindo as fotos…`);
        const smalls: Blob[] = [];
        for (const f of grupo) {
          try {
            smalls.push(await compressImage(f).catch(async () => {
              await new Promise((ok) => setTimeout(ok, 400)); // uma segunda tentativa, com a memória já liberada
              return compressImage(f);
            }));
          } catch (e) {
            erros.push(e instanceof Error ? e.message : f.name);
          }
        }
        if (!smalls.length) continue;
        setProgresso(`Produto ${i + 1} de ${grupos.length}: enviando ${smalls.length} foto(s)…`);
        try {
          await criarProdutoNaFila(supabase, userId, smalls, { quantidade });
          criados += 1;
        } catch (e) {
          erros.push(`Produto ${i + 1}: ${e instanceof Error ? e.message : "falhou"}`);
        }
      }
      if (criados) await dispararFila(2);
      if (erros.length) alert(`${criados} produto(s) criado(s). Problemas: ${erros.join("; ")}`);
      if (criados) {
        setProgresso("Pronto! Abrindo a lista…"); // mantém o botão desativado até a página mudar
        router.push("/produtos");
        router.refresh();
        return;
      } else {
        setError(erros.join("; ") || "Nenhum produto foi criado.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado");
    }
    setProgresso("");
  }

  const busy = !!progresso || lendo;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-500">
        Escolha todas as fotos de uma vez (de vários produtos). O app separa pelo horário em que foram tiradas; você confere e ajusta antes de criar.
      </p>
      <label className={`${btnSecondary} ${busy ? "pointer-events-none opacity-50" : ""}`}>
        {lendo ? "Lendo as fotos…" : "🖼️ Escolher fotos da galeria"}
        <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { const l = e.target.files; void escolher(l); e.target.value = ""; }} />
      </label>

      {files.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Quantos produtos são? <span className="text-xs text-gray-500">(opcional, ajuda a separar)</span>
              <input value={quantos} onChange={(e) => setQuantos(e.target.value.replace(/\D/g, ""))} inputMode="numeric" disabled={busy} className={inputBase} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Estoque de cada um (vazio = 1)
              <input value={qtd} onChange={(e) => setQtd(e.target.value.replace(/\D/g, ""))} inputMode="numeric" disabled={busy} className={inputBase} />
            </label>
          </div>
          <button type="button" onClick={separar} disabled={busy} className={btnSecondary}>Separar de novo (use depois de mudar “quantos produtos”)</button>
          {aviso && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{aviso}</p>}

          <ul className="flex flex-col gap-3">
            {grupos.map((g, gi) => (
              <li key={gi} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                <div className="mb-2 text-sm font-medium">Produto {gi + 1} · {g.length} foto(s)</div>
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {g.map((f) => (
                    <li key={`${f.name}-${f.lastModified}-${f.size}`} className="flex flex-col gap-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {thumbs.get(f) ? <img src={thumbs.get(f)} alt="" className="aspect-square w-full rounded-lg object-cover" /> : <div className="aspect-square w-full rounded-lg bg-gray-200 dark:bg-gray-800" />}
                      <span className="text-center text-[10px] text-gray-500">{hora(f)}</span>
                      <select disabled={busy} value="" onChange={(e) => e.target.value && mover(gi, f, e.target.value)} className="rounded border border-gray-300 bg-white p-1 text-xs dark:border-gray-700 dark:bg-gray-900">
                        <option value="">Mover…</option>
                        {grupos.map((_, i) => i !== gi && <option key={i} value={i}>Produto {i + 1}</option>)}
                        <option value="novo">Novo produto</option>
                        <option value="remover">Remover foto</option>
                      </select>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          <button type="button" onClick={criar} disabled={busy || !grupos.length} className={btnPrimary}>
            {busy ? progresso : `Criar ${grupos.length} produto${grupos.length > 1 ? "s" : ""} e colocar na fila`}
          </button>
        </>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
