/**
 * A small typed translation layer for the citizen-facing screens.
 *
 * English is the source of truth: `MessageKey` is derived from the English
 * dictionary, and the other dictionaries are typed as `Dictionary`, so a key
 * that is missing or misspelt in Tamil or Hindi fails the type check. At
 * runtime a missing entry still falls back to English (with a warning in
 * development) instead of showing a blank.
 *
 * This module is pure (no React, no browser or server APIs), so the server
 * layout, client components and tests all share it.
 */
import { en } from "./en";
import { hi } from "./hi";
import { ta } from "./ta";

/** Every translatable message, as named in the English dictionary. */
export type MessageKey = keyof typeof en;

/** A complete set of messages for one language. */
export type Dictionary = Record<MessageKey, string>;

/** Supported interface language codes, in the order the switcher lists them. */
export const LANGUAGE_CODES = ["en", "ta", "hi"] as const;

/** A supported interface language code. */
export type Lang = (typeof LANGUAGE_CODES)[number];

/** Each language's own name, for the switcher. `Record<Lang, …>` makes a missing language a compile error. */
export const LANGUAGES: Record<Lang, { name: string }> = {
  en: { name: "English" },
  ta: { name: "தமிழ்" },
  hi: { name: "हिंदी" },
};

/** The language used when the visitor has not chosen one and the browser asks for none we support. */
export const DEFAULT_LANG: Lang = "en";

const DICTIONARIES: Record<Lang, Dictionary> = { en, ta, hi };

/** Whether a value (from a cookie, for example) is a supported language code. */
export const isLang = (value: unknown): value is Lang => typeof value === "string" && Object.hasOwn(LANGUAGES, value);

/** Values substituted into `{name}` placeholders. */
export type MessageParams = Record<string, string | number>;

/** Looks up a message in one language and fills in its placeholders. */
export type Translate = (key: MessageKey, params?: MessageParams) => string;

/** Replaces each `{name}` in a template with its value; unknown placeholders are left as written. */
export function fillPlaceholders(template: string, params: MessageParams = {}): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}

/**
 * Builds the translate function for a language. The dictionaries can be
 * replaced (and be incomplete) so the English fallback can be tested.
 */
export function createTranslator(
  lang: Lang,
  dictionaries: Record<Lang, Partial<Dictionary>> = DICTIONARIES,
): Translate {
  const messages = dictionaries[lang];
  return (key, params) => {
    const message = messages[key];
    if (message === undefined && process.env.NODE_ENV === "development")
      console.warn(`Missing "${lang}" translation for "${key}"; showing English.`);
    return fillPlaceholders(message ?? en[key], params);
  };
}

/** Whether `key` names a message in the dictionaries. */
const isMessageKey = (key: string): key is MessageKey => Object.hasOwn(en, key);

/**
 * Name of a report's language in the interface language, for any language
 * code Gemini may detect; unknown codes are shown upper-cased.
 */
export function languageLabel(t: Translate, code: string): string {
  const key = `language.${code}`;
  return isMessageKey(key) ? t(key) : code.toUpperCase();
}
