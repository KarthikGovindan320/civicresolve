import { NextResponse } from "next/server";
import { roleLabel } from "@/lib/auth";
import { geminiEnabled } from "@/lib/gemini";
import { failWith, requireStaff } from "@/lib/http";
import { emailEnabled } from "@/lib/notify";

/**
 * Staff sign-in check. The passcode decides the role: the city admin sees every
 * department; a department sees only its own queue. The answer also says whether
 * Gemini and email are configured, so operators are warned when the system is
 * running on fallbacks. A wrong passcode is answered 401, and a client that
 * keeps guessing is locked out with 429 (see authenticateStaff).
 */
export async function GET(req: Request) {
  const staff = requireStaff(req);
  if (!staff.ok) return failWith(staff);
  const { role } = staff;
  return NextResponse.json({
    ok: true,
    ...role,
    label: roleLabel(role),
    gemini: geminiEnabled(),
    email: emailEnabled(),
  });
}
