// Address search proxy (api/places + lib/places), with Google's
// HTTP API stubbed so the suite stays offline. Checks request shape, response parsing, the
// OpenStreetMap fallback and input validation.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let route: typeof import("@/app/api/places/route");
beforeAll(async () => {
  route = await import("@/app/api/places/route");
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_MAPS_API_KEY;
});

let ip = 0;
const get = (qs: string) =>
  route.GET(new Request(`http://t/api/places?${qs}`, { headers: { "x-forwarded-for": `50.0.0.${++ip}` } }));
const SESSION = "3519edfe-0f75-4a30-bfe4-7cbd89340b2c";

describe("address search with Google Places API (New)", () => {
  it("sends a Vellore-biased autocomplete request and parses suggestions", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    const fetchMock = vi.fn(async () =>
      Response.json({
        suggestions: [
          {
            placePrediction: {
              placeId: "ChIJabc123xyz",
              text: { text: "Katpadi Bus Stand, Vellore" },
              structuredFormat: {
                mainText: { text: "Katpadi Bus Stand" },
                secondaryText: { text: "Katpadi, Vellore" },
              },
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const body = await (await get(`q=katpadi&session=${SESSION}`)).json();
    expect(body).toEqual({
      provider: "google",
      suggestions: [{ id: "ChIJabc123xyz", main: "Katpadi Bus Stand", secondary: "Katpadi, Vellore" }],
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    const sent = JSON.parse(String(init.body));
    expect(sent.sessionToken).toBe(SESSION);
    expect(sent.includedRegionCodes).toEqual(["in"]);
    expect(sent.locationBias.circle.radius).toBeLessThanOrEqual(50_000);
  });

  it("looks up coordinates with an Essentials-only field mask", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    const fetchMock = vi.fn(async () =>
      Response.json({ location: { latitude: 12.97, longitude: 79.13 }, formattedAddress: "Katpadi, Vellore" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const body = await (await get(`id=ChIJabc123xyz&session=${SESSION}`)).json();
    expect(body).toEqual({ lat: 12.97, lng: 79.13, address: "Katpadi, Vellore" });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe("location,formattedAddress");
  });

  it("rejects bad session tokens and place ids, and degrades gracefully when Google fails", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    expect((await get(`q=katpadi&session=${"x".repeat(40)}`)).status).toBe(400);
    expect((await get(`id=../../etc&session=${SESSION}`)).status).toBe(400);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("quota", { status: 429 })),
    );
    const res = await get(`q=katpadi&session=${SESSION}`);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/tap the map/i);
  });

  it("treats an answer of the wrong shape as a failure, never as a half-filled place", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ formattedAddress: "Somewhere" })), // no coordinates
    );
    expect((await get(`id=ChIJabc123xyz&session=${SESSION}`)).status).toBe(502);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>error page</html>")),
    );
    expect((await get(`q=katpadi&session=${SESSION}`)).status).toBe(502);
  });
});

describe("fallback without a Google key", () => {
  it("uses OpenStreetMap search, returning coordinates directly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          { place_id: 1, display_name: "CMC Hospital, NH38, Kosapet, Vellore, Tamil Nadu", lat: "12.92", lon: "79.13" },
        ]),
      ),
    );
    const body = await (await get("q=cmc%20hospital")).json();
    expect(body.provider).toBe("osm");
    expect(body.suggestions[0]).toMatchObject({ main: "CMC Hospital", lat: 12.92, lng: 79.13 });
  });
  it("rejects OpenStreetMap rows without coordinates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([{ place_id: 2, display_name: "Nowhere" }])),
    );
    expect((await get("q=nowhere")).status).toBe(502);
  });
  it("ignores queries shorter than 3 characters without calling anything", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await (await get("q=ab")).json()).suggestions).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
