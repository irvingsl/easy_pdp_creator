"use client";

import { useState } from "react";
import { CopyBlock } from "./copy-block";
import { btnSecondary } from "./ui";

type Resp = {
  error?: string;
  status?: string;
  sub_status?: string[];
  fotos?: number;
  descricoes?: number;
  pendencias?: { grupo: string; titulo: string; status?: string; regras?: string[] }[];
  atributosFaltando?: { id: string; nome: string; tipo?: string; obrigatorio: boolean; recomendado: boolean }[];
  brutos?: unknown;
};

export function AnuncioQualidade({ itemId }: { itemId: string }) {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Resp | null>(null);

  async function ver() {
    setBusy(true);
    setR(null);
    try {
      const res = await fetch("/api/anuncios/qualidade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemId }) });
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
      <button type="button" className={`${btnSecondary} self-start !px-3 !py-1.5 text-sm`} disabled={busy} onClick={ver}>
        {busy ? "Consultando…" : "Ver pontos a melhorar"}
      </button>
      {r?.error && <p className="text-sm text-red-600">{r.error}</p>}
      {r && !r.error && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-gray-600 dark:text-gray-400">
            Status: {r.status} {r.sub_status?.length ? `(${r.sub_status.join(", ")})` : ""} · {r.fotos} foto(s) · {r.descricoes} descrição(ões)
          </p>
          {!!r.pendencias?.length && (
            <ul className="list-disc pl-5">
              {r.pendencias.map((p, i) => (
                <li key={i}>
                  <strong>{p.titulo}</strong>
                  {p.regras?.length ? `: ${p.regras.join("; ")}` : ""}
                </li>
              ))}
            </ul>
          )}
          {!!r.atributosFaltando?.length && (
            <details open>
              <summary className="cursor-pointer">Atributos da categoria ainda não preenchidos ({r.atributosFaltando.length})</summary>
              <ul className="list-disc pl-5 text-xs">
                {[...r.atributosFaltando].sort((a, b) => Number(b.obrigatorio) - Number(a.obrigatorio) || Number(b.recomendado) - Number(a.recomendado)).map((a) => (
                  <li key={a.id}>
                    {a.nome} <span className="font-mono text-gray-500">{a.id}</span>
                    {a.obrigatorio ? " · obrigatório" : a.recomendado ? " · recomendado" : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <CopyBlock text={JSON.stringify(r, null, 2)} label="Copiar diagnóstico" />
        </div>
      )}
    </div>
  );
}
