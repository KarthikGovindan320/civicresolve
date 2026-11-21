// =============================================================================
// [GOOGLE SERVICES][ACCESSIBILITY] ADDRESS SEARCH: Google Places API (New) autocomplete
// -----------------------------------------------------------------------------
// Dragging a map across a whole city to find your street is slow, and hard for many users.
// Citizens can instead TYPE an address or landmark ("CMC hospital", "Katpadi bus stand") and
// pick from Google's suggestions; the map then jumps to that exact spot.
//   1. places:autocomplete → suggestions as the citizen types (biased to Vellore, India only)
//   2. places/{id}          → the chosen place's coordinates + formatted address
// [SECURITY] Called only from our server (api/places), so the Maps key never reaches the
// browser and the Content-Security-Policy stays strict (connect-src 'self').
// [EFFICIENCY] A session token groups the keystrokes and the final details lookup into ONE
// billed Google "session"; the browser also debounces keystrokes (AddressSearch.tsx).
// Zero-config fallback: with no GOOGLE_MAPS_API_KEY, the same box does a plain search
// against OpenStreetMap Nominatim, run on Enter only, because Nominatim's usage policy forbids
// typeahead.
// =============================================================================
import "server-only";
import { log } from "./log";

export interface PlaceSuggestion {
  id: string;
  main: string;
  secondary: string;
  /** Present for OpenStreetMap results (they already include coordinates). */
  lat?: number;
  lng?: number;
}

export interface PlaceLocation {
  lat: number;
  lng: number;
  address: string;
}

// Results are biased (not restricted) to the city this deployment serves.
const BIAS = {
  lat: Number(process.env.CITY_LAT || 12.9165),
  lng: Number(process.env.CITY_LNG || 79.1325),
  radiusM: 50_000, // the largest bias circle the Places API accepts
};
const TIMEOUT_MS = 5000;

const key = () => process.env.GOOGLE_MAPS_API_KEY;
export const placesProvider = (): "google" | "osm" => (key() ? "google" : "osm");

/** Google Places API (New): autocomplete suggestions for what the citizen has typed so far. */
export async function autocomplete(input: string, sessionToken: string): Promise<PlaceSuggestion[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Goog-Api-Key": key()! },
    body: JSON.stringify({
      input,
      sessionToken,
      includedRegionCodes: ["in"],
      languageCode: "en",
      locationBias: { circle: { center: { latitude: BIAS.lat, longitude: BIAS.lng }, radius: BIAS.radiusM } },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`places_autocomplete_${res.status}`);
  const data = (await res.json()) as {
    suggestions?: {
      placePrediction?: {
        placeId: string;
        text?: { text: string };
        structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } };
      };
    }[];
  };
  return (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
    .slice(0, 5)
    .map((p) => ({
      id: p.placeId,
      main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
      secondary: p.structuredFormat?.secondaryText?.text ?? "",
    }));
}

/** Google Places API (New): coordinates and formatted address of the chosen suggestion. */
export async function placeDetails(placeId: string, sessionToken: string): Promise<PlaceLocation> {
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`;
  const res = await fetch(url, {
    // [EFFICIENCY] Field mask: only Essentials-tier fields. Adding displayName (a Pro field) would bill the
    // whole autocomplete session at a higher tier; the browser already has the place's name from the suggestion.
    headers: { "X-Goog-Api-Key": key()!, "X-Goog-FieldMask": "location,formattedAddress" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`places_details_${res.status}`);
  const p = (await res.json()) as { location?: { latitude: number; longitude: number }; formattedAddress?: string };
  if (!p.location) throw new Error("places_details_no_location");
  return { lat: p.location.latitude, lng: p.location.longitude, address: p.formattedAddress ?? "" };
}

/** Fallback without a Google key: OpenStreetMap Nominatim search (on Enter only, never per keystroke). */
export async function osmSearch(q: string): Promise<PlaceSuggestion[]> {
  const d = 0.5; // ~50 km view box around the city, preferred but not exclusive
  const params = new URLSearchParams({
    q,
    format: "jsonv2",
    limit: "5",
    countrycodes: "in",
    viewbox: `${BIAS.lng - d},${BIAS.lat + d},${BIAS.lng + d},${BIAS.lat - d}`,
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    // Nominatim's policy asks every application to identify itself.
    headers: { "User-Agent": "CivicResolve/1.0 (civic issue reporting app)", "Accept-Language": "en" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`osm_search_${res.status}`);
  const rows = (await res.json()) as { place_id: number; display_name: string; lat: string; lon: string }[];
  return rows.map((r) => {
    const [main, ...rest] = r.display_name.split(", ");
    return { id: `osm-${r.place_id}`, main, secondary: rest.slice(0, 3).join(", "), lat: Number(r.lat), lng: Number(r.lon) };
  });
}

export function logPlacesError(e: unknown) {
  // [SECURITY] Log the error code only, never what the citizen typed (it may be their address).
  log.warn("places_failed", { error: String(e instanceof Error ? e.message : e).slice(0, 80) });
}
