import "server-only";
import { safeEqual } from "./security";
import { DEPARTMENTS, type Department, type Role, isHeld, type Verification } from "./types";

// =============================================================================
// [SECURITY] STAFF AUTHENTICATION & ROLE-BASED ACCESS CONTROL
// -----------------------------------------------------------------------------
// Two staff roles, each with a passcode sent in the `x-staff-key` header:
//   • admin       → city-wide control (the "Admin Dashboard" in the brief)
//   • department  → each department signs in separately and can act ONLY on
//                   tickets currently assigned to it (enforced server-side in
//                   every route, see canActOn()).
// Citizens never sign in: they use a private link token (see workflow.ts).
// Passcodes come from env vars / Google Secret Manager, never the repo, and are
// compared in constant time. FAIL CLOSED: in production, a role with no
// configured passcode simply can't sign in; there are no guessable defaults.
// Moving to Google sign-in (Firebase Auth) later changes only this file.
// =============================================================================

const isProd = () => process.env.NODE_ENV === "production";

export function adminPasscode(): string | null {
  if (process.env.ADMIN_PASSCODE) return process.env.ADMIN_PASSCODE;
  return isProd() ? null : "admin123"; // dev convenience only
}

// Short slugs for dev passcodes, e.g. "roads123", "sanitation123".
export const DEPT_SLUG: Record<Department, string> = {
  "Public Works (Roads)": "roads",
  Sanitation: "sanitation",
  "Electricity Board (TANGEDCO)": "electricity",
  "Water Supply": "water",
  "Drainage & Sewerage": "drainage",
  "General Administration": "general",
};

// DEPT_PASSCODES is a JSON object: {"Sanitation": "…", "Water Supply": "…", …}
export function departmentPasscodes(): Partial<Record<Department, string>> {
  if (process.env.DEPT_PASSCODES) {
    try {
      const parsed = JSON.parse(process.env.DEPT_PASSCODES) as Record<string, string>;
      return Object.fromEntries(
        Object.entries(parsed).filter(([d, p]) => DEPARTMENTS.includes(d as Department) && typeof p === "string" && p),
      ) as Partial<Record<Department, string>>;
    } catch {
      return {}; // malformed config → no department logins (fail closed)
    }
  }
  if (isProd()) return {};
  return Object.fromEntries(DEPARTMENTS.map((d) => [d, `${DEPT_SLUG[d]}123`])) as Record<Department, string>;
}

/** Resolve the caller's staff role from the x-staff-key header, or null. */
export function staffRole(req: Request): Role | null {
  // `x-admin-key` is still accepted for backwards compatibility.
  const given = req.headers.get("x-staff-key") ?? req.headers.get("x-admin-key");
  if (!given) return null;
  const admin = adminPasscode();
  if (admin && safeEqual(given, admin)) return { role: "admin" };
  for (const [dept, code] of Object.entries(departmentPasscodes())) {
    if (code && safeEqual(given, code)) return { role: "department", department: dept as Department };
  }
  return null;
}

export function isAdmin(req: Request): boolean {
  return staffRole(req)?.role === "admin";
}

// [SECURITY] Authorisation rule: admins act on everything; a department acts
// only on tickets assigned to it. Checked server-side on every mutation.
export function canActOn(role: Role | null, ticket: { department: Department; verification?: Verification }): boolean {
  if (!role) return false;
  if (role.role === "admin") return true;
  // [SECURITY] Unverified reports stay in the admin's review bucket until approved.
  return role.department === ticket.department && !isHeld(ticket);
}

export function roleLabel(role: Role): string {
  return role.role === "admin" ? "City Admin" : role.department;
}
