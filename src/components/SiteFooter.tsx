"use client";

import { useT } from "./I18nProvider";

/** Page footer; the product name stays in English in every language. */
export default function SiteFooter() {
  const t = useT();
  return (
    <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-600">
      <span lang="en">CivicResolve</span> · {t("footer.poweredBy")}
    </footer>
  );
}
