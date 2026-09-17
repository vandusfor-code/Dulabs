import { OPENAPI_DEVELOPER_V1 } from "@/lib/developers/openapi";

// DuLabs Developer V1 -- Fase 14. Sirve el OpenAPI público (sin auth) para que
// los developers puedan consumirlo con sus herramientas. Namespace /api/developers/*
// (portal público), distinto de /api/developer/* (dashboard autenticado).

export const runtime = "nodejs";

export function GET() {
  return Response.json(OPENAPI_DEVELOPER_V1, { headers: { "Cache-Control": "public, max-age=300" } });
}
