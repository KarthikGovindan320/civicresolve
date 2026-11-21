// [EFFICIENCY] Downscale photos in the browser before upload: a 12 MP phone
// photo (4-8 MB) becomes ~150 KB JPEG. That means faster uploads on mobile data,
// lower Gemini token cost, and a size that fits in a Firestore document.
// Shared by the citizen report form, the citizen reopen form and the
// department's proof-of-fix upload.
export async function downscale(file: File, max = 1024): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", 0.8));
}
