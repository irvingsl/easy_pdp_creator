"use client";

import { useState } from "react";
import { CopyBlock } from "./copy-block";
import { btnPrimary, btnSecondary } from "./ui";

type Familia = { marca: string; modelo: string; ano: number };
type Previa = { existentes: Familia[]; ausentes: Familia[]; semAno: string[]; truncado: boolean };

/** agrupa por marca/modelo para mostrar "Volkswagen Fusca 1973–1986" */
const resumo = (lista: Familia[]) => {
  const m = new Map<string, number[]>();
  for (const f of lista) m.set(`${f.marca} ${f.modelo}`, [...(m.get(`${f.marca} ${f.modelo}`) ?? []), f.ano]);
  return [...m.entries()].map(([k, anos]) => `${k}: ${[...anos].sort((a, b) => a - b).join(", ")}`);
};

export function AnuncioCompat({ produtoId, itemId }: { produtoId: string; itemId: string }) {
  const [busy, setBusy] = useState(false);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [msg, setMsg] = useState("");
  const [resp, setResp] = useState<unknown>(null);

  async function chamar(corpo: Record<string, unknown>) {
    const res = await fetch("/api/anuncios/compatibilidade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ produtoId, ...corpo }) });
    const t = await res.text();
    try {
      return JSON.parse(t) as Record<string, unknown>;
    } catch {
      return { error: res.status === 504 ? "Demorou demais, tente de novo." : `Resposta inesperada (${res.status})` };
    }
  }

  async function montar() {
    setBusy(true);
    setMsg("");
    setPrevia(null);
    setResp(null);
    try {
      const j = await chamar({ acao: "previa" });
      if (j.error) setMsg(String(j.error));
      else setPrevia(j as unknown as Previa);
    } finally {
      setBusy(false);
    }
  }

  async function enviar() {
    if (!previa?.existentes.length) return;
    if (!window.confirm(`Enviar ${previa.existentes.length} combinações (marca/modelo/ano) de compatibilidade ao anúncio ${itemId}?`)) return;
    setBusy(true);
    setMsg("");
    try {
      const j = await chamar({ acao: "enviar", itemId, familias: previa.existentes });
      setResp(j.resposta ?? j);
      setMsg(j.ok ? `✓ Enviado (${j.enviadas} combinações). Confira no ML: pode levar alguns minutos para aparecer.` : `O ML recusou (HTTP ${j.status ?? "?"}). Veja a resposta abaixo.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-800">
      <span className="font-medium">Compatibilidade de veículos</span>
      <p className="text-xs text-gray-500">Usa só os veículos que você confirmou no rascunho (salve o rascunho antes) e confere cada marca/modelo/ano no catálogo do ML.</p>
      <button type="button" className={`${btnSecondary} self-start !px-3 !py-1.5`} disabled={busy} onClick={montar}>
        {busy && !previa ? "Conferindo no catálogo…" : "Montar a partir da lista confirmada"}
      </button>
      {previa && (
        <div className="flex flex-col gap-2">
          {previa.existentes.length > 0 && (
            <div>
              <p className="font-medium text-green-700 dark:text-green-400">{previa.existentes.length} combinação(ões) existem no catálogo</p>
              <ul className="list-disc pl-5 text-xs">{resumo(previa.existentes).map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          )}
          {previa.ausentes.length > 0 && (
            <div>
              <p className="font-medium text-amber-700 dark:text-amber-300">{previa.ausentes.length} não encontrada(s) no catálogo (não serão enviadas)</p>
              <ul className="list-disc pl-5 text-xs">{resumo(previa.ausentes).map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          )}
          {previa.semAno.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-300">Sem ano informado (ficam de fora): {previa.semAno.join(", ")}.</p>}
          {previa.truncado && <p className="text-xs text-amber-700 dark:text-amber-300">Havia combinações demais: enviei só as primeiras.</p>}
          <button type="button" className={btnPrimary} disabled={busy || !previa.existentes.length} onClick={enviar}>
            {busy ? "Enviando…" : `Enviar ${previa.existentes.length} combinações ao ML`}
          </button>
        </div>
      )}
      {msg && <p className="text-xs text-gray-600 dark:text-gray-400">{msg}</p>}
      {resp !== null && <CopyBlock text={JSON.stringify(resp, null, 2)} label="Copiar resposta do ML" />}
    </div>
  );
}
