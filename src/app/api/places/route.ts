// =============================================================================
// [GOOGLE SERVICES][SECURITY] GET /api/places: address search proxy (see lib/places.ts)
// -----------------------------------------------------------------------------
//   ?q=<text>&session=<token>   → { provider, suggestions[] }   (autocomplete / search)
//   ?id=<placeId>&session=<tok> → { lat, lng, address }         (Google place details)
// The browser never talks to Google directly: the API key stays on the server, inputs are
// validated, and requests are rate-limited per IP so nobody can burn the Maps quota.
// =============================================================================
import { NextResponse } from "next/server";
import { autocomplete, logPlacesError, osmSearch, placeDetails, placesProvider } from "@/lib/places";
import { clientIp, rateLimit } from "@/lib/security";

// Google requires a URL-safe token of at most 36 characters (a UUID v4 fits exactly).
const SESSION = /^[A-Za-z0-9_-]{8,36}$/;
const PLACE_ID = /^[A-Za-z0-9_-]{8,300}$/;
const MAX_PER_WINDOW = 120; // typing is chatty; still far below anything abusive

export async function GET(req: Request) {
  const limit = rateLimit(`places:${clientIp(req)}`, Date.now(), MAX_PER_WINDOW);
  if (!limit.ok) return NextResponse.json({ error: "Too many searches. Please wait a moment." }, { status: 429 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  const id = url.searchParams.get("id") ?? "";
  const session = url.searchParams.get("session") ?? "";
  const provider = placesProvider();
  const headers = { "Cache-Control": "no-store" };

  try {
    if (id) {
      if (provider !== "google" || !PLACE_ID.test(id) || !SESSION.test(session))
        return NextResponse.json({ error: "Invalid place." }, { status: 400 });
      return NextResponse.json(await placeDetails(id, session), { headers });
    }
    if (q.length < 3) return NextResponse.json({ provider, suggestions: [] }, { headers });
    if (provider === "google") {
      if (!SESSION.test(session)) return NextResponse.json({ error: "Invalid session." }, { status: 400 });
      return NextResponse.json({ provider, suggestions: await autocomplete(q, session) }, { headers });
    }
    return NextResponse.json({ provider, suggestions: await osmSearch(q) }, { headers });
  } catch (e) {
    logPlacesError(e);
    // [CODE QUALITY] Search is a convenience: on failure the citizen can still tap the map.
    return NextResponse.json({ error: "Address search is unavailable right now. Tap the map instead." }, { status: 502 });
  }
}
