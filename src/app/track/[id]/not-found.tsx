import NotFoundNotice from "@/components/NotFoundNotice";

/** Shown when a ticket id does not exist or the report is not public. */
export default function TicketNotFound() {
  return <NotFoundNotice kind="ticket" />;
}
