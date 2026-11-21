// =============================================================================
// GET /api/places: address search proxy (see lib/places.ts)
// -----------------------------------------------------------------------------
//   ?q=<text>&session=<token>   → { provider, suggestions[] }   (autocomplete / search)
//   ?id=<placeId>&session=<tok> → { lat, lng, address }         (Google place details)
// The browser never talks to Google directly: the API key stays on the server, inputs are
// validated, and requests are rate-limited per IP so nobody can burn the Maps quota.
// =============================================================================
import { NextResponse } from "next/server";
import { MIN_PLACE_QUERY_CHARS } from "@/lib/constants";
import { NO_STORE_HEADERS, fail, failWith, spendBudget } from "@/lib/http";
import { autocomplete, logPlacesError, osmSearch, placeDetails, placesProvider } from "@/lib/places";
import { LIMITS } from "@/lib/types";

// Google requires a URL-safe token of at most 36 characters (a UUID v4 fits exactly).
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,36}$/;
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{8,300}$/;
/** Typing is chatty, so search gets a larger budget; still far below anything abusive. */
const SEARCH_BUDGET = { bucket: "places", max: 120, message: "Too many searches. Please wait a moment." };

/** Resolve a chosen Google suggestion to coordinates and an address (Google provider only). */
async function lookupPlace(placeId: string, session: string) {
  if (placesProvider() !== "google" || !PLACE_ID_PATTERN.test(placeId) || !SESSION_TOKEN_PATTERN.test(session))
    return fail(400, "Invalid place.");
  return NextResponse.json(await placeDetails(placeId, session), { headers: NO_STORE_HEADERS });
}

/** Suggestions for what the citizen typed: Google autocomplete, or an OpenStreetMap search. */
async function searchPlaces(query: string, session: string) {
  const provider = placesProvider();
  if (query.length < MIN_PLACE_QUERY_CHARS)
    return NextResponse.json({ provider, suggestions: [] }, { headers: NO_STORE_HEADERS });
  if (provider === "osm")
    return NextResponse.json({ provider, suggestions: await osmSearch(query) }, { headers: NO_STORE_HEADERS });
  if (!SESSION_TOKEN_PATTERN.test(session)) return fail(400, "Invalid session.");
  return NextResponse.json(
    { provider, suggestions: await autocomplete(query, session) },
    { headers: NO_STORE_HEADERS },
  );
}

/** Search for an address (`q`) or resolve a chosen Google suggestion to coordinates (`id`). */
export async function GET(req: Request) {
  const overBudget = spendBudget(req, SEARCH_BUDGET);
  if (overBudget) return failWith(overBudget);

  const params = new URL(req.url).searchParams;
  const session = params.get("session") ?? "";
  const placeId = params.get("id") ?? "";
  try {
    if (placeId) return await lookupPlace(placeId, session);
    return await searchPlaces((params.get("q") ?? "").trim().slice(0, LIMITS.search), session);
  } catch (error) {
    logPlacesError(error);
    // Search is a convenience: on failure the citizen can still tap the map.
    return fail(502, "Address search is unavailable right now. Tap the map instead.");
  }
}
