// Translation layer, per-device preferences and the sample reports.
import { afterEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_REPORTS, sampleAt } from "@/lib/client/samples";
import {
  createTranslator,
  fillPlaceholders,
  isLang,
  LANGUAGE_CODES,
  languageLabel,
  type Dictionary,
  type MessageKey,
} from "@/lib/i18n";
import { en } from "@/lib/i18n/en";
import { hi } from "@/lib/i18n/hi";
import { languageFromHeader, PREFERENCE_COOKIES, preferenceCookie, readPreferences } from "@/lib/i18n/preferences";
import { getPreferences, getTranslator } from "@/lib/i18n/server";
import { ta } from "@/lib/i18n/ta";
import { CATEGORIES, LIMITS, PRIORITIES, STATUSES } from "@/lib/types";

// The request a server component sees: its cookies and its Accept-Language header.
const request = vi.hoisted(() => ({ cookies: new Map<string, string>(), acceptLanguage: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = request.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
  headers: async () => new Headers(request.acceptLanguage ? { "accept-language": request.acceptLanguage } : {}),
}));

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
const keys = Object.keys(en) as MessageKey[];

afterEach(() => vi.unstubAllEnvs());

describe("dictionaries", () => {
  const translations: [string, Dictionary][] = [
    ["Tamil", ta],
    ["Hindi", hi],
  ];

  it.each(translations)("%s has exactly the English keys, none empty", (_name, dictionary) => {
    expect(Object.keys(dictionary).sort()).toEqual([...keys].sort());
    for (const key of keys) expect(dictionary[key].trim(), key).not.toBe("");
  });

  it.each(translations)("%s keeps every placeholder of the English message", (_name, dictionary) => {
    for (const key of keys) expect(placeholders(dictionary[key]), key).toEqual(placeholders(en[key]));
  });

  it.each(translations)("%s is actually translated, apart from names", (_name, dictionary) => {
    const sameAsEnglish = keys.filter((key) => dictionary[key] === en[key]);
    expect(sameAsEnglish).toEqual([]);
  });

  it("keeps the product name and Gemini untranslated", () => {
    for (const dictionary of [ta, hi]) {
      for (const key of keys) if (en[key].includes("Gemini")) expect(dictionary[key], key).toContain("Gemini");
    }
  });

  it("has a label for every status, priority and category the server stores", () => {
    for (const status of STATUSES) expect(en[`status.${status}`]).toBe(status);
    for (const priority of PRIORITIES) expect(en[`priority.${priority}`]).toBe(priority);
    for (const category of CATEGORIES) expect(en[`category.${category}`]).toBe(category);
  });
});

describe("createTranslator", () => {
  it("translates and fills in placeholders", () => {
    expect(createTranslator("en")("track.shown", { count: 3 })).toBe("Showing: 3");
    expect(createTranslator("ta")("status.Resolved")).toBe(ta["status.Resolved"]);
    expect(createTranslator("hi")("map.view", { id: "CR-1004" })).toContain("CR-1004");
  });

  it("falls back to English when a language lacks a message, warning in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = createTranslator("ta", { en, ta: { "nav.report": "புகார்" }, hi });

    expect(t("nav.report")).toBe("புகார்");
    expect(warn).not.toHaveBeenCalled();
    expect(t("nav.track")).toBe("Track");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("leaves an unknown placeholder as written", () => {
    expect(fillPlaceholders("Hello {name}, {missing}", { name: "Vellore" })).toBe("Hello Vellore, {missing}");
  });

  it("names report languages, falling back to the code", () => {
    const t = createTranslator("hi");
    expect(languageLabel(t, "ta")).toBe(hi["language.ta"]);
    expect(languageLabel(t, "bn")).toBe("BN");
  });
});

describe("preferences", () => {
  const cookies = (values: Record<string, string>) => (name: string) => values[name];

  it("recognises only supported languages", () => {
    expect(LANGUAGE_CODES).toEqual(["en", "ta", "hi"]);
    expect(isLang("ta")).toBe(true);
    expect(isLang("fr")).toBe(false);
    expect(isLang("toString")).toBe(false);
    expect(isLang(undefined)).toBe(false);
  });

  it("defaults to English with both display aids off", () => {
    expect(readPreferences(cookies({}))).toEqual({ lang: "en", highContrast: false, largeText: false });
  });

  it("reads saved choices and ignores unknown values", () => {
    const saved = { [PREFERENCE_COOKIES.lang]: "hi", [PREFERENCE_COOKIES.highContrast]: "high" };
    expect(readPreferences(cookies({ ...saved, [PREFERENCE_COOKIES.largeText]: "large" }))).toEqual({
      lang: "hi",
      highContrast: true,
      largeText: true,
    });
    const junk = { [PREFERENCE_COOKIES.lang]: "<script>", [PREFERENCE_COOKIES.largeText]: "yes" };
    expect(readPreferences(cookies(junk))).toEqual({ lang: "en", highContrast: false, largeText: false });
  });

  it("uses the browser's language until one is chosen", () => {
    expect(languageFromHeader("ta-IN,ta;q=0.9,en;q=0.8")).toBe("ta");
    expect(languageFromHeader("fr-FR, hi;q=0.5")).toBe("hi");
    expect(languageFromHeader("fr")).toBeNull();
    expect(languageFromHeader(null)).toBeNull();
    expect(readPreferences(cookies({}), "ta-IN").lang).toBe("ta");
    expect(readPreferences(cookies({ [PREFERENCE_COOKIES.lang]: "en" }), "ta-IN").lang).toBe("en");
  });

  it("builds a site-wide cookie, and an expired one to clear a setting", () => {
    expect(preferenceCookie("cr-lang", "ta")).toBe("cr-lang=ta; path=/; max-age=31536000; samesite=lax");
    expect(preferenceCookie("cr-text", "")).toContain("max-age=0");
  });
});

describe("sample reports", () => {
  it("offers a few complete samples that fit the form limits", () => {
    expect(SAMPLE_REPORTS.length).toBeGreaterThanOrEqual(3);
    for (const sample of SAMPLE_REPORTS) {
      expect(sample.title.length).toBeGreaterThan(10);
      expect(sample.title.length).toBeLessThanOrEqual(LIMITS.title);
      expect(sample.description.length).toBeGreaterThan(60);
      expect(sample.description.length).toBeLessThanOrEqual(LIMITS.description);
      expect(sample.address.length).toBeLessThanOrEqual(LIMITS.address);
    }
    expect(new Set(SAMPLE_REPORTS.map((sample) => sample.title)).size).toBe(SAMPLE_REPORTS.length);
  });

  it("places every sample in Vellore", () => {
    for (const sample of SAMPLE_REPORTS) {
      expect(sample.lat).toBeGreaterThan(12.85);
      expect(sample.lat).toBeLessThan(13.0);
      expect(sample.lng).toBeGreaterThan(79.05);
      expect(sample.lng).toBeLessThan(79.22);
    }
  });

  it("includes a sample written in Tamil script", () => {
    const tamil = SAMPLE_REPORTS.find((sample) => sample.lang === "ta");
    expect(tamil?.title).toMatch(/[஀-௿]/);
    expect(tamil?.description).toMatch(/[஀-௿]/);
  });

  it("cycles through the samples on repeated clicks", () => {
    const count = SAMPLE_REPORTS.length;
    expect(sampleAt(0)).toBe(SAMPLE_REPORTS[0]);
    expect(sampleAt(count - 1)).toBe(SAMPLE_REPORTS[count - 1]);
    expect(sampleAt(count)).toBe(SAMPLE_REPORTS[0]);
    expect(sampleAt(count + 1)).toBe(SAMPLE_REPORTS[1]);
  });
});

describe("server-side preferences", () => {
  afterEach(() => {
    request.cookies.clear();
    request.acceptLanguage = null;
  });

  it("uses the saved language cookie over the browser's languages", async () => {
    request.cookies.set(PREFERENCE_COOKIES.lang, "ta");
    request.acceptLanguage = "hi-IN,hi;q=0.9";
    expect((await getPreferences()).lang).toBe("ta");
    expect((await getTranslator())("nav.track")).toBe(ta["nav.track"]);
  });

  it("falls back to the first supported Accept-Language, then to English", async () => {
    request.acceptLanguage = "fr-FR,hi;q=0.8";
    expect((await getPreferences()).lang).toBe("hi");
    request.acceptLanguage = null;
    expect((await getPreferences()).lang).toBe("en");
  });

  it("reads the display aids from their cookies", async () => {
    request.cookies.set(PREFERENCE_COOKIES.highContrast, "high");
    expect(await getPreferences()).toMatchObject({ highContrast: true, largeText: false });
  });
});
