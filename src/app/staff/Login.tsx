"use client";

import { useState } from "react";

/** Staff sign-in form. One passcode field: the passcode itself decides the role. */
export default function Login({ onSignIn }: { onSignIn: (passcode: string) => Promise<boolean> }) {
  const [passcode, setPasscode] = useState("");
  const [rejected, setRejected] = useState(false);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setRejected(!(await onSignIn(passcode)));
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
        className="w-full rounded-md border border-slate-300 px-3 py-2"
      />
      {rejected && (
        <p role="alert" className="text-sm text-red-700">
          Wrong passcode.
        </p>
      )}
      <button className="w-full rounded-md bg-slate-900 px-4 py-2 font-medium text-white">Sign in</button>
    </form>
  );
}
