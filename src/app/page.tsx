import { getTranslator } from "@/lib/i18n/server";
import { placesProvider } from "@/lib/places";
import ReportForm from "./ReportForm";

// Rendered per request: whether Google Places is enabled comes from a runtime secret on Cloud Run,
// which isn't present at build time, so a prerendered page would always fall back to OpenStreetMap.
export const dynamic = "force-dynamic";

/**
 * Landing page: the reporting form itself, so the most important action
 * (reporting a problem) is zero clicks away for a citizen who opens the link.
 */
export default async function Home() {
  const t = await getTranslator();
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("report.heading")}</h1>
        <p className="mt-1 text-slate-600">{t("report.intro")}</p>
      </div>
      {/* Address search uses Google Places when a Maps key is configured, and OpenStreetMap otherwise. */}
      <ReportForm searchProvider={placesProvider()} />
    </>
  );
}
