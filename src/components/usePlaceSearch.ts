"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { apiRequest } from "@/lib/client/api";
import { MIN_PLACE_QUERY_CHARS } from "@/lib/constants";
import { useT } from "./I18nProvider";

export interface PickedPlace {
  lat: number;
  lng: number;
  address: string;
}

export interface Suggestion {
  id: string;
  /** The place name, e.g. "Katpadi Bus Stand". */
  main: string;
  /** The surrounding area, shown under the name. */
  secondary: string;
  /** Present when the provider returns coordinates with the suggestion; otherwise fetched on selection. */
  lat?: number;
  lng?: number;
}

/** What the search last reported; problems are also shown visibly, routine updates only announced. */
export interface SearchStatus {
  text: string;
  problem: boolean;
}

/** Pause in typing before a type-ahead search is sent. */
const DEBOUNCE_MS = 300;

// Google's session token: URL-safe, at most 36 characters. randomUUID() needs a secure context
// (HTTPS or localhost); on plain-HTTP LAN testing, fall back to 32 random hex characters.
const newSessionToken = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");

const fullName = (suggestion: Suggestion) =>
  suggestion.secondary ? `${suggestion.main}, ${suggestion.secondary}` : suggestion.main;

/**
 * The state and requests behind the address search box: the query, the
 * suggestions and which one is active, and the place lookup when one is
 * chosen. Keystrokes are debounced and stale responses are dropped, so fast
 * typing doesn't send a request per letter or flash old results. With Google
 * suggestions arrive while typing; OpenStreetMap is searched only on request
 * (its usage policy).
 */
export function usePlaceSearch(provider: "google" | "osm", onSelect: (place: PickedPlace) => void) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<SearchStatus>({ text: "", problem: false });
  const announce = (text: string) => setStatus({ text, problem: false });
  const reportProblem = (text: string) => setStatus({ text, problem: true });
  const [firstSessionToken] = useState(newSessionToken); // generated once, not on every render
  const sessionToken = useRef(firstSessionToken); // one Google billing session per search
  // Counts requests so that only the latest one may update the list.
  const latestRequest = useRef(0);
  // Set when choose() fills the box with the picked place, so that text change doesn't trigger a new search.
  const skipNextSearch = useRef(false);
  const typeahead = provider === "google";
  const searchableQuery = query.trim().length >= MIN_PLACE_QUERY_CHARS ? query.trim() : null;

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

  useEffect(() => {
    if (!typeahead) return;
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }
    if (query.trim().length < MIN_PLACE_QUERY_CHARS) {
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

  return {
    query,
    setQuery,
    suggestions,
    open,
    setOpen,
    activeIndex,
    setActiveIndex,
    loading,
    status,
    typeahead,
    searchableQuery,
    search,
    choose,
  };
}
