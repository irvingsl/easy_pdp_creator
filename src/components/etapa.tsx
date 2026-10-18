"use client";

import { useState, type ReactNode } from "react";

/**
 * Bloco recolhível de uma etapa da página do produto. O estado aberto/fechado é do usuário:
 * `aberto` só define o estado inicial, e atualizar a página (router.refresh) não o altera.
 */
export function Etapa({ n, titulo, resumo, aberto = false, children }: { n?: number; titulo: string; resumo?: string; aberto?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(aberto);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="group rounded-lg border border-gray-200 dark:border-gray-800">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
        {n != null && <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-medium text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">{n}</span>}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">{titulo}</span>
          {resumo && <span className="truncate text-xs text-gray-500">{resumo}</span>}
        </span>
        <span className="text-gray-400 transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-gray-200 p-4 dark:border-gray-800">{children}</div>
    </details>
  );
}
