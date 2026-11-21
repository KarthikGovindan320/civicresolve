/**
 * Downscales a photo in the browser before upload: a 12 MP phone photo
 * (4-8 MB) becomes a JPEG of roughly 150 KB. That means faster uploads on
 * mobile data, lower Gemini token cost, and a size that fits in a Firestore
 * document. Shared by the citizen report form, the citizen reopen form and the
 * department's proof-of-fix upload.
 */
export async function downscale(file: File, maxEdge = 1024): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode"))), "image/jpeg", 0.8),
  );
}

/** Downscales the file chosen in a file input, or returns null when the choice was cleared. */
export async function downscaleSelected(input: HTMLInputElement): Promise<Blob | null> {
  const file = input.files?.[0];
  return file ? downscale(file) : null;
}
