import { handle } from "@/lib/server/http";
import { list, mutate } from "@/lib/server/notes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handle(() => list(request));
}

export async function POST(request: Request): Promise<Response> {
  return handle(() => mutate(request, "crear"));
}
