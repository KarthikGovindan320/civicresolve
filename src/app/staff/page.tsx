"use client";

import { useCallback, useEffect, useState } from "react";
import { FixedLanguage } from "@/components/I18nProvider";
import { staffRequest } from "@/lib/client/api";
import Dashboard from "./Dashboard";
import Login from "./Login";
import type { Session } from "./types";

const STAFF_KEY_STORAGE = "civic-staff-key";

/**
 * Staff portal: one sign-in for two roles. The passcode decides who you are:
 * the city admin sees every department, escalations and the AI overrides; a
 * department sees only its own queue (the server enforces this too).
 */
export default function StaffPage() {
  const [staffKey, setStaffKey] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  // The server verifies the passcode before the dashboard renders. It is kept
  // only in sessionStorage, which is cleared when the tab closes; storage can
  // be unavailable (private mode), in which case sign-in simply isn't remembered.
  const signIn = useCallback(async (passcode: string) => {
    const result = await staffRequest<Session>("/api/staff/session", passcode);
    if (!result.ok) return false;
    setSession(result.data);
    setStaffKey(passcode);
    try {
      sessionStorage.setItem(STAFF_KEY_STORAGE, passcode);
    } catch {}
    return true;
  }, []);

  function signOut() {
    try {
      sessionStorage.removeItem(STAFF_KEY_STORAGE);
    } catch {}
    setStaffKey(null);
    setSession(null);
  }

  // Restore a sign-in from earlier in this tab.
  useEffect(() => {
    let savedKey: string | null = null;
    try {
      savedKey = sessionStorage.getItem(STAFF_KEY_STORAGE);
    } catch {}
    // signIn sets state only after an async fetch, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (savedKey) signIn(savedKey);
  }, [signIn]);

  // Staff screens stay in English whatever language the citizen pages use.
  return (
    <FixedLanguage lang="en">
      {!staffKey || !session ? (
        <Login onSignIn={signIn} />
      ) : (
        <Dashboard staffKey={staffKey} session={session} onLogout={signOut} />
      )}
    </FixedLanguage>
  );
}
