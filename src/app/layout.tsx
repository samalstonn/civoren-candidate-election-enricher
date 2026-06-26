import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { auth, signOut } from "@/auth";

export const metadata: Metadata = {
  title: "Candidate Civoren Console",
  description: "Private CRM intake enrichment pipeline",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 min-h-screen font-mono">
        <header className="border-b border-gray-200 bg-white px-6 py-3 flex items-center gap-3">
          <span className="text-amber-600 font-bold tracking-wide text-sm">
            ◆ Civoren Console
          </span>
          <nav className="ml-6 flex gap-4">
            <Link href="/intake" className="text-xs text-gray-500 hover:text-gray-900">Pending Candidates</Link>
            <Link href="/candidates" className="text-xs text-gray-500 hover:text-gray-900">Candidates</Link>
            <Link href="/elections" className="text-xs text-gray-500 hover:text-gray-900">Elections</Link>
            <Link href="/logs" className="text-xs text-gray-500 hover:text-gray-900">Logs</Link>
          </nav>
          {session?.user ? (
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
              className="ml-auto flex items-center gap-3"
            >
              <span className="text-xs text-gray-500">{session.user.email}</span>
              <button
                type="submit"
                className="text-xs text-gray-500 hover:text-gray-900 border border-gray-200 rounded px-2 py-1"
              >
                Sign out
              </button>
            </form>
          ) : null}
        </header>
        <main className="max-w-8xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
