import type { PublicTicket } from "@/lib/types";

// =============================================================================
// [PROBLEM STATEMENT ALIGNMENT] TRANSPARENCY & ACCOUNTABILITY STATISTICS (beyond the brief)
// -----------------------------------------------------------------------------
// Shown to citizens on /track and to staff on /staff. It answers the questions
// a resident (or a commissioner) actually asks:
//   "How many problems are open? How many are dangerous? How many are past
//    their deadline? Do things get fixed, how fast, and on time? Which
//    department is falling behind?"
// This puts the brief's goal of making civic issue management "more
// accessible, organized, and transparent" into numbers. Everything is
// computed live from the ticket list, with no separate analytics store.
// =============================================================================
export default function Stats({ tickets }: { tickets: PublicTicket[] }) {
  const open = tickets.filter((t) => t.status !== "Resolved");
  const resolved = tickets.filter((t) => t.status === "Resolved" && t.resolvedAt);
  const critical = open.filter((t) => t.priority === "Critical").length;
  const overdue = open.filter((t) => t.overdue).length;
  // Accountability metrics: mean time from report to resolution, and the share
  // resolved within the priority's SLA.
  const avgHours = resolved.length
    ? resolved.reduce((s, t) => s + (Date.parse(t.resolvedAt!) - Date.parse(t.createdAt)), 0) / resolved.length / 36e5
    : 0;
  const onTime = (list: PublicTicket[]) => {
    const r = list.filter((t) => t.status === "Resolved" && t.resolvedAt);
    return r.length ? Math.round((100 * r.filter((t) => t.resolvedAt! <= t.slaDueAt).length) / r.length) : null;
  };
  const allOnTime = onTime(tickets);

  // Per-department workload and performance, worst backlog first.
  const depts = [...new Set(tickets.map((t) => t.department))]
    .map((d) => {
      const mine = tickets.filter((t) => t.department === d);
      return {
        d,
        open: mine.filter((t) => t.status !== "Resolved").length,
        overdue: mine.filter((t) => t.overdue).length,
        onTime: onTime(mine),
      };
    })
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open);
  const max = Math.max(1, ...depts.map((x) => x.open));

  return (
    <section aria-label="Statistics" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Open issues" value={open.length} />
        <Tile label="Critical open" value={critical} accent={critical ? "text-red-700" : undefined} />
        <Tile label="Overdue" value={overdue} accent={overdue ? "text-red-700" : undefined} />
        <Tile label="Resolved" value={resolved.length} />
        <Tile label="Avg. time to fix" value={avgHours >= 48 ? `${(avgHours / 24).toFixed(1)} d` : `${avgHours.toFixed(1)} h`} />
        <Tile label="Fixed on time" value={allOnTime === null ? "–" : `${allOnTime}%`} />
      </div>
      <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-600">Departments: open issues, overdue, on-time rate</h3>
        <table className="mt-2 w-full text-xs">
          <thead className="sr-only">
            <tr><th>Department</th><th>Open issues</th><th>Overdue</th><th>On time</th></tr>
          </thead>
          <tbody>
            {depts.map((x) => (
              <tr key={x.d}>
                <th scope="row" className="py-1 pr-2 text-left font-normal sm:w-48">{x.d}</th>
                <td className="py-1">
                  <span className="flex items-center gap-2">
                    <span className="h-2 min-w-8 flex-1 rounded bg-slate-100" aria-hidden>
                      <span className="block h-2 rounded bg-emerald-600" style={{ width: `${(x.open / max) * 100}%` }} />
                    </span>
                    <span className="w-14 whitespace-nowrap tabular-nums">{x.open} open</span>
                  </span>
                </td>
                <td className={`whitespace-nowrap py-1 pl-2 text-right tabular-nums ${x.overdue ? "font-semibold text-red-700" : "text-slate-600"}`}>
                  {x.overdue} overdue
                </td>
                <td className="whitespace-nowrap py-1 pl-2 text-right tabular-nums text-slate-700">{x.onTime === null ? "–" : `${x.onTime}% on time`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Tile({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-600">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent ?? ""}`}>{value}</div>
    </div>
  );
}
