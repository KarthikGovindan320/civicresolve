import type { Department, PrivateTicket, PublicTicket } from "@/lib/types";

/** Who is signed in to the staff portal, and which integrations the server has configured. */
export type Session = {
  role: "admin" | "department";
  department?: Department;
  label: string;
  gemini: boolean;
  email: boolean;
};

/** A ticket as the staff API returns it: the public view plus the conversation with the citizen. */
export type StaffTicket = PublicTicket & Partial<Pick<PrivateTicket, "messages">>;
