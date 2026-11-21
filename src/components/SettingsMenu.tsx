"use client";

import { useEffect, useId, useRef, useState } from "react";
import { applyDisplayPreference } from "@/lib/client/preferences";
import { LANGUAGE_CODES, LANGUAGES } from "@/lib/i18n";
import type { DisplayPreferences } from "@/lib/i18n/preferences";
import { useI18n } from "./I18nProvider";

const optionClass =
  "flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm font-medium ring-1 ring-inset";
const selectedClass = "bg-emerald-50 text-emerald-900 ring-emerald-300";
const unselectedClass = "bg-white text-slate-800 ring-slate-300 hover:bg-slate-50";

/**
 * Header menu for the interface language and two display aids: high contrast
 * and larger text. One compact button opens a small panel, so the header still
 * fits a 360px-wide phone in any language.
 *
 * Keyboard and screen-reader behaviour: the button reports whether the panel
 * is open, focus moves into the panel when it opens, Escape closes it and
 * returns focus to the button, and it also closes when focus or a tap moves
 * elsewhere. Every choice is a button with `aria-pressed`, at least 44px tall.
 *
 * The display aids are data attributes on `<html>` that the stylesheet reacts
 * to. The server sets them from the preference cookies, so they are already
 * correct in the first HTML; toggling one here updates the attribute and the
 * cookie together.
 */
export default function SettingsMenu({ initialDisplay }: { initialDisplay: DisplayPreferences }) {
  const { lang, t, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const [display, setDisplay] = useState(initialDisplay);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    // Start on the selected language, the first control in the panel that reflects a current choice.
    panelRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePress);
    };
  }, [open]);

  function toggleDisplay(name: keyof DisplayPreferences) {
    const enabled = !display[name];
    setDisplay({ ...display, [name]: enabled });
    applyDisplayPreference(name, enabled);
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      // Tabbing out of the panel closes it, so it never lingers over the page.
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t("settings.open")}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-100"
      >
        <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
        </svg>
        <span className="max-sm:hidden">{LANGUAGES[lang].name}</span>
      </button>
      {open && (
        <div
          id={panelId}
          ref={panelRef}
          role="group"
          aria-label={t("settings.open")}
          className="absolute right-0 top-full z-10 mt-2 w-64 max-w-[calc(100vw-2rem)] space-y-3 rounded-lg bg-white p-3 shadow-lg ring-1 ring-slate-300"
        >
          <fieldset className="space-y-1.5">
            <legend className="mb-1.5 text-xs font-semibold text-slate-600">{t("settings.language")}</legend>
            {LANGUAGE_CODES.map((code) => (
              <button
                key={code}
                type="button"
                // Each name is written in its own language, and marked so it is pronounced correctly.
                lang={code}
                aria-pressed={code === lang}
                onClick={() => setLang(code)}
                className={`${optionClass} ${code === lang ? selectedClass : unselectedClass}`}
              >
                {LANGUAGES[code].name}
                {code === lang && <CheckMark />}
              </button>
            ))}
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className="mb-1.5 text-xs font-semibold text-slate-600">{t("settings.display")}</legend>
            {(["highContrast", "largeText"] as const).map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={display[name]}
                onClick={() => toggleDisplay(name)}
                className={`${optionClass} ${display[name] ? selectedClass : unselectedClass}`}
              >
                {t(`settings.${name}`)}
                {display[name] && <CheckMark />}
              </button>
            ))}
          </fieldset>
          <p className="text-xs text-slate-600">{t("settings.remembered")}</p>
        </div>
      )}
    </div>
  );
}

/** Tick shown on a selected option, so the selection never depends on colour alone. */
function CheckMark() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path d="M5 12.5l4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
