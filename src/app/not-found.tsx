import type { Metadata } from "next";
import NotFoundNotice from "@/components/NotFoundNotice";
import { getTranslator } from "@/lib/i18n/server";

/** Titles the page as not found, in the visitor's language. */
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslator())("notFound.title") };
}

/** Shown for any unknown address, inside the normal site header and footer. */
export default function NotFound() {
  return <NotFoundNotice kind="page" />;
}
