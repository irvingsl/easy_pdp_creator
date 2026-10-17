"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DadosConfirmados } from "@/domain/dados-confirmados";
import { btnPrimary, inputBase } from "./ui";

type Linha = { nome: string; valor: string; unidade: string };

export function DadosConfirmadosForm({
  produtoId,
  oemCode,
  inicial,
}: {
  produtoId: string;
  oemCode: string | null;
  inicial: DadosConfirmados;
}) {
  const router = useRouter();
  const [marca, setMarca] = useState(inicial.marca ?? "");
  const [numero, setNumero] = useState(inicial.numero_peca ?? oemCode ?? "");
  const [linhas, setLinhas] = useState<Linha[]>(
    (inicial.caracteristicas ?? []).map((c) => ({ nome: c.nome, valor: c.valor, unidade: c.unidade ?? "" })),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const setLinha = (i: number, k: keyof Linha, v: string) =>
    setLinhas((prev) => prev.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  async function salvar() {
    setBusy(true);
    setMsg("");
    const dados: DadosConfirmados = {
      marca: marca.trim() || undefined,
      numero_peca: numero.trim() || undefined,
      caracteristicas: linhas
        .filter((l) => l.nome.trim() && l.valor.trim())
        .map((l) => ({ nome: l.nome.trim(), valor: l.valor.trim(), unidade: l.unidade.trim() || undefined })),
    };
    const { error } = await createClient()
      .from("produtos")
      .update({ dados_confirmados: dados, oem_code: dados.numero_peca ?? null })
      .eq("id", produtoId);
    setBusy(false);
    if (error) setMsg(error.message);
    else {
      setMsg("Salvo ✓");
      router.refresh();
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
      <h2 className="font-medium">Dados confirmados por você</h2>
      <p className="text-xs text-gray-500">
        O que você conferiu com o item na mão. Vale mais que a IA e que a web, e vai como fato nas próximas identificações.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Marca" className={inputBase} />
        <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Número de peça (gravado no item)" className={inputBase} />
      </div>

      <div className="flex flex-col gap-2">
        {linhas.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_5rem_auto] gap-2">
            <input value={l.nome} onChange={(e) => setLinha(i, "nome", e.target.value)} placeholder="Característica (ex.: Estrias)" className={inputBase} />
            <input value={l.valor} onChange={(e) => setLinha(i, "valor", e.target.value)} placeholder="Valor" className={inputBase} />
            <input value={l.unidade} onChange={(e) => setLinha(i, "unidade", e.target.value)} placeholder="un." className={inputBase} />
            <button type="button" aria-label="Remover" onClick={() => setLinhas((p) => p.filter((_, j) => j !== i))} className="rounded-lg border border-gray-300 px-3 dark:border-gray-700">×</button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setLinhas((p) => [...p, { nome: "", valor: "", unidade: "" }])}
          className="self-start rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          + Adicionar característica
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={salvar} disabled={busy} className={btnPrimary}>{busy ? "Salvando..." : "Salvar dados confirmados"}</button>
        {msg && <span className="text-sm text-gray-600 dark:text-gray-400">{msg}</span>}
      </div>
    </section>
  );
}
