/**
 * Tailwind class strings shared across forms, so every input, select and
 * button of the same kind looks identical and is changed in one place.
 */

/** Full-width text input, select or textarea on the citizen-facing forms. */
export const fieldClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none";

/** Compact input or select used inline in filters and staff action rows. */
export const compactFieldClass = "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";

/** Compact button base for staff action rows; add colours per button. */
export const compactButtonClass = "rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60";

/** Label that sits on its own line above a field. */
export const fieldLabelClass = "mb-1 block text-sm font-medium";

/** Map height in pixels when the page does not ask for one; shared by the map and its loading skeleton. */
export const DEFAULT_MAP_HEIGHT = 380;
