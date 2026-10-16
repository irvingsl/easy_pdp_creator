import Link from "next/link";
import { btnPrimary } from "@/components/ui";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-800">
        <Link href="/produtos" className="font-semibold">Easy PDP Creator</Link>
        <nav className="flex items-center gap-3">
          <Link href="/conta" className="text-sm text-gray-600 hover:underline dark:text-gray-300">Conta</Link>
          <Link href="/produtos/novo" className={`${btnPrimary} !px-3 !py-2 text-sm`}>
          Novo produto
          </Link>
        </nav>
      </header>
      <div className="mx-auto w-full max-w-3xl flex-1 p-4">{children}</div>
    </>
  );
}
