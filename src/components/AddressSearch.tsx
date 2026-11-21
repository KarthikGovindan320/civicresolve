"use client";

// =============================================================================
// [GOOGLE SERVICES][ACCESSIBILITY] "Search an address or landmark" box above the report map
// -----------------------------------------------------------------------------
// Type "Katpadi bus stand" → Google Places suggestions → pick one → the map jumps there and
// the pin is placed. Much faster than dragging the map across the city.
// [ACCESSIBILITY] WAI-ARIA combobox pattern: role="combobox" with aria-expanded /
// aria-controls / aria-activedescendant, a role="listbox" of role="option"s, ↑/↓ to move,
// Enter to choose, Escape to close, and result counts announced through aria-live.
// [EFFICIENCY] Keystrokes are debounced (300 ms, 3+ characters) and stale responses are
// dropped, so fast typing doesn't trigger a request per letter or flash old results.
// =============================================================================

import { useEffect, useId, useRef, useState } from "react";

export interface PickedPlace {
  lat: number;
  lng: number;
  address: string;
}

interface Suggestion {
  id: string;
  main: string;
  secondary: string;
  lat?: number;
  lng?: number;
}

// Google's session token: URL-safe, at most 36 characters. randomUUID() needs a secure context
// (HTTPS or localhost); on plain-HTTP LAN testing, fall back to 32 random hex characters.
const newSession = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

export default function AddressSearch({ provider, onSelect }: { provider: "google" | "osm"; onSelect: (p: PickedPlace) => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const session = useRef(newSession()); // one Google billing session per search
  const reqNo = useRef(0);
  // Set when choose() fills the box with the picked place, so that text change doesn't trigger a new search.
  const skipSearch = useRef(false);
  const listId = useId();
  const typeahead = provider === "google";

  async function search(text: string) {
    const n = ++reqNo.current;
    setLoading(true);
    try {
      const r = await fetch(`/api/places?q=${encodeURIComponent(text)}&session=${session.current}`);
      const data = await r.json();
      if (n !== reqNo.current) return; // a newer request has already been sent
      if (!r.ok) {
        setItems([]);
        setStatus(data.error ?? "Search failed.");
        return;
      }
      setItems(data.suggestions);
      setActive(data.suggestions.length ? 0 : -1);
      setOpen(true);
      setStatus(data.suggestions.length ? `${data.suggestions.length} suggestions. Use the arrow keys to choose.` : "No matches. Try a nearby landmark.");
    } catch {
      if (n === reqNo.current) setStatus("Search failed. Tap the map instead.");
    } finally {
      if (n === reqNo.current) setLoading(false);
    }
  }

  // Google: suggestions while typing (debounced). OpenStreetMap: only on Enter (its usage policy).
  useEffect(() => {
    if (!typeahead) return;
    if (skipSearch.current) {
      skipSearch.current = false;
      return;
    }
    if (q.trim().length < 3) {
      reqNo.current++;
      return;
    }
    const t = setTimeout(() => search(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q, typeahead]);

  async function choose(s: Suggestion) {
    setOpen(false);
    reqNo.current++; // drop any search still in flight
    skipSearch.current = true;
    setQ(s.secondary ? `${s.main}, ${s.secondary}` : s.main);
    if (s.lat !== undefined && s.lng !== undefined) {
      onSelect({ lat: s.lat, lng: s.lng, address: s.secondary ? `${s.main}, ${s.secondary}` : s.main });
      setStatus(`Pinned ${s.main} on the map.`);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`/api/places?id=${encodeURIComponent(s.id)}&session=${session.current}`);
      const data = await r.json();
      if (!r.ok) return setStatus(data.error ?? "Couldn't find that place. Tap the map instead.");
      // "Katpadi Bus Stand, Katpadi, Vellore…": keep the name the citizen picked in front of Google's address.
      const addr: string = data.address ?? "";
      onSelect({ lat: data.lat, lng: data.lng, address: addr.startsWith(s.main) ? addr : `${s.main}, ${addr}` });
      setStatus(`Pinned ${s.main} on the map.`);
    } catch {
      setStatus("Couldn't find that place. Tap the map instead.");
    } finally {
      setLoading(false);
      session.current = newSession(); // the details call ends this billing session
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && items.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp" && items.length) {
      e.preventDefault();
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault(); // never submit the whole report from the search box
      if (open && active >= 0 && items[active]) choose(items[active]);
      else if (q.trim().length >= 3) search(q.trim());
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div className="relative">
      <label htmlFor={`${listId}-input`} className="sr-only">Search an address or landmark</label>
      <div className="flex gap-2">
        <input
          id={`${listId}-input`}
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          value={q}
          onChange={(e) => { setQ(e.target.value); if (!typeahead) setOpen(false); }}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => items.length && setOpen(true)}
          placeholder="Street or landmark, e.g. Katpadi bus stand"
          maxLength={120}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
        />
        {!typeahead && (
          <button type="button" onClick={() => q.trim().length >= 3 && search(q.trim())}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Search</button>
        )}
      </div>
      {loading && <span className="absolute right-3 top-2.5 text-xs text-slate-500" aria-hidden="true">…</span>}

      {open && items.length > 0 && (
        <ul id={listId} role="listbox" aria-label="Address suggestions"
          className="absolute z-[1200] mt-1 w-full overflow-hidden rounded-md bg-white shadow-lg ring-1 ring-slate-200">
          {items.map((s, i) => (
            <li key={s.id} id={optionId(i)} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); choose(s); }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-blue-50" : ""}`}>
              <span className="font-medium">{s.main}</span>
              {s.secondary && <span className="block text-xs text-slate-600">{s.secondary}</span>}
            </li>
          ))}
          {/* Attribution required when showing predictions without a Google map: the text "Google Maps"
              (Places API policies), or the OpenStreetMap credit for the fallback. */}
          <li role="presentation" className="border-t border-slate-100 px-3 py-1 text-right text-[11px] text-slate-500">
            {typeahead ? "Google Maps" : "Search by OpenStreetMap Nominatim"}
          </li>
        </ul>
      )}
      <p className="sr-only" aria-live="polite">{status}</p>
      {status && !open && /fail|unavailable|No matches|Couldn/.test(status) && (
        <p className="mt-1 text-xs text-amber-800">{status}</p>
      )}
    </div>
  );
}
