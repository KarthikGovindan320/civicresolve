import "server-only";
import { z } from "zod";
import { MINUTE_MS } from "./constants";
import { STAFF_KEY_HEADER } from "./headers";
import { rateLimited, success, type Result } from "./result";
import { clientIp, peekRateLimit, rateLimit, safeEqual } from "./security";
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
// defaults. A client that keeps sending wrong passcodes is locked out for a few
// minutes, so passcodes can't be guessed by brute force.
// Moving to Google sign-in (Firebase Auth) later changes only this file.
// =============================================================================

/** Development-only passcodes are "<slug>123" (e.g. "admin123", "roads123"). Never used in production. */
const DEV_PASSCODE_SUFFIX = "123";
/**
 * Wrong passcodes one client may send within SIGN_IN_LOCKOUT_MS before every staff
 * sign-in from it is refused for the rest of that time. Generous enough for honest
 * typos, far too few to guess a passcode.
 */
export const MAX_FAILED_SIGN_INS = 20;
const SIGN_IN_LOCKOUT_MS = 5 * MINUTE_MS;
const SIGN_IN_LIMIT = { max: MAX_FAILED_SIGN_INS, windowMs: SIGN_IN_LOCKOUT_MS };

/** Tells a locked-out client exactly how long to wait. */
function lockoutMessage(retryAfterSec: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSec / 60));
  return `Too many wrong passcodes. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

const isProduction = () => process.env.NODE_ENV === "production";

/** The city admin's passcode, or null when none is configured in production. */
function adminPasscode(): string | null {
  if (process.env.ADMIN_PASSCODE) return process.env.ADMIN_PASSCODE;
  return isProduction() ? null : `admin${DEV_PASSCODE_SUFFIX}`;
}

/** Short slugs for dev passcodes, e.g. "roads123", "sanitation123". */
const DEPT_SLUG: Record<Department, string> = {
  "Public Works (Roads)": "roads",
  Sanitation: "sanitation",
  "Electricity Board (TANGEDCO)": "electricity",
  "Water Supply": "water",
  "Drainage & Sewerage": "drainage",
  "General Administration": "general",
};

/** DEPT_PASSCODES as configured: a JSON object of department name → passcode. */
const PasscodeConfigSchema = z.record(z.string(), z.unknown());

/** The configured DEPT_PASSCODES object, or null when it is not valid JSON of the right shape. */
function readPasscodeConfig(raw: string): Record<string, unknown> | null {
  try {
    const parsed = PasscodeConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Each department's passcode, read from DEPT_PASSCODES (a JSON object such as
 * {"Sanitation": "…", "Water Supply": "…"}). Unknown departments and empty or
 * non-text passcodes are ignored; malformed config means no department logins
 * (fail closed). Outside production, each department gets "<slug>123".
 */
function departmentPasscodes(): Partial<Record<Department, string>> {
  const passcodes: Partial<Record<Department, string>> = {};
  if (!process.env.DEPT_PASSCODES) {
    if (!isProduction())
      for (const department of DEPARTMENTS) passcodes[department] = `${DEPT_SLUG[department]}${DEV_PASSCODE_SUFFIX}`;
    return passcodes;
  }
  const config = readPasscodeConfig(process.env.DEPT_PASSCODES) ?? {};
  for (const department of DEPARTMENTS) {
    const passcode = config[department];
    if (typeof passcode === "string" && passcode) passcodes[department] = passcode;
  }
  return passcodes;
}

/** The staff role a passcode signs in as, or null when it matches none. */
export function roleForPasscode(givenKey: string): Role | null {
  const adminKey = adminPasscode();
  if (adminKey && safeEqual(givenKey, adminKey)) return { role: "admin" };
  const passcodes = departmentPasscodes();
  const department = DEPARTMENTS.find((candidate) => {
    const passcode = passcodes[candidate];
    return passcode !== undefined && safeEqual(givenKey, passcode);
  });
  return department ? { role: "department", department } : null;
}

/**
 * Who is asking, from the x-staff-key header: the staff role, or null for a
 * request without a (valid) passcode, which every route treats as the public.
 * Each wrong passcode counts against the client's IP; once it has sent
 * MAX_FAILED_SIGN_INS of them, every passcode from it (even the right one, so a
 * guess can't be confirmed) is answered 429, saying how long to wait, until
 * SIGN_IN_LOCKOUT_MS after the first wrong one.
 */
export function authenticateStaff(req: Request): Result<{ role: Role | null }> {
  const givenKey = req.headers.get(STAFF_KEY_HEADER);
  if (!givenKey) return success({ role: null });
  const bucket = `staff-sign-in-failures:${clientIp(req)}`;
  const lockout = peekRateLimit(bucket, SIGN_IN_LIMIT);
  if (!lockout.ok) return rateLimited(lockoutMessage(lockout.retryAfterSec), lockout.retryAfterSec);
  const role = roleForPasscode(givenKey);
  if (!role) rateLimit(bucket, SIGN_IN_LIMIT);
  return success({ role });
}

/** Whether a resolved role is the city admin. The single admin check used across the API. */
export function isAdminRole(role: Role | null): role is { role: "admin" } {
  return role?.role === "admin";
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
