"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The photo chosen on a form and an object URL that previews it. Object URLs
 * hold the image in memory until revoked, so the old preview is released when
 * a new photo replaces it, and the last one when the form goes away.
 */
export function usePhotoPreview() {
  const [photo, setPhoto] = useState<{ blob: Blob | null; previewUrl: string | null }>({
    blob: null,
    previewUrl: null,
  });
  const previewUrlRef = useRef<string | null>(null);
  useEffect(() => {
    previewUrlRef.current = photo.previewUrl;
  }, [photo.previewUrl]);
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  /** Swaps in the new photo (or clears it) and only then releases the old preview. */
  function replacePhoto(blob: Blob | null) {
    if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    setPhoto({ blob, previewUrl: blob ? URL.createObjectURL(blob) : null });
  }

  return { ...photo, replacePhoto };
}
