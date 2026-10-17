"use client";

import { useState } from "react";

/** Bloco de texto (JSON etc.) com botão para copiar o conteúdo inteiro. */
export function CopyBlock({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={copy}
        className="absolute right-2 top-2 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
      >
        {copied ? "Copiado ✓" : label}
      </button>
      <pre className="max-h-96 overflow-auto rounded-lg bg-gray-100 p-3 pr-20 text-xs dark:bg-gray-900">{text}</pre>
    </div>
  );
}
