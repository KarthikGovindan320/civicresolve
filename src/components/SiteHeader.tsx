"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MessageKey } from "@/lib/i18n";
import type { DisplayPreferences } from "@/lib/i18n/preferences";
import { useT } from "./I18nProvider";
import SettingsMenu from "./SettingsMenu";

/** The three views of the end-to-end workflow: citizen, public tracking, staff. */
const NAV_LINKS: { href: string; label: MessageKey }[] = [
  { href: "/", label: "nav.report" },
  { href: "/track", label: "nav.track" },
  { href: "/staff", label: "nav.staff" },
];

const isCurrent = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

/**
 * Skip link and main navigation, in the visitor's language. On a narrow phone
 * the wordmark is hidden (the logo still links home) and, if larger text makes
 * the row too wide, the links wrap onto a second line instead of overflowing.
 */
export default function SiteHeader({ initialDisplay }: { initialDisplay: DisplayPreferences }) {
  const t = useT();
  const pathname = usePathname();
  return (
    <>
      {/* Lets keyboard users jump straight past the navigation. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[2000] focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        {t("nav.skip")}
      </a>
      <header className="sticky top-0 z-[1100] border-b border-slate-200 bg-white/95 backdrop-blur">
        <nav
          aria-label={t("nav.main")}
          className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-2"
        >
          <Link href="/" lang="en" className="flex min-h-11 items-center gap-2 font-semibold text-slate-900">
            <span aria-hidden className="grid h-7 w-7 place-items-center rounded-md bg-emerald-700 text-sm text-white">
              CR
            </span>
            <span className="max-sm:sr-only">CivicResolve</span>
          </Link>
          <div className="flex items-center gap-1">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={isCurrent(pathname, href) ? "page" : undefined}
                className="flex min-h-11 items-center whitespace-nowrap rounded-md px-2 text-sm font-medium text-slate-700 hover:bg-slate-100 aria-[current=page]:text-slate-900 aria-[current=page]:underline aria-[current=page]:decoration-emerald-600 aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-8 sm:px-3"
              >
                {t(label)}
              </Link>
            ))}
            <SettingsMenu initialDisplay={initialDisplay} />
          </div>
        </nav>
      </header>
    </>
  );
}
