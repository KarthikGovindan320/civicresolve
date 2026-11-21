"use client";

import { useState } from "react";

/**
 * Staff sign-in form. One passcode field: the passcode itself decides the role.
 * `onSignIn` resolves to the reason sign-in failed (shown with the field), or null.
 */
export default function Login({ onSignIn }: { onSignIn: (passcode: string) => Promise<string | null> }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(await onSignIn(passcode));
    setBusy(false);
  }

  return (
    <form onSubmit={signIn} className="mx-auto mt-10 max-w-sm space-y-3 rounded-xl bg-white p-6 ring-1 ring-slate-200">
      <h1 className="text-xl font-semibold">Staff sign-in</h1>
      <p className="text-sm text-slate-600">
        City admin or department staff. Your passcode decides which queue you see.
      </p>
      <label htmlFor="pass" className="block text-sm font-medium">
        Passcode
      </label>
      <input
        id="pass"
        type="password"
        value={passcode}
        onChange={(event) => setPasscode(event.target.value)}
        autoFocus
        autoComplete="current-password"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "pass-error" : undefined}
        className="w-full rounded-md border border-slate-300 px-3 py-2"
      />
      {error && (
        <p id="pass-error" role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        disabled={busy}
        className="w-full rounded-md bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-60"
      >
        Sign in
      </button>
    </form>
  );
}
