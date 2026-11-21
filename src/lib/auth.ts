import "server-only";
import { safeEqual } from "./security";
import { DEPARTMENTS, type Department, type Role, isHeld, type Verification } from "./types";

// =============================================================================
// Staff authentication and role-based access control
// -----------------------------------------------------------------------------
// Two staff roles, each with a passcode sent in the `x-staff-key` header:
//   • admin       → city-wide control (the "Admin Dashboard" in the brief)
//   • department  → each department signs in separately and can act only on
//                   tickets currently assigned to it (enforced server-side in
//                   every route, see canActOn()).
// Citizens never sign in: they use a private link token (see workflow.ts).
// Passcodes come from env vars / Google Secret Manager, never the repo, and are
// compared in constant time. The system fails closed: in production, a role
// with no configured passcode simply can't sign in; there are no guessable
// defaults. Moving to Google sign-in (Firebase Auth) later changes only this file.
// =============================================================================

const STAFF_KEY_HEADER = "x-staff-key";
/** Older clients sent the passcode under this name; still accepted for backwards compatibility. */
const LEGACY_STAFF_KEY_HEADER = "x-admin-key";
/** Development-only passcodes are "<slug>123" (e.g. "admin123", "roads123"). Never used in production. */
const DEV_PASSCODE_SUFFIX = "123";

const isProduction = () => process.env.NODE_ENV === "production";

/** The city admin's passcode, or null when none is configured in production. */
export function adminPasscode(): string | null {
  if (process.env.ADMIN_PASSCODE) return process.env.ADMIN_PASSCODE;
  return isProduction() ? null : `admin${DEV_PASSCODE_SUFFIX}`;
}

/** Short slugs for dev passcodes, e.g. "roads123", "sanitation123". */
export const DEPT_SLUG: Record<Department, string> = {
  "Public Works (Roads)": "roads",
  Sanitation: "sanitation",
  "Electricity Board (TANGEDCO)": "electricity",
  "Water Supply": "water",
  "Drainage & Sewerage": "drainage",
  "General Administration": "general",
};

/**
 * Each department's passcode, read from DEPT_PASSCODES (a JSON object such as
 * {"Sanitation": "…", "Water Supply": "…"}). Unknown departments are ignored.
 */
export function departmentPasscodes(): Partial<Record<Department, string>> {
  if (process.env.DEPT_PASSCODES) {
    try {
      const parsed = JSON.parse(process.env.DEPT_PASSCODES) as Record<string, string>;
      return Object.fromEntries(
        Object.entries(parsed).filter(
          ([department, passcode]) =>
            DEPARTMENTS.includes(department as Department) && typeof passcode === "string" && passcode,
        ),
      ) as Partial<Record<Department, string>>;
    } catch {
      return {}; // malformed config → no department logins (fail closed)
    }
  }
  if (isProduction()) return {};
  return Object.fromEntries(
    DEPARTMENTS.map((department) => [department, `${DEPT_SLUG[department]}${DEV_PASSCODE_SUFFIX}`]),
  ) as Record<Department, string>;
}

/** Resolve the caller's staff role from the x-staff-key header, or null. */
export function staffRole(req: Request): Role | null {
  const givenKey = req.headers.get(STAFF_KEY_HEADER) ?? req.headers.get(LEGACY_STAFF_KEY_HEADER);
  if (!givenKey) return null;
  const adminKey = adminPasscode();
  if (adminKey && safeEqual(givenKey, adminKey)) return { role: "admin" };
  for (const [department, passcode] of Object.entries(departmentPasscodes())) {
    if (passcode && safeEqual(givenKey, passcode)) return { role: "department", department: department as Department };
  }
  return null;
}

/** Whether a resolved role is the city admin. The single admin check used across the API. */
export function isAdminRole(role: Role | null): role is { role: "admin" } {
  return role?.role === "admin";
}

/** Whether the request carries the city admin's passcode. */
export function isAdmin(req: Request): boolean {
  return isAdminRole(staffRole(req));
}

/**
 * The authorisation rule, checked server-side on every mutation: the admin acts
 * on everything; a department acts only on tickets assigned to it, and never on
 * held (unverified) reports, which stay in the admin's review bucket until approved.
 */
export function canActOn(role: Role | null, ticket: { department: Department; verification?: Verification }): boolean {
  if (!role) return false;
  if (isAdminRole(role)) return true;
  return role.department === ticket.department && !isHeld(ticket);
}

/** Display name for a role: "City Admin" or the department's name. */
export function roleLabel(role: Role): string {
  return isAdminRole(role) ? "City Admin" : role.department;
}
