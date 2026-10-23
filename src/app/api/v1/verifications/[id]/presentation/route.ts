import * as h from "@/lib/server/api/handlers";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return h.postWalletPresentation(req, (await ctx.params).id);
}
