import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { podarEventosAntiguos } from "@/lib/developer/events-store";
import { limpiarIdempotencyKeysVencidas } from "@/lib/developer/idempotency";

// DuLabs Developer V1 -- Fase 13 (autorizado, 13.5). Cron de retención SEGURA.
// Poda SOLO eventos terminales entregados/sin_webhook más antiguos que
// DIAS_RETENCION_EVENTOS (nunca pendiente/entregando/fallido/dlq -> los no
// resueltos se conservan siempre). Limpia idempotency_keys > 24h (su ventana
// lógica). Protegido con CRON_SECRET (Vercel manda Authorization: Bearer).

export const runtime = "nodejs";
const DIAS_RETENCION_EVENTOS = 90;

function autorizado(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  const recibido = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const a = createHash("sha256").update(recibido).digest();
  const b = createHash("sha256").update(secret).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!autorizado(request)) return new Response("Forbidden", { status: 403 });
  const supabase = supabaseAdmin();
  const eventos = await podarEventosAntiguos(supabase, { diasRetencion: DIAS_RETENCION_EVENTOS, limite: 2000 });
  const idempotencyKeys = await limpiarIdempotencyKeysVencidas(supabase, { horas: 24, limite: 5000 });
  return Response.json({ eventosBorrados: eventos.borrados, idempotencyKeysBorradas: idempotencyKeys.borradas, diasRetencionEventos: DIAS_RETENCION_EVENTOS });
}
