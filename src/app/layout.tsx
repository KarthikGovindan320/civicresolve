import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { I18nProvider } from "@/components/I18nProvider";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { HIGH_CONTRAST_VALUE, LARGE_TEXT_VALUE } from "@/lib/i18n/preferences";
import { getPreferences } from "@/lib/i18n/server";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  // Each page names itself first, then the site (WCAG 2.4.2).
  title: { default: "CivicResolve", template: "%s · CivicResolve" },
  description: "Report civic issues in any language. AI routes them to the right department.",
};

/**
 * Root layout: skip link, main navigation, page content and footer, shared by
 * every route.
 *
 * The visitor's language and display preferences are read from cookies here,
 * on the server, so the first HTML already carries the right `<html lang>`,
 * the high-contrast and larger-text attributes, and text in the chosen
 * language. The browser then hydrates from the same values, so nothing
 * flashes or mismatches.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { lang, highContrast, largeText } = await getPreferences();
  return (
    <html
      lang={lang}
      data-contrast={highContrast ? HIGH_CONTRAST_VALUE : undefined}
      data-text={largeText ? LARGE_TEXT_VALUE : undefined}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider initialLang={lang}>
          <SiteHeader initialDisplay={{ highContrast, largeText }} />
          <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
            {children}
          </main>
          <SiteFooter />
        </I18nProvider>
      </body>
    </html>
  );
}
