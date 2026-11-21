import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CivicResolve",
  description: "Report civic issues in any language. AI routes them to the right department.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {/* [ACCESSIBILITY] Keyboard users can jump straight past the navigation. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[2000] focus:rounded focus:bg-white focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <header className="sticky top-0 z-[1100] border-b border-slate-200 bg-white/95 backdrop-blur">
          <nav aria-label="Main" className="mx-auto flex max-w-6xl items-center gap-1 px-4 py-3">
            <Link href="/" className="mr-auto flex items-center gap-2 font-semibold text-slate-900">
              <span aria-hidden className="grid h-7 w-7 place-items-center rounded-md bg-emerald-600 text-sm text-white">
                CR
              </span>
              CivicResolve
            </Link>
            {/* The three views of the end-to-end workflow: citizen → public tracking → admin. */}
            <NavLink href="/">Report</NavLink>
            <NavLink href="/track">Track</NavLink>
            <NavLink href="/staff">Staff</NavLink>
          </nav>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          {children}
        </main>
        <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-600">
          CivicResolve · classification powered by Google Gemini
        </footer>
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">
      {children}
    </Link>
  );
}
