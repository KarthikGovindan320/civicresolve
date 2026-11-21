"use client";

import { useState } from "react";
import AddressSearch from "@/components/AddressSearch";
import { useT } from "@/components/I18nProvider";
import LazyMap from "@/components/LazyMap";
import type { PickedPlace } from "@/components/usePlaceSearch";
import type { Coordinates } from "@/lib/types";

const MAP_HELP_ID = "map-help";

/**
 * The location section of the report form, with three ways to set the issue's
 * location: "Use my location" (GPS), an address search, or the map itself
 * (tap, or pan with the arrow keys and press Enter). The chosen location is
 * announced politely to screen readers.
 */
export default function LocationPicker({
  location,
  onLocationChange,
  onPlaceChosen,
  onError,
  searchProvider,
  errorId,
}: {
  location: Coordinates | null;
  onLocationChange: (location: Coordinates) => void;
  /** Called with the address of a place picked in the search box. */
  onPlaceChosen: (place: PickedPlace) => void;
  /** Shows a problem (no GPS, location refused) in the form's alert. */
  onError: (message: string) => void;
  searchProvider: "google" | "osm";
  /** Id of the form's error message while it is about the location, so the map is described by it. */
  errorId?: string;
}) {
  const t = useT();
  const [locating, setLocating] = useState(false);

  function locateMe() {
    if (!navigator.geolocation) return onError(t("report.error.noGeolocation"));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onLocationChange({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocating(false);
      },
      () => {
        onError(t("report.error.locationFailed"));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3">
        <span className="text-sm font-medium">{t("report.location")}</span>
        <button
          type="button"
          onClick={locateMe}
          disabled={locating}
          className="inline-flex min-h-6 items-center text-sm font-medium text-blue-700 underline disabled:opacity-50"
        >
          {locating ? t("report.locating") : t("report.useMyLocation")}
        </button>
      </div>
      {/* Typing an address shows place suggestions; choosing one moves the map there and pins it. */}
      <div className="mb-2">
        <AddressSearch
          provider={searchProvider}
          onSelect={(place) => {
            onLocationChange({ lat: place.lat, lng: place.lng });
            onPlaceChosen(place);
          }}
        />
      </div>
      <LazyMap
        label={t("map.pickerLabel")}
        describedBy={errorId ? `${MAP_HELP_ID} ${errorId}` : MAP_HELP_ID}
        picked={location}
        onPick={onLocationChange}
        height={320}
      />
      <p id={MAP_HELP_ID} className="mt-1 text-xs text-slate-600">
        <span className="sm:hidden">{t("report.mapHelpTouch")}</span>
        <span className="max-sm:sr-only">{t("report.mapHelpKeyboard")}</span>
      </p>
      <p className="text-xs text-slate-600" aria-live="polite">
        {location
          ? t("report.pinnedAt", { lat: location.lat.toFixed(5), lng: location.lng.toFixed(5) })
          : t("report.noLocation")}
      </p>
    </div>
  );
}
