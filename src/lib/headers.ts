/**
 * Request headers shared by the browser and the server. Secrets travel in
 * headers rather than in a JSON body or a query string, so they are never
 * logged with the payload.
 */

/** Carries the staff passcode; the server derives the role from it. */
export const STAFF_KEY_HEADER = "x-staff-key";

/** Carries the citizen's private-link token. */
export const CITIZEN_KEY_HEADER = "x-citizen-key";
