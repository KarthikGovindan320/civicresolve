"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/components/I18nProvider";
import LazyMap from "@/components/LazyMap";
import Stats from "@/components/Stats";
import { apiRequest } from "@/lib/client/api";
import type { PublicTicket } from "@/lib/types";
import MapLegend from "./MapLegend";
import TicketList from "./TicketList";
import TrackFilters from "./TrackFilters";

/**
 * Public issue tracking dashboard: every submitted complaint with its status.
 * Beyond a plain list it offers a ticket-ID lookup, filters by status and
 * category, a city map of all issues, and live transparency statistics. It is
 * public on purpose: citizens can see that problems get fixed, which builds
 * trust and encourages reporting.
 */
export default function TrackPage() {
  const t = useT();
  const router = useRouter();
  const [tickets, setTickets] = useState<PublicTicket[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [lookupId, setLookupId] = useState("");

  useEffect(() => {
    // Any failure (HTTP error or network) shows the page's own message, in the visitor's language.
    apiRequest<PublicTicket[]>("/api/tickets")
      .then((result) => (result.ok ? setTickets(result.data) : setLoadFailed(true)))
      .catch(() => setLoadFailed(true));
  }, []);

  // Filtering happens in the browser for an instant response; the map and the
  // list share the same filtered set, so they always agree.
  const visibleTickets = useMemo(
    () =>
      (tickets ?? []).filter(
        (ticket) =>
          (statusFilter === "all" || ticket.status === statusFilter) &&
          (categoryFilter === "all" || ticket.category === categoryFilter),
      ),
    [tickets, statusFilter, categoryFilter],
  );

  function openTicket(event: React.FormEvent) {
    event.preventDefault();
    if (lookupId.trim()) router.push(`/track/${lookupId.trim().toUpperCase()}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("track.heading")}</h1>
          <p className="text-slate-600">{t("track.intro")}</p>
        </div>
        <form onSubmit={openTicket} className="flex max-w-full gap-2">
          <label htmlFor="lookup" className="sr-only">
            {t("track.lookupLabel")}
          </label>
          <input
            id="lookup"
            value={lookupId}
            onChange={(event) => setLookupId(event.target.value)}
            placeholder={t("track.lookupPlaceholder")}
            className="w-48 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          <button className="whitespace-nowrap rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
            {t("track.find")}
          </button>
        </form>
      </div>

      {loadFailed && (
        <p role="alert" className="text-red-700">
          {t("track.loadError")}
        </p>
      )}
      {!tickets && !loadFailed && <p className="text-slate-600">{t("common.loading")}</p>}
      {tickets && (
        <>
          <Stats tickets={tickets} />
          <TrackFilters
            status={statusFilter}
            category={categoryFilter}
            onStatusChange={setStatusFilter}
            onCategoryChange={setCategoryFilter}
            shownCount={visibleTickets.length}
          />
          <LazyMap label={t("map.cityLabel")} tickets={visibleTickets} height={360} />
          <MapLegend />
          <TicketList tickets={visibleTickets} />
        </>
      )}
    </div>
  );
}
