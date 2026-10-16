import Link from "next/link";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-800">
        <Link href="/produtos" className="font-semibold">Easy PDP Creator</Link>
        <Link href="/produtos/novo" className="rounded bg-gray-900 px-3 py-2 text-sm text-white dark:bg-gray-100 dark:text-gray-900">
          Novo produto
        </Link>
      </header>
      <div className="mx-auto w-full max-w-3xl flex-1 p-4">{children}</div>
    </>
  );
}
