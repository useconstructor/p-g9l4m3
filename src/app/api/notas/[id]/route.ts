import { handle } from "@/lib/server/http";
import { detail } from "@/lib/server/notes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => detail(request, (await context.params).id));
}
