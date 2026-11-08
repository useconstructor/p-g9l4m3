import { handle } from "@/lib/server/http";
import { mutate } from "@/lib/server/notes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => mutate(request, "fijar", (await context.params).id));
}
