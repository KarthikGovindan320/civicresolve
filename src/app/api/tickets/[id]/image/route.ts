import { store } from "@/lib/store";

// [EFFICIENCY] Serves a ticket's photos (BRIEF ✔ "optional image"):
//   ?v=before (default) → the citizen's original photo
//   ?v=after            → the department's proof-of-fix photo
//   ?v=reopen           → the citizen's photo when reopening
// Photos are stored apart from ticket records, so dashboards load fast and only
// fetch an image when someone opens that ticket. Cached for an hour.
// [SECURITY] `v` is checked against an allow-list, so it can't be used to read
// arbitrary keys, and the stored MIME type was set from the file signature.
const SUFFIX: Record<string, string> = { before: "", after: "-after", reopen: "-reopen" };

export async function GET(req: Request, ctx: RouteContext<"/api/tickets/[id]/image">) {
  const { id } = await ctx.params;
  const v = new URL(req.url).searchParams.get("v") ?? "before";
  if (!(v in SUFFIX) || !/^CR-\d+$/.test(id)) return new Response("Not found", { status: 404 });
  const img = await store().getImage(`${id}${SUFFIX[v]}`);
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(img.data, "base64"), {
    headers: { "Content-Type": img.mimeType, "Cache-Control": "public, max-age=3600" },
  });
}
