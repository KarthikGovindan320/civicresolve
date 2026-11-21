import { redirect } from "next/navigation";

// The admin dashboard now lives in the unified staff portal (/staff), where the
// passcode decides the role: city admin or a specific department.
export default function AdminRedirect() {
  redirect("/staff");
}
