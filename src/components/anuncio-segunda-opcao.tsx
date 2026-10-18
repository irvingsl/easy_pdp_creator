"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CopyBlock } from "./copy-block";
import { btnPrimary, btnSecondary, inputBase } from "./ui";

/** Cria uma segunda opção de venda do mesmo produto, com outro preço e outra condição de frete. */
export function AnuncioSegundaOpcao({ produtoId, precoBase }: { produtoId: string; precoBase: number | null }) {
  const router = useRouter();
  const [modo, setModo] = useState<"com" | "sem">("com");
  const [preco, setPreco] = useState("");
  const [pausado, setPausado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [obrigatorio, setObrigatorio] = useState<boolean | null>(null);
  const [resp, setResp] = useState<unknown>(null);

  const num = () => Number(preco.replace(",", "."));

  async function sugerir() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/anuncios/calcular", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ produtoId }) });
      const j = (await res.json().catch(() => ({}))) as { precoEquivalenteComFrete?: number | null; precoEquivalenteSemFrete?: number | null; freteObrigatorio?: boolean | null; error?: string };
      if (j.error) return setMsg(j.error);
      setObrigatorio(j.freteObrigatorio ?? null);
      const v = modo === "com" ? j.precoEquivalenteComFrete : j.precoEquivalenteSemFrete;
      if (v == null) return setMsg("Não consegui calcular o preço equivalente (faltam dados do ML).");
      setPreco(String(v).replace(".", ","));
      setMsg(`Sugestão para ter a mesma sobra do anúncio atual (baseado no preço ${precoBase?.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}). É uma estimativa.`);
    } finally {
      setBusy(false);
    }
  }

  async function criar() {
    const v = num();
    if (!Number.isFinite(v) || v <= 0) return setMsg("Informe o preço da nova opção.");
    if (!window.confirm(`Criar uma nova opção ${modo === "com" ? "COM" : "SEM"} frete grátis por R$ ${v.toFixed(2).replace(".", ",")}, ${pausado ? "pausada" : "ATIVA"}?`)) return;
    setBusy(true);
    setMsg("");
    setResp(null);
    try {
      const res = await fetch("/api/anuncios/publicar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ produtoId, confirmar: true, pausado, precoOverride: v, freteGratisOverride: modo === "com" }) });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string; resposta?: unknown };
      if (j.ok) {
        setMsg(`✓ Criada: ${j.id}`);
        router.refresh();
      } else {
        setMsg(j.error ?? `Resposta inesperada (${res.status})`);
        setResp(j.resposta ?? null);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-800">
      <span className="font-medium">Criar outra opção de venda</span>
      <p className="text-xs text-gray-500">Mesmo produto e mesmo rascunho, com outro preço e outra condição de frete. Só funciona onde o frete grátis é opcional: acima do limite o ML o impõe nas duas.</p>
      <select className={inputBase} value={modo} onChange={(e) => setModo(e.target.value as "com" | "sem")}>
        <option value="com">Nova opção COM frete grátis (por minha conta)</option>
        <option value="sem">Nova opção SEM frete grátis</option>
      </select>
      <div className="flex gap-2">
        <input className={inputBase} inputMode="decimal" placeholder="Preço da nova opção (R$)" value={preco} onChange={(e) => setPreco(e.target.value.replace(/[^\d.,]/g, ""))} />
        <button type="button" className={btnSecondary} disabled={busy} onClick={sugerir}>Sugerir</button>
      </div>
      {obrigatorio && <p className="text-xs text-amber-700 dark:text-amber-300">Neste preço o ML exige frete grátis: a opção sem frete grátis provavelmente será criada com frete grátis mesmo assim.</p>}
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={pausado} onChange={(e) => setPausado(e.target.checked)} /> Criar pausada (a opção só faz sentido ativa ao lado da outra)
      </label>
      <button type="button" className={btnPrimary} disabled={busy} onClick={criar}>{busy ? "Trabalhando…" : "Criar a opção"}</button>
      {msg && <p className="text-xs text-gray-600 dark:text-gray-400">{msg}</p>}
      {resp !== null && <CopyBlock text={JSON.stringify(resp, null, 2)} label="Copiar resposta do ML" />}
    </div>
  );
}
