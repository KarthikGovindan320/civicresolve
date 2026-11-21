import type { Priority, Status } from "@/lib/types";

// [ACCESSIBILITY][CODE QUALITY] Shared visual language for priority and status, used on every screen and on
// the map, so "red = Critical" means the same thing everywhere. Badges always
// show the text label too, so meaning never depends on colour alone (accessibility).
export const PRIORITY_COLOR: Record<Priority, string> = {
  Critical: "#b91c1c",
  High: "#ea580c",
  Medium: "#ca8a04",
  Low: "#16a34a",
};

const PRIORITY_CLASS: Record<Priority, string> = {
  Critical: "bg-red-100 text-red-800 ring-red-300",
  High: "bg-orange-100 text-orange-800 ring-orange-300",
  Medium: "bg-yellow-100 text-yellow-900 ring-yellow-300",
  Low: "bg-green-100 text-green-800 ring-green-300",
};

const STATUS_CLASS: Record<Status, string> = {
  Reported: "bg-slate-100 text-slate-800 ring-slate-300",
  "In Progress": "bg-blue-100 text-blue-800 ring-blue-300",
  Resolved: "bg-emerald-100 text-emerald-800 ring-emerald-300",
};

const base = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap";

export function PriorityBadge({ p }: { p: Priority }) {
  return <span className={`${base} ${PRIORITY_CLASS[p]}`}>{p}</span>;
}

export function StatusBadge({ s }: { s: Status }) {
  return <span className={`${base} ${STATUS_CLASS[s]}`}>{s}</span>;
}

const LANG: Record<string, string> = { en: "English", ta: "Tamil", hi: "Hindi", te: "Telugu", kn: "Kannada", ml: "Malayalam" };
export const langName = (code: string) => LANG[code] ?? code.toUpperCase();

// Times are stored in UTC (ISO) and always displayed in Indian Standard Time,
// whatever timezone the Cloud Run server runs in.
export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
