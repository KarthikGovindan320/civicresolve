import { placesProvider } from "@/lib/places";
import ReportForm from "./ReportForm";

// Rendered per request: whether Google Places is enabled comes from a RUNTIME secret on Cloud Run,
// which isn't present at build time, so a prerendered page would always fall back to OpenStreetMap.
export const dynamic = "force-dynamic";

// Landing page = the reporting form. The most important action (reporting a
// problem) is zero clicks away for a citizen who opens the link.
export default function Home() {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Report a civic issue</h1>
        <p className="mt-1 text-slate-600">
          Potholes, garbage, streetlights, leaks. Type or speak in any language; AI routes it to the right department.
        </p>
      </div>
      {/* [GOOGLE SERVICES] Google Places autocomplete when a Maps key is configured, OpenStreetMap search otherwise. */}
      <ReportForm searchProvider={placesProvider()} />
    </>
  );
}
