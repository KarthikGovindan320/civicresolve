import type { Lang } from "@/lib/i18n";
import {
  HIGH_CONTRAST_VALUE,
  LARGE_TEXT_VALUE,
  PREFERENCE_COOKIES,
  preferenceCookie,
  type DisplayPreferences,
} from "@/lib/i18n/preferences";

/**
 * Browser side of the per-device preferences. Each change is applied to
 * `<html>` straight away (the stylesheet and screen readers react to it) and
 * saved in a cookie, which is what the server reads on the next request.
 */

/** Cookies can be blocked; the choice then applies to this page and simply isn't remembered. */
function remember(name: string, value: string): void {
  try {
    document.cookie = preferenceCookie(name, value);
  } catch {}
}

/** Remembers the interface language and keeps `<html lang>` in step with it. */
export function applyLanguage(lang: Lang): void {
  document.documentElement.lang = lang;
  remember(PREFERENCE_COOKIES.lang, lang);
}

/** The `<html>` data attribute and its "on" value for each display aid. */
const DISPLAY_ATTRIBUTES: Record<keyof DisplayPreferences, { attribute: string; value: string }> = {
  highContrast: { attribute: "data-contrast", value: HIGH_CONTRAST_VALUE },
  largeText: { attribute: "data-text", value: LARGE_TEXT_VALUE },
};

/** Turns high contrast or larger text on or off, and remembers the choice. */
export function applyDisplayPreference(name: keyof DisplayPreferences, enabled: boolean): void {
  const { attribute, value } = DISPLAY_ATTRIBUTES[name];
  if (enabled) document.documentElement.setAttribute(attribute, value);
  else document.documentElement.removeAttribute(attribute);
  remember(PREFERENCE_COOKIES[name], enabled ? value : "");
}
