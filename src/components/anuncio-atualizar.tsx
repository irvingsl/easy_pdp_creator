"use client";

import { useState } from "react";
import { CopyBlock } from "./copy-block";
import { btnSecondary } from "./ui";

export function AnuncioAtualizar({ produtoId, itemId }: { produtoId: string; itemId: string }) {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<{ ok?: boolean; error?: string; item?: { status: number; resposta: unknown }; descricao?: { ok: boolean; status: number } } | null>(null);

  async function atualizar() {
    if (!window.confirm(`Atualizar o anúncio ${itemId} no Mercado Livre com o rascunho salvo (preço, atributos, garantia e descrição)?`)) return;
    setBusy(true);
    setR(null);
    try {
      const res = await fetch("/api/anuncios/atualizar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ produtoId, itemId, confirmar: true }) });
      const txt = await res.text();
      try {
        setR(JSON.parse(txt));
      } catch {
        setR({ error: `Resposta inesperada (${res.status})` });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <button type="button" className={`${btnSecondary} self-start !px-3 !py-1.5 text-sm`} disabled={busy} onClick={atualizar}>
        {busy ? "Atualizando…" : "Atualizar com o rascunho salvo"}
      </button>
      {r?.error && <p className="text-sm text-red-600">{r.error}</p>}
      {r && !r.error && (
        <div className="flex flex-col gap-2 text-sm">
          <p className={r.ok ? "text-green-700 dark:text-green-400" : "text-red-600"}>
            {r.ok ? "✓ Atributos e preço atualizados" : `✗ O ML recusou a atualização (HTTP ${r.item?.status})`}
            {r.descricao && !r.descricao.ok ? " · a descrição não foi atualizada" : ""}
          </p>
          <CopyBlock text={JSON.stringify(r, null, 2)} label="Copiar resposta" />
        </div>
      )}
    </div>
  );
}
