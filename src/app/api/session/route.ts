import { handle } from "@/lib/server/http";
import { establishSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handle(() => establishSession(request));
}
