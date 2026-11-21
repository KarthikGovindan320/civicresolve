import { NextResponse } from "next/server";
import { roleLabel, staffRole } from "@/lib/auth";
import { geminiEnabled } from "@/lib/gemini";
import { emailEnabled } from "@/lib/notify";

/**
 * Staff sign-in check. The passcode decides the role: the city admin sees every
 * department; a department sees only its own queue. The answer also says whether
 * Gemini and email are configured, so operators are warned when the system is
 * running on fallbacks.
 */
export async function GET(req: Request) {
  const role = staffRole(req);
  if (!role) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({
    ok: true,
    ...role,
    label: roleLabel(role),
    gemini: geminiEnabled(),
    email: emailEnabled(),
  });
}
