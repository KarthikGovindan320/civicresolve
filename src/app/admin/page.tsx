import { redirect } from "next/navigation";

/**
 * Redirects the old /admin URL to the unified staff portal (/staff), where the
 * passcode decides the role: city admin or a specific department.
 */
export default function AdminRedirect() {
  redirect("/staff");
}
