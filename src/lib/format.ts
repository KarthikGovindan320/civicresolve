/**
 * Date formatting shared by the server and every screen, so dates read the
 * same in notifications, on the citizen pages and on the staff dashboard.
 */

/**
 * Formats a calendar day (YYYY-MM-DD), such as a promised fix date, as "24 Nov 2026":
 * the same style as every other date in the app, and easier to read aloud than ISO.
 */
export const formatDay = (isoDay: string) =>
  new Date(`${isoDay}T00:00:00Z`).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "UTC" });

/**
 * Formats an ISO timestamp as a date and time. Times are stored in UTC and
 * always displayed in Indian Standard Time, whatever timezone the server runs in.
 */
export const formatDateTime = (iso: string) =>
  new Date(iso)
    .toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })
    .replace(/\s(am|pm)$/i, " $1"); // keep "11:51 am" on one line
