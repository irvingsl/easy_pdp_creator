"use client";

import { useState } from "react";
import { CopyBlock } from "./copy-block";
import { btnSecondary } from "./ui";

export function AnuncioCompat({ itemId }: { itemId: string }) {
  const [busy, setBusy] = useState(false);
  const [txt, setTxt] = useState("");

  async function explorar() {
    setBusy(true);
    setTxt("");
    try {
      const res = await fetch("/api/anuncios/compatibilidade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemId }) });
      const t = await res.text();
      try {
        setTxt(JSON.stringify(JSON.parse(t), null, 2));
      } catch {
        setTxt(res.status === 504 ? "Demorou demais, tente de novo." : `Resposta inesperada (${res.status})`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <button type="button" className={`${btnSecondary} self-start !px-3 !py-1.5 text-sm`} disabled={busy} onClick={explorar}>
        {busy ? "Consultando…" : "Explorar compatibilidade (diagnóstico)"}
      </button>
      {txt && <CopyBlock text={txt} label="Copiar resultado" />}
    </div>
  );
}
