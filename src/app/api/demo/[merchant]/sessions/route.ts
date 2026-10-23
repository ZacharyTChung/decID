import * as h from "@/lib/server/api/handlers";
export async function POST(req: Request, ctx: { params: Promise<{ merchant: string }> }) {
  return h.postDemoSession(req, (await ctx.params).merchant);
}
