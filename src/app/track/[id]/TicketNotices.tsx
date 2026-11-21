import Interpolate from "@/components/Interpolate";
import type { Translate } from "@/lib/i18n";
import type { Verification } from "@/lib/types";

/**
 * Banners shown under the header: the report is held for review, the report
 * was rejected, or the private link in the address does not match this ticket.
 */
export default function TicketNotices({
  verification,
  department,
  badLink,
  t,
}: {
  verification?: Verification;
  department: string;
  badLink: boolean;
  t: Translate;
}) {
  return (
    <>
      {verification === "unverified" && (
        <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <Interpolate message={t("ticket.heldNotice")} values={{ department: <span lang="en">{department}</span> }} />
        </p>
      )}
      {verification === "rejected" && (
        <p role="status" className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-800">
          {t("ticket.rejectedNotice")}
        </p>
      )}

      {badLink && (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t("ticket.badLink")}
        </p>
      )}
    </>
  );
}
