import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslator } from "@/lib/i18n/server";

/** Titles the public tracking page, a client component, in the visitor's language (WCAG 2.4.2). */
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslator())("track.heading") };
}

/** /track adds no layout of its own; this segment exists for its title. */
export default function TrackLayout({ children }: { children: ReactNode }) {
  return children;
}
