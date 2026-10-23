import * as h from "@/lib/server/api/handlers";
export const dynamic = "force-dynamic";
export async function GET(req: Request, ctx: { params: Promise<{ commitment: string }> }) {
  return h.getPassCredentialStatus(req, (await ctx.params).commitment);
}
