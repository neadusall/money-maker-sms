import type { Metadata } from "next";
import Link from "next/link";
import { Inter, JetBrains_Mono } from "next/font/google";
import { auth } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { NavLinks } from "@/components/NavLinks";
import { openTodoCount } from "@/lib/todos";
import "./globals.css";

const interSans = Inter({
  variable: "--font-inter-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OS Text",
  description: "SMS outreach engine: campaigns, two-way inbox, and AI reply handling.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const todoCount = session?.user ? await openTodoCount().catch(() => 0) : 0;

  return (
    <html
      lang="en"
      className={`${interSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Theme + white-label accent, applied before paint (no flash). The host
            portal passes ?theme=dark|light and ?accent=#rrggbb through the SSO
            handoff; both persist so later loads match without the params. Uses
            the same localStorage keys as the portal (ros_theme). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
var q=new URLSearchParams(location.search);
var t=q.get("theme");if(t==="dark"||t==="light"){localStorage.setItem("ros_theme",t);}else{t=localStorage.getItem("ros_theme");}
document.documentElement.setAttribute("data-theme",t==="dark"?"dark":"light");
var a=q.get("accent");if(a&&/^#[0-9a-fA-F]{3,8}$/.test(a)){localStorage.setItem("ros_accent",a);}else{a=localStorage.getItem("ros_accent");}
if(a&&/^#[0-9a-fA-F]{3,8}$/.test(a)){document.documentElement.style.setProperty("--brand",a);}
if(window.self!==window.top){document.documentElement.classList.add("embedded");}
}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        <header className="sticky top-0 z-40 border-b border-zinc-200 bg-surface/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <Link href="/" className="emb-hide flex items-center">
              <Logo />
            </Link>
            {session?.user ? (
              <nav className="flex items-center gap-4">
                <NavLinks todoCount={todoCount} />
              </nav>
            ) : (
              <Link href="/login" className="emb-hide text-sm text-zinc-600 hover:text-zinc-900">
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
