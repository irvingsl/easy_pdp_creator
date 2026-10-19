import { createHash } from "node:crypto";

/** Hash curto e estável de um texto (para saber se os fatos de uma geração mudaram). */
export const hashTexto = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 16);
