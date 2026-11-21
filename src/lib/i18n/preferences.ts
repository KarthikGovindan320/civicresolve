/**
 * Per-device preferences: interface language, high contrast and larger text.
 *
 * They are kept in cookies rather than localStorage so the server can read
 * them: the very first HTML already has the right `<html lang>`, the right
 * display attributes and text in the chosen language. That means no flash of
 * English, and no hydration mismatch, because server and browser render from
 * the same values.
 */
import { DEFAULT_LANG, isLang, type Lang } from "./index";

/** Cookie names for each preference. */
export const PREFERENCE_COOKIES = {
  lang: "cr-lang",
  highContrast: "cr-contrast",
  largeText: "cr-text",
} as const;

/** Cookie values that switch a display preference on. */
export const HIGH_CONTRAST_VALUE = "high";
export const LARGE_TEXT_VALUE = "large";

/** How long a preference is remembered. */
export const PREFERENCE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** The display toggles, applied as data attributes on `<html>`. */
export interface DisplayPreferences {
  highContrast: boolean;
  largeText: boolean;
}

/** Everything remembered for a device. */
export interface Preferences extends DisplayPreferences {
  lang: Lang;
}

/**
 * First supported language in an Accept-Language header, so a phone set to
 * Tamil or Hindi opens in that language before any choice is made.
 */
export function languageFromHeader(acceptLanguage: string | null | undefined): Lang | null {
  for (const entry of (acceptLanguage ?? "").split(",")) {
    const code = entry.split(";")[0].trim().toLowerCase().split("-")[0];
    if (isLang(code)) return code;
  }
  return null;
}

/**
 * Works out the preferences from cookie values. A saved language wins;
 * otherwise the browser's preferred language is used, then English.
 */
export function readPreferences(
  cookie: (name: string) => string | undefined,
  acceptLanguage?: string | null,
): Preferences {
  const savedLang = cookie(PREFERENCE_COOKIES.lang);
  return {
    lang: isLang(savedLang) ? savedLang : (languageFromHeader(acceptLanguage) ?? DEFAULT_LANG),
    highContrast: cookie(PREFERENCE_COOKIES.highContrast) === HIGH_CONTRAST_VALUE,
    largeText: cookie(PREFERENCE_COOKIES.largeText) === LARGE_TEXT_VALUE,
  };
}

/** The `Set-Cookie`-style string that saves (or, for an empty value, clears) a preference. */
export function preferenceCookie(name: string, value: string): string {
  const maxAge = value ? PREFERENCE_MAX_AGE_SECONDS : 0;
  return `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
}
