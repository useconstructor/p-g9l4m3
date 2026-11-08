import { handle } from "@/lib/server/http";
import { summary } from "@/lib/server/notes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handle(() => summary(request));
}
