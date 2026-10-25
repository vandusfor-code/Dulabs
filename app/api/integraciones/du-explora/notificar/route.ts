import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { manejarNotificarDuExplora } from "@/lib/integraciones/du-explora-notificar";

// POST /api/integraciones/du-explora/notificar -- aviso diario de Du_Explora.
// Auth: Authorization: Bearer <DU_EXPLORA_NOTIFY_SECRET>. Body: {ready, date, runId}.
// Plantilla, idioma, parámetros (incluida la URL del panel, DU_EXPLORA_PANEL_URL
// opcional) y destino (DU_EXPLORA_NOTIFY_TO) los fija el servidor. Ver lib/integraciones/du-explora-notificar.ts.

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const r = await manejarNotificarDuExplora(
    {
      crearSupabase: () => createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } }),
      env: { secreto: process.env.DU_EXPLORA_NOTIFY_SECRET, destino: process.env.DU_EXPLORA_NOTIFY_TO, urlPanel: process.env.DU_EXPLORA_PANEL_URL },
    },
    { authorization: request.headers.get("authorization"), cuerpoCrudo: await request.text().catch(() => "") },
  );
  return Response.json(r.cuerpo, { status: r.status, headers: r.headers });
}
