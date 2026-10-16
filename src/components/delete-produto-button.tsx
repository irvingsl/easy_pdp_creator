"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = { produtoId: string; paths: { bucket: string; path: string }[] };

export function DeleteProdutoButton({ produtoId, paths }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onDelete() {
    if (!confirm("Excluir este produto e todas as fotos?")) return;
    setBusy(true);
    setError("");
    const supabase = createClient();
    const byBucket = Map.groupBy(paths, (p) => p.bucket);
    for (const [bucket, items] of byBucket) {
      await supabase.storage.from(bucket).remove(items.map((i) => i.path));
    }
    const { error } = await supabase.from("produtos").delete().eq("id", produtoId);
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.push("/produtos");
    router.refresh();
  }

  return (
    <div>
      <button
        onClick={onDelete}
        disabled={busy}
        className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
      >
        {busy ? "Excluindo..." : "Excluir produto"}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
