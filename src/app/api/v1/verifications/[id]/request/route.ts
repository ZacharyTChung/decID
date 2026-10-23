import * as h from "@/lib/server/api/handlers";
export const dynamic = "force-dynamic";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return h.getWalletRequest(req, (await ctx.params).id);
}
