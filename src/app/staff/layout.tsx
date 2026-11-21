import type { Metadata } from "next";
import type { ReactNode } from "react";

/** Titles the staff portal, a client component; staff screens are English-only (WCAG 2.4.2). */
export const metadata: Metadata = { title: "Staff portal" };

/** /staff adds no layout of its own; this segment exists for its title. */
export default function StaffLayout({ children }: { children: ReactNode }) {
  return children;
}
