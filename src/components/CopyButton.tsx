"use client";

import { useState } from "react";
import { useT } from "./I18nProvider";

/** Button that copies `text` to the clipboard and announces "Copied" to screen readers. */
export default function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the link stays selectable in its field.
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white"
    >
      <span aria-live="polite">{copied ? t("copy.copied") : t("copy.copy")}</span>
    </button>
  );
}
