"use client";

import { useEffect, useId, useRef } from "react";
import { LIMITS } from "@/lib/types";
import { useT } from "./I18nProvider";
import { fieldClass } from "./ui";
import { type PickedPlace, usePlaceSearch } from "./usePlaceSearch";

/** Delay before closing the list on blur, so a click on a suggestion still registers. */
const BLUR_CLOSE_DELAY_MS = 150;

/**
 * "Search an address or landmark" box above the report map. Typing "Katpadi
 * bus stand" shows suggestions; picking one moves the map there and places
 * the pin, which is much faster than dragging the map across the city.
 *
 * It follows the WAI-ARIA combobox pattern: a combobox input that controls a
 * listbox of options, Up/Down to move, Enter to choose, Escape to close, and
 * result counts announced through a live region. The searching itself lives
 * in usePlaceSearch.
 */
export default function AddressSearch({
  provider,
  onSelect,
}: {
  provider: "google" | "osm";
  onSelect: (place: PickedPlace) => void;
}) {
  const t = useT();
  const places = usePlaceSearch(provider, onSelect);
  const { suggestions, open, activeIndex, status, typeahead, searchableQuery } = places;
  const blurTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const listId = useId();

  // A pending blur-close must not fire after the component is gone.
  useEffect(() => () => clearTimeout(blurTimer.current), []);

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault();
      places.setOpen(true);
      places.setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault();
      places.setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault(); // never submit the whole report from the search box
      if (open && activeIndex >= 0 && suggestions[activeIndex]) places.choose(suggestions[activeIndex]);
      else if (searchableQuery) places.search(searchableQuery);
    } else if (event.key === "Escape") {
      places.setOpen(false);
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
          value={places.query}
          onChange={(event) => {
            places.setQuery(event.target.value);
            if (!typeahead) places.setOpen(false);
          }}
          onKeyDown={onKeyDown}
          aria-busy={places.loading}
          onBlur={() => {
            clearTimeout(blurTimer.current);
            blurTimer.current = setTimeout(() => places.setOpen(false), BLUR_CLOSE_DELAY_MS);
          }}
          onFocus={() => {
            clearTimeout(blurTimer.current);
            if (suggestions.length) places.setOpen(true);
          }}
          placeholder={t("search.placeholder")}
          maxLength={LIMITS.search}
          className={fieldClass}
        />
        {!typeahead && (
          <button
            type="button"
            onClick={() => searchableQuery && places.search(searchableQuery)}
            className="whitespace-nowrap rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
          >
            {t("search.button")}
          </button>
        )}
      </div>
      {places.loading && (
        <span className="absolute right-3 top-2.5 text-xs text-slate-600" aria-hidden="true">
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
                places.choose(suggestion);
              }}
              onMouseEnter={() => places.setActiveIndex(index)}
              className={`cursor-pointer px-3 py-2 text-sm ${index === activeIndex ? "bg-blue-50" : ""}`}
            >
              <span className="font-medium">{suggestion.main}</span>
              {suggestion.secondary && <span className="block text-xs text-slate-600">{suggestion.secondary}</span>}
            </li>
          ))}
          {/* Attribution required when showing predictions without a Google map: the text "Google Maps"
              (Places API policies), or the OpenStreetMap credit for the fallback. */}
          <li role="presentation" className="border-t border-slate-100 px-3 py-1 text-right text-[11px] text-slate-600">
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
