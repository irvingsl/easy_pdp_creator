import { NovoProdutoAbas } from "@/components/novo-produto-abas";

export default function NovoProdutoPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Novo produto</h1>
      <NovoProdutoAbas />
    </div>
  );
}
