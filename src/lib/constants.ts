/**
 * Values the browser and the server must agree on, kept in one place so the
 * two sides can never drift apart.
 */

/** Where maps open and where address search is biased: Vellore, Tamil Nadu. */
export const CITY_CENTRE = { lat: 12.9165, lng: 79.1325 } as const;

/** Shortest address-search query worth sending (shorter ones match too much). */
export const MIN_PLACE_QUERY_CHARS = 3;

/** Length of the one-time code sent to a citizen's phone. */
export const OTP_DIGITS = 6;

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
