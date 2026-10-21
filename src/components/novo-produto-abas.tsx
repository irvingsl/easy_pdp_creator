"use client";

import { useState } from "react";
import { NovoLoteForm } from "./novo-lote-form";
import { NovoProdutoForm } from "./novo-produto-form";

export function NovoProdutoAbas() {
  const [aba, setAba] = useState<"um" | "varios">("um");
  const estilo = (ativa: boolean) =>
    `flex-1 rounded-lg px-3 py-2 text-sm font-medium ${ativa ? "bg-indigo-600 text-white" : "border border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-300"}`;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <button type="button" className={estilo(aba === "um")} onClick={() => setAba("um")}>Um produto</button>
        <button type="button" className={estilo(aba === "varios")} onClick={() => setAba("varios")}>Vários produtos</button>
      </div>
      {aba === "um" ? <NovoProdutoForm /> : <NovoLoteForm />}
    </div>
  );
}
