/**
 * The photos a ticket can have, and where each is kept and served. One table,
 * used by the routes that store photos, the route that serves them and the
 * screens that show them.
 */

/** Storage-key suffix of each photo: the citizen's original, the department's proof of fix, the reopen evidence. */
export const PHOTO_VARIANTS = { before: "", after: "-after", reopen: "-reopen" } as const;

export type PhotoVariant = keyof typeof PHOTO_VARIANTS;

/** Whether `value` names a photo variant. */
export const isPhotoVariant = (value: string): value is PhotoVariant => Object.hasOwn(PHOTO_VARIANTS, value);

/** The image-store key of one photo of a ticket. */
export const photoKey = (ticketId: string, variant: PhotoVariant) => `${ticketId}${PHOTO_VARIANTS[variant]}`;

/**
 * The public path of a ticket's photo. `version` (e.g. the time it was taken)
 * changes the URL when the photo changes, so a cached copy is never shown.
 * Photos of reports held for review also need a signature: see `photoUrl` in workflow.ts.
 */
export function photoPath(ticketId: string, variant: PhotoVariant, version?: string): string {
  const params = new URLSearchParams({ v: variant });
  if (version) params.set("t", version);
  return `/api/tickets/${ticketId}/image?${params}`;
}
