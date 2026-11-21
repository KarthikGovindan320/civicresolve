"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { applyLanguage } from "@/lib/client/preferences";
import { createTranslator, DEFAULT_LANG, type Lang, type Translate } from "@/lib/i18n";

interface I18nContextValue {
  lang: Lang;
  t: Translate;
  /** Switches the interface language and remembers it on this device. */
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18nContextValue>({
  lang: DEFAULT_LANG,
  t: createTranslator(DEFAULT_LANG),
  setLang: () => {},
});

/**
 * Makes the interface language available to every client component.
 *
 * The starting language comes from the server (which read it from the
 * preference cookie), so the server-rendered HTML and the first browser render
 * agree and there is no hydration mismatch or flash of English. Switching
 * language updates the client components at once, saves the cookie, keeps
 * `<html lang>` in step, and refreshes the route so server-rendered text is
 * fetched again in the new language (form state on the page is kept).
 */
export function I18nProvider({ initialLang, children }: { initialLang: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState(initialLang);
  const router = useRouter();
  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      t: createTranslator(lang),
      setLang(next) {
        setLangState(next);
        applyLanguage(next);
        router.refresh();
      },
    }),
    [lang, router],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Pins one language for part of the page, whatever the visitor chose. The
 * staff screens use it to stay in English while sharing components (badges,
 * statistics, chat) with the translated citizen pages; the `lang` attribute
 * tells screen readers which language that part is in.
 */
export function FixedLanguage({ lang, children }: { lang: Lang; children: ReactNode }) {
  const value = useMemo<I18nContextValue>(() => ({ lang, t: createTranslator(lang), setLang: () => {} }), [lang]);
  return (
    <I18nContext.Provider value={value}>
      <div lang={lang}>{children}</div>
    </I18nContext.Provider>
  );
}

/** The current language, its translate function and the language setter. */
export const useI18n = () => useContext(I18nContext);

/** The translate function for the current language. */
export const useT = (): Translate => useContext(I18nContext).t;
