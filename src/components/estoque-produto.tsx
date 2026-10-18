"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { btnSecondary, inputBase } from "./ui";

/** Ajusta o estoque do produto gravando uma movimentação (o saldo é a soma delas). */
export function EstoqueProduto({ produtoId, estoque }: { produtoId: string; estoque: number }) {
  const router = useRouter();
  const [valor, setValor] = useState(String(estoque));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function salvar() {
    const novo = Math.floor(Number(valor));
    if (!Number.isFinite(novo) || novo < 0) return setMsg("Informe um número inteiro, 0 ou mais.");
    if (novo === estoque) return setMsg("Já está nesse valor.");
    setBusy(true);
    setMsg("");
    const { error } = await createClient().from("movimentacoes_estoque").insert({ produto_id: produtoId, delta: novo - estoque, motivo: "ajuste manual", origem: "manual" });
    setBusy(false);
    if (error) return setMsg(error.message);
    setMsg("Estoque atualizado ✓ (para refletir no anúncio publicado, use Atualizar)");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-500" htmlFor="estoque">Estoque</label>
        <input id="estoque" className={`${inputBase} !w-24 !p-2`} inputMode="numeric" value={valor} onChange={(e) => setValor(e.target.value.replace(/\D/g, ""))} />
        <button type="button" className={`${btnSecondary} !px-3 !py-2 text-sm`} disabled={busy} onClick={salvar}>Salvar</button>
      </div>
      {msg && <p className="text-xs text-gray-500">{msg}</p>}
    </div>
  );
}
