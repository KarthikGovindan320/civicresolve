"use client";

import { useEffect, useEffectEvent, useRef } from "react";

const FOCUSABLE =
  "input:not([disabled]), button:not([disabled]), a[href], select:not([disabled]), textarea:not([disabled])";

/** Keeps Tab and Shift+Tab inside `container`, wrapping at either end. */
function wrapTab(container: HTMLElement, event: KeyboardEvent) {
  const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Keyboard behaviour of a modal dialog, for the element the returned ref is
 * attached to: focus moves to its first control when it mounts, Tab cycles
 * within it, Escape calls `onEscape`, and focus returns to whatever opened it
 * when it unmounts.
 */
export function useModalFocusTrap<Dialog extends HTMLElement>(onEscape: () => void) {
  const dialogRef = useRef<Dialog>(null);
  const escape = useEffectEvent(onEscape);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") escape();
      else if (event.key === "Tab") wrapTab(dialog, event);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      opener?.focus();
    };
  }, []);

  return dialogRef;
}
