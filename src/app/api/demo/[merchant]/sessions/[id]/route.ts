import * as h from "@/lib/server/api/handlers";
export const dynamic = "force-dynamic";
export async function GET(req: Request, ctx: { params: Promise<{ merchant: string; id: string }> }) {
  return h.getDemoSession(req, (await ctx.params).merchant, (await ctx.params).id);
}
