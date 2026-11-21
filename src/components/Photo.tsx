import type { ImgHTMLAttributes } from "react";

/**
 * The one place the app renders a user-uploaded photo. These come from our own
 * authenticated image API or from a local blob: preview, so next/image's
 * optimiser (remote loaders, fixed layouts, build-time sizing) adds nothing:
 * the photos are already downscaled in the browser before upload.
 */
export default function Photo(props: ImgHTMLAttributes<HTMLImageElement> & { alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} alt={props.alt} className={`rounded-md ring-1 ring-slate-200 ${props.className ?? ""}`} />;
}
