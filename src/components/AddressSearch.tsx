"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { apiRequest } from "@/lib/client/api";
import { LIMITS } from "@/lib/types";
import { useT } from "./I18nProvider";
import { fieldClass } from "./ui";

export interface PickedPlace {
  lat: number;
  lng: number;
  address: string;
}

interface Suggestion {
  id: string;
  /** The place name, e.g. "Katpadi Bus Stand". */
  main: string;
  /** The surrounding area, shown under the name. */
  secondary: string;
  /** Present when the provider returns coordinates with the suggestion; otherwise fetched on selection. */
  lat?: number;
  lng?: number;
}

/** Shortest query worth sending to the search provider. */
const MIN_QUERY_LENGTH = 3;
/** Pause in typing before a type-ahead search is sent. */
const DEBOUNCE_MS = 300;
/** Delay before closing the list on blur, so a click on a suggestion still registers. */
const BLUR_CLOSE_DELAY_MS = 150;

// Google's session token: URL-safe, at most 36 characters. randomUUID() needs a secure context
// (HTTPS or localhost); on plain-HTTP LAN testing, fall back to 32 random hex characters.
const newSessionToken = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");

const fullName = (suggestion: Suggestion) =>
  suggestion.secondary ? `${suggestion.main}, ${suggestion.secondary}` : suggestion.main;

/**
 * "Search an address or landmark" box above the report map. Typing "Katpadi
 * bus stand" shows suggestions; picking one moves the map there and places
 * the pin, which is much faster than dragging the map across the city.
 *
 * It follows the WAI-ARIA combobox pattern: a combobox input that controls a
 * listbox of options, Up/Down to move, Enter to choose, Escape to close, and
 * result counts announced through a live region. Keystrokes are debounced and
 * stale responses are dropped, so fast typing doesn't send a request per
 * letter or flash old results.
 */
export default function AddressSearch({
  provider,
  onSelect,
}: {
  provider: "google" | "osm";
  onSelect: (place: PickedPlace) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  // What the search last reported; problems are also shown visibly, routine updates only announced.
  const [status, setStatus] = useState<{ text: string; problem: boolean }>({ text: "", problem: false });
  const announce = (text: string) => setStatus({ text, problem: false });
  const reportProblem = (text: string) => setStatus({ text, problem: true });
  const [firstSessionToken] = useState(newSessionToken); // generated once, not on every render
  const sessionToken = useRef(firstSessionToken); // one Google billing session per search
  // Counts requests so that only the latest one may update the list.
  const latestRequest = useRef(0);
  // Set when choose() fills the box with the picked place, so that text change doesn't trigger a new search.
  const skipNextSearch = useRef(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const listId = useId();
  const typeahead = provider === "google";
  const searchableQuery = query.trim().length >= MIN_QUERY_LENGTH ? query.trim() : null;

  function clearSuggestions() {
    setSuggestions([]);
    setActiveIndex(-1);
    setOpen(false);
    setLoading(false);
    setStatus({ text: "", problem: false });
  }

  async function search(text: string) {
    const requestNumber = ++latestRequest.current;
    const isLatest = () => requestNumber === latestRequest.current;
    setLoading(true);
    try {
      const result = await apiRequest<{ suggestions: Suggestion[] }>(
        `/api/places?q=${encodeURIComponent(text)}&session=${sessionToken.current}`,
      );
      if (!isLatest()) return; // a newer request has already been sent
      if (!result.ok) {
        setSuggestions([]);
        reportProblem(result.error ?? t("search.failed"));
        return;
      }
      const found = result.data.suggestions;
      setSuggestions(found);
      setActiveIndex(found.length ? 0 : -1);
      setOpen(found.length > 0);
      if (found.length) announce(t("search.results", { count: found.length }));
      else reportProblem(t("search.noMatches"));
    } catch {
      if (isLatest()) reportProblem(t("search.failed"));
    } finally {
      if (isLatest()) setLoading(false);
    }
  }

  // The debounced search should rerun when the query changes, not when the interface language does.
  const searchLatest = useEffectEvent(search);
  const clearLatest = useEffectEvent(clearSuggestions);

  // A pending blur-close must not fire after the component is gone.
  useEffect(() => () => clearTimeout(blurTimer.current), []);

  // Google: suggestions while typing (debounced). OpenStreetMap: only on Enter (its usage policy).
  useEffect(() => {
    if (!typeahead) return;
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }
    if (query.trim().length < MIN_QUERY_LENGTH) {
      latestRequest.current++; // drop any search still in flight
      // Too short to search: nothing stale may stay selectable. Deferred so state isn't set synchronously in the effect.
      queueMicrotask(clearLatest);
      return;
    }
    const debounce = setTimeout(() => searchLatest(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(debounce);
  }, [query, typeahead]);

  // Each completed choice ends a billing session, whichever way the coordinates were obtained.
  const rotateSession = () => {
    sessionToken.current = newSessionToken();
  };

  async function choose(suggestion: Suggestion) {
    setOpen(false);
    latestRequest.current++; // drop any search still in flight
    skipNextSearch.current = true;
    setQuery(fullName(suggestion));
    if (suggestion.lat !== undefined && suggestion.lng !== undefined) {
      onSelect({ lat: suggestion.lat, lng: suggestion.lng, address: fullName(suggestion) });
      announce(t("search.pinned", { place: suggestion.main }));
      rotateSession();
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<{ lat: number; lng: number; address?: string }>(
        `/api/places?id=${encodeURIComponent(suggestion.id)}&session=${sessionToken.current}`,
      );
      if (!result.ok) return reportProblem(result.error ?? t("search.notFound"));
      // "Katpadi Bus Stand, Katpadi, Vellore…": keep the name the citizen picked in front of Google's address.
      const address = result.data.address ?? "";
      onSelect({
        lat: result.data.lat,
        lng: result.data.lng,
        address: address.startsWith(suggestion.main) ? address : `${suggestion.main}, ${address}`,
      });
      announce(t("search.pinned", { place: suggestion.main }));
    } catch {
      reportProblem(t("search.notFound"));
    } finally {
      setLoading(false);
      rotateSession(); // the details call ends this billing session
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault(); // never submit the whole report from the search box
      if (open && activeIndex >= 0 && suggestions[activeIndex]) choose(suggestions[activeIndex]);
      else if (searchableQuery) search(searchableQuery);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const optionId = (index: number) => `${listId}-opt-${index}`;

  return (
    <div className="relative">
      <label htmlFor={`${listId}-input`} className="sr-only">
        {t("search.label")}
      </label>
      <div className="flex gap-2">
        <input
          id={`${listId}-input`}
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!typeahead) setOpen(false);
          }}
          onKeyDown={onKeyDown}
          aria-busy={loading}
          onBlur={() => {
            clearTimeout(blurTimer.current);
            blurTimer.current = setTimeout(() => setOpen(false), BLUR_CLOSE_DELAY_MS);
          }}
          onFocus={() => {
            clearTimeout(blurTimer.current);
            if (suggestions.length) setOpen(true);
          }}
          placeholder={t("search.placeholder")}
          maxLength={LIMITS.search}
          className={fieldClass}
        />
        {!typeahead && (
          <button
            type="button"
            onClick={() => searchableQuery && search(searchableQuery)}
            className="whitespace-nowrap rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
          >
            {t("search.button")}
          </button>
        )}
      </div>
      {loading && (
        <span className="absolute right-3 top-2.5 text-xs text-slate-500" aria-hidden="true">
          …
        </span>
      )}

      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("search.suggestions")}
          className="absolute z-[1200] mt-1 w-full overflow-hidden rounded-md bg-white shadow-lg ring-1 ring-slate-200"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              // mousedown rather than click, and without moving focus, so the input's blur doesn't close the list first.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(suggestion);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`cursor-pointer px-3 py-2 text-sm ${index === activeIndex ? "bg-blue-50" : ""}`}
            >
              <span className="font-medium">{suggestion.main}</span>
              {suggestion.secondary && <span className="block text-xs text-slate-600">{suggestion.secondary}</span>}
            </li>
          ))}
          {/* Attribution required when showing predictions without a Google map: the text "Google Maps"
              (Places API policies), or the OpenStreetMap credit for the fallback. */}
          <li role="presentation" className="border-t border-slate-100 px-3 py-1 text-right text-[11px] text-slate-500">
            {typeahead ? "Google Maps" : t("search.osmCredit")}
          </li>
        </ul>
      )}
      <p className="sr-only" aria-live="polite">
        {status.problem ? "" : status.text}
      </p>
      {/* Only problems are shown visibly; routine updates go to the live region above. */}
      {status.problem && (
        <p role="alert" className="mt-1 text-xs text-amber-800">
          {status.text}
        </p>
      )}
    </div>
  );
}
