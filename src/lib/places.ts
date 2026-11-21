// =============================================================================
// Address search: Google Places API (New) autocomplete
// -----------------------------------------------------------------------------
// Dragging a map across a whole city to find your street is slow, and hard for many users.
// Citizens can instead type an address or landmark ("CMC hospital", "Katpadi bus stand") and
// pick from Google's suggestions; the map then jumps to that exact spot.
//   1. places:autocomplete → suggestions as the citizen types (biased to Vellore, India only)
//   2. places/{id}          → the chosen place's coordinates + formatted address
// Called only from our server (api/places), so the Maps key never reaches the
// browser and the Content-Security-Policy stays strict (connect-src 'self').
// A session token groups the keystrokes and the final details lookup into one
// billed Google "session"; the browser also debounces keystrokes (AddressSearch.tsx).
// Zero-config fallback: with no GOOGLE_MAPS_API_KEY, the same box does a plain search
// against OpenStreetMap Nominatim, run on Enter only, because Nominatim's usage policy forbids
// typeahead.
// =============================================================================
import "server-only";
import { describeError, log } from "./log";

/** One entry in the address dropdown. */
export interface PlaceSuggestion {
  id: string;
  main: string;
  secondary: string;
  /** Present for OpenStreetMap results (they already include coordinates). */
  lat?: number;
  lng?: number;
}

/** A resolved place: where the map should jump to. */
export interface PlaceLocation {
  lat: number;
  lng: number;
  address: string;
}

// Results are biased (not restricted) to the city this deployment serves.
const CITY_BIAS = {
  lat: Number(process.env.CITY_LAT || 12.9165),
  lng: Number(process.env.CITY_LNG || 79.1325),
  radiusM: 50_000, // the largest bias circle the Places API accepts
};
/** Half-width of the OpenStreetMap view box in degrees: roughly 50 km around the city. */
const OSM_VIEWBOX_HALF_WIDTH_DEG = 0.5;
const REQUEST_TIMEOUT_MS = 5000;
const MAX_SUGGESTIONS = 5;
/** How many parts of an OpenStreetMap address follow the place name in the dropdown. */
const OSM_SECONDARY_PARTS = 3;
const MAX_LOGGED_PLACES_ERROR_CHARS = 80;
const GOOGLE_PLACES_URL = "https://places.googleapis.com/v1";

const mapsApiKey = () => process.env.GOOGLE_MAPS_API_KEY ?? "";

/** Which search backend is active: Google when a Maps key is configured, otherwise OpenStreetMap. */
export const placesProvider = (): "google" | "osm" => (mapsApiKey() ? "google" : "osm");

/** Google Places API (New): autocomplete suggestions for what the citizen has typed so far. */
export async function autocomplete(input: string, sessionToken: string): Promise<PlaceSuggestion[]> {
  const res = await fetch(`${GOOGLE_PLACES_URL}/places:autocomplete`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Goog-Api-Key": mapsApiKey() },
    body: JSON.stringify({
      input,
      sessionToken,
      includedRegionCodes: ["in"],
      languageCode: "en",
      locationBias: {
        circle: { center: { latitude: CITY_BIAS.lat, longitude: CITY_BIAS.lng }, radius: CITY_BIAS.radiusM },
      },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
    .map((suggestion) => suggestion.placePrediction)
    .filter((prediction): prediction is NonNullable<typeof prediction> => Boolean(prediction?.placeId))
    .slice(0, MAX_SUGGESTIONS)
    .map((prediction) => ({
      id: prediction.placeId,
      main: prediction.structuredFormat?.mainText?.text ?? prediction.text?.text ?? "",
      secondary: prediction.structuredFormat?.secondaryText?.text ?? "",
    }));
}

/** Google Places API (New): coordinates and formatted address of the chosen suggestion. */
export async function placeDetails(placeId: string, sessionToken: string): Promise<PlaceLocation> {
  const url = `${GOOGLE_PLACES_URL}/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`;
  const res = await fetch(url, {
    // Field mask: only Essentials-tier fields. Adding displayName (a Pro field) would bill the
    // whole autocomplete session at a higher tier; the browser already has the place's name from the suggestion.
    headers: { "X-Goog-Api-Key": mapsApiKey(), "X-Goog-FieldMask": "location,formattedAddress" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`places_details_${res.status}`);
  const place = (await res.json()) as { location?: { latitude: number; longitude: number }; formattedAddress?: string };
  if (!place.location) throw new Error("places_details_no_location");
  return { lat: place.location.latitude, lng: place.location.longitude, address: place.formattedAddress ?? "" };
}

/** Fallback without a Google key: OpenStreetMap Nominatim search (on Enter only, never per keystroke). */
export async function osmSearch(query: string): Promise<PlaceSuggestion[]> {
  // The view box around the city is preferred but not exclusive.
  const { lat, lng } = CITY_BIAS;
  const halfWidth = OSM_VIEWBOX_HALF_WIDTH_DEG;
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: String(MAX_SUGGESTIONS),
    countrycodes: "in",
    viewbox: `${lng - halfWidth},${lat + halfWidth},${lng + halfWidth},${lat - halfWidth}`,
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    // Nominatim's policy asks every application to identify itself.
    headers: { "User-Agent": "CivicResolve/1.0 (civic issue reporting app)", "Accept-Language": "en" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`osm_search_${res.status}`);
  const rows = (await res.json()) as { place_id: number; display_name: string; lat: string; lon: string }[];
  return rows.map((row) => {
    const [main, ...addressParts] = row.display_name.split(", ");
    return {
      id: `osm-${row.place_id}`,
      main,
      secondary: addressParts.slice(0, OSM_SECONDARY_PARTS).join(", "),
      lat: Number(row.lat),
      lng: Number(row.lon),
    };
  });
}

/** Log a failed address search by error code only, never what the citizen typed (it may be their address). */
export function logPlacesError(error: unknown) {
  log.warn("places_failed", {
    error: describeError(error instanceof Error ? error.message : error, MAX_LOGGED_PLACES_ERROR_CHARS),
  });
}
