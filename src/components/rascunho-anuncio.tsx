"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TITULO_MAX, type Rascunho } from "@/domain/rascunho";
import { CopyBlock } from "./copy-block";
import { btnPrimary, btnSecondary, inputBase } from "./ui";

const ORIGEM: Record<string, string> = {
  confirmado: "confirmado por você",
  lido_no_item: "lido no item",
  contado_na_foto: "contado na foto",
  web: "da web, sem confirmação",
  sugerido_web: "sugestão da web, confirme",
};

export function RascunhoAnuncio({ produtoId, inicial }: { produtoId: string; inicial: Rascunho | null }) {
  const router = useRouter();
  const [r, setR] = useState<Rascunho | null>(inicial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function gerar() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/rascunho", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ produtoId }) });
      const txt = await res.text();
      let j: { rascunho?: Rascunho; error?: string } = {};
      try {
        j = JSON.parse(txt);
      } catch {
        setMsg(res.status === 504 ? "A geração demorou demais, tente de novo." : `Resposta inesperada do servidor (${res.status}).`);
        return;
      }
      if (j.rascunho) setR(j.rascunho);
      else setMsg(j.error ?? "Falha ao gerar o rascunho");
    } finally {
      setBusy(false);
    }
  }

  async function salvar() {
    if (!r) return;
    setBusy(true);
    const { error } = await createClient().from("produtos").update({ rascunho: r, titulo_base: r.titulo, descricao_base: r.descricao }).eq("id", produtoId);
    setBusy(false);
    setMsg(error ? error.message : "Salvo ✓");
    if (!error) router.refresh();
  }

  const [ml, setMl] = useState<{ categorias?: { id: string; nome: string; caminho: string }[]; status?: number; resposta?: unknown; obrigatorios?: { id: string; nome: string; enviado: boolean }[]; payload?: unknown; error?: string } | null>(null);

  async function chamarML(sugerir: boolean) {
    if (!r) return;
    setBusy(true);
    setMl(null);
    try {
      // o servidor lê o rascunho salvo: salva antes de validar
      const { error } = await createClient().from("produtos").update({ rascunho: r, titulo_base: r.titulo, descricao_base: r.descricao }).eq("id", produtoId);
      if (error) return setMl({ error: error.message });
      const res = await fetch("/api/anuncios/validar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ produtoId, sugerir }) });
      const txt = await res.text();
      try {
        setMl(JSON.parse(txt));
      } catch {
        setMl({ error: res.status === 504 ? "O Mercado Livre demorou demais, tente de novo." : `Resposta inesperada (${res.status})` });
      }
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setR((p) => (p ? { ...p, [k]: v } : p));

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
      <h2 className="font-medium">Rascunho do anúncio</h2>
      <p className="text-xs text-gray-500">
        Texto original gerado só com os fatos do produto. Revise tudo: nada é publicado daqui.
      </p>
      <button type="button" onClick={gerar} disabled={busy} className={r ? btnSecondary : btnPrimary}>
        {busy ? "Trabalhando…" : r ? "Gerar de novo" : "Gerar rascunho"}
      </button>
      {msg && <p className="text-sm text-gray-600 dark:text-gray-400">{msg}</p>}

      {r && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span>
              Título <span className={r.titulo.length > TITULO_MAX ? "text-red-600" : "text-gray-500"}>({r.titulo.length}/{TITULO_MAX})</span>
            </span>
            <input className={inputBase} value={r.titulo} maxLength={TITULO_MAX} onChange={(e) => set("titulo", e.target.value)} />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Descrição
            <textarea className={inputBase} rows={12} value={r.descricao} onChange={(e) => set("descricao", e.target.value)} />
          </label>

          <div className="flex flex-col gap-2 text-sm">
            <span className="font-medium">Atributos</span>
            {r.atributos.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-2/5 text-gray-600 dark:text-gray-400">{a.nome}</span>
                <input
                  className={inputBase}
                  value={a.valor}
                  onChange={(e) => set("atributos", r.atributos.map((x, j) => (j === i ? { ...x, valor: e.target.value, origem: "confirmado" } : x)))}
                />
                <span className="w-24 shrink-0 text-xs text-gray-500">{ORIGEM[a.origem] ?? a.origem}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <span className="font-medium">Compatibilidade ({r.compatibilidade.length})</span>
            {r.compatibilidade.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="flex-1">{c.veiculo}{c.anos ? ` ${c.anos}` : ""}</span>
                <span className="text-xs text-gray-500">{ORIGEM[c.origem] ?? c.origem}</span>
                {c.origem !== "confirmado" && (
                  <button type="button" className="text-xs text-indigo-600 underline" onClick={() => set("compatibilidade", r.compatibilidade.map((x, j) => (j === i ? { ...x, origem: "confirmado" } : x)))}>
                    confirmar
                  </button>
                )}
                <button type="button" className="text-xs text-red-600 underline" onClick={() => set("compatibilidade", r.compatibilidade.filter((_, j) => j !== i))}>
                  remover
                </button>
              </div>
            ))}
          </div>

          <label className="flex flex-col gap-1 text-sm">
            Preço (R$){r.preco_faixa && <span className="text-xs text-gray-500">faixa vista na web: {r.preco_faixa.minimo} a {r.preco_faixa.maximo}</span>}
            <input className={inputBase} inputMode="decimal" value={r.preco ?? ""} onChange={(e) => set("preco", e.target.value ? Number(e.target.value.replace(",", ".")) || null : null)} />
          </label>

          <div className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-800">
            <span className="font-medium">Mercado Livre</span>
            <div className="flex gap-2">
              <input className={inputBase} placeholder="Categoria (ex.: MLB194761)" value={r.categoria_id ?? ""} onChange={(e) => set("categoria_id", e.target.value.trim() || undefined)} />
              <button type="button" className={btnSecondary} disabled={busy} onClick={() => chamarML(true)}>Sugerir</button>
            </div>
            {ml?.categorias?.map((c) => (
              <button key={c.id} type="button" className="text-left text-xs text-indigo-600 underline" onClick={() => { set("categoria_id", c.id); setMl(null); }}>
                {c.id} · {c.caminho}
              </button>
            ))}
            <select className={inputBase} value={r.condicao ?? "used"} onChange={(e) => set("condicao", e.target.value as "new" | "used")}>
              <option value="used">Condição: usado</option>
              <option value="new">Condição: novo</option>
            </select>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(["altura", "largura", "comprimento", "peso"] as const).map((k) => (
                <input
                  key={k}
                  className={inputBase}
                  inputMode="decimal"
                  placeholder={k === "peso" ? "Peso embalado (g)" : `${k[0].toUpperCase()}${k.slice(1)} (cm)`}
                  value={r.embalagem?.[k] ?? ""}
                  onChange={(e) => set("embalagem", { altura: "", largura: "", comprimento: "", peso: "", ...r.embalagem, [k]: e.target.value })}
                />
              ))}
            </div>
            <button type="button" className={btnSecondary} disabled={busy} onClick={() => chamarML(false)}>Validar no Mercado Livre (não publica)</button>
            {ml?.error && <p className="text-red-600">{ml.error}</p>}
            {ml?.status !== undefined && (
              <div className="flex flex-col gap-2">
                <p>{ml.status === 200 || ml.status === 201 ? "✓ O ML aceitou o anúncio" : `O ML apontou problemas (HTTP ${ml.status})`}</p>
                {ml.obrigatorios?.some((o) => !o.enviado) && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">Obrigatórios ainda não preenchidos: {ml.obrigatorios.filter((o) => !o.enviado).map((o) => o.nome).join(", ")}</p>
                )}
                <CopyBlock text={`HTTP ${ml.status}\n${JSON.stringify(ml.resposta, null, 2)}\n\nDados enviados:\n${JSON.stringify(ml.payload, null, 2)}`} label="Copiar resposta e dados" />
              </div>
            )}
          </div>

          {r.avisos.length > 0 && (
            <ul className="list-disc rounded-lg bg-amber-50 p-3 pl-7 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {r.avisos.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}

          <button type="button" onClick={salvar} disabled={busy} className={btnPrimary}>Salvar rascunho</button>
        </>
      )}
    </section>
  );
}
