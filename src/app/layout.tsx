import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { auth } from "@/lib/auth";
import { signOutAction } from "@/lib/actions";
import { Logo } from "@/components/Logo";
import { NavLinks } from "@/components/NavLinks";
import { UserMenu } from "@/components/UserMenu";
import { openTodoCount } from "@/lib/todos";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Money Maker SMS",
  description: "SMS outreach engine — campaigns, two-way inbox, and AI reply handling.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const email = session?.user?.email ?? "";
  const image = session?.user?.image ?? null;
  const todoCount = session?.user ? await openTodoCount().catch(() => 0) : 0;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <Link href="/" className="flex items-center">
              <Logo />
            </Link>
            {session?.user ? (
              <nav className="flex items-center gap-4">
                <NavLinks todoCount={todoCount} />
                <UserMenu email={email} image={image} signOutAction={signOutAction} />
              </nav>
            ) : (
              <Link href="/login" className="text-sm text-zinc-600 hover:text-zinc-900">
                Sign in
              </Link>
            )}
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
