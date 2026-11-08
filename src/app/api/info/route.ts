import { handle, json, validateQuery } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    validateQuery(request);
    return json({ name: "Notas de Bolsillo", description: "Una app ficticia de Esteban para probar Constructor" });
  });
}
