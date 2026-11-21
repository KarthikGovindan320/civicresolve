/**
 * Display formatting shared by every screen, so dates and language names read
 * the same on the citizen pages and the staff dashboard.
 */

/** Formats a calendar day (YYYY-MM-DD), such as a promised fix date. */
export { fmtDay as formatDay } from "@/lib/types";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  ta: "Tamil",
  hi: "Hindi",
  te: "Telugu",
  kn: "Kannada",
  ml: "Malayalam",
};

/** Human-readable name for a language code, falling back to the upper-cased code. */
export const languageName = (code: string) => LANGUAGE_NAMES[code] ?? code.toUpperCase();

/**
 * Formats an ISO timestamp as a date and time. Times are stored in UTC and
 * always displayed in Indian Standard Time, whatever timezone the server runs in.
 */
export const formatDateTime = (iso: string) =>
  new Date(iso)
    .toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })
    .replace(/\s(am|pm)$/i, " $1"); // keep "11:51 am" on one line
