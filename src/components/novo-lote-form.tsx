"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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

  const urls = useMemo(() => new Map(files.map((f) => [f, URL.createObjectURL(f)])), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  function escolher(list: FileList | null) {
    if (!list?.length) return;
    const todas = [...files, ...Array.from(list)];
    setFiles(todas);
    setGrupos(agruparPorHorario(todas, Number(quantos) || null));
  }

  function separar() {
    setGrupos(agruparPorHorario(files, Number(quantos) || null));
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
            smalls.push(await compressImage(f));
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
        router.push("/produtos");
        router.refresh();
      } else {
        setError(erros.join("; ") || "Nenhum produto foi criado.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado");
    } finally {
      setProgresso("");
    }
  }

  const busy = !!progresso;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-500">
        Escolha todas as fotos de uma vez (de vários produtos). O app separa pelo horário em que foram tiradas; você confere e ajusta antes de criar.
      </p>
      <label className={`${btnSecondary} ${busy ? "pointer-events-none opacity-50" : ""}`}>
        🖼️ Escolher fotos da galeria
        <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { escolher(e.target.files); e.target.value = ""; }} />
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
          <button type="button" onClick={separar} disabled={busy} className={btnSecondary}>Separar de novo por horário</button>

          <ul className="flex flex-col gap-3">
            {grupos.map((g, gi) => (
              <li key={gi} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                <div className="mb-2 text-sm font-medium">Produto {gi + 1} · {g.length} foto(s)</div>
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {g.map((f) => (
                    <li key={`${f.name}-${f.lastModified}-${f.size}`} className="flex flex-col gap-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={urls.get(f)} alt="" className="aspect-square w-full rounded-lg object-cover" />
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
