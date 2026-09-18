import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { solicitudAutorizadaCron } from "@/lib/cron-auth";
import { reclamarIdempotencia, liberarIdempotencia } from "@/lib/developer/idempotency";
import { enviarBienvenidaWhatsappPorUsuario } from "@/lib/developer/welcome-whatsapp";
import { enviarConfirmacionPagoWhatsappPorCuenta } from "@/lib/developer/payment-confirmation";
import { scopeYclaveJob, esFalloTransitorio, type WhatsappJob } from "@/lib/developer/whatsapp-jobs";
import type { ResultadoEnvioTemplate } from "@/lib/developer/dulabs-whatsapp";

// DuLabs Developer -- WORKER de jobs de WhatsApp transaccional (bienvenida /
// confirmación de pago) publicados en QStash. QStash llama a este endpoint
// inmediatamente tras el evento y reintenta ante fallo transitorio. Reglas:
//  - AUTENTICACIÓN: firma de QStash (upstash-signature) o Bearer CRON_SECRET
//    (solicitudAutorizadaCron, reutilizado de Business). Nunca abierto.
//  - IDEMPOTENCIA: reclamarIdempotencia (UNIQUE workspace_id+key en Postgres)
//    -> un retry de QStash nunca reenvía si ya se procesó. En fallo TRANSITORIO
//    se libera la clave para permitir el retry; en fallo PERMANENTE se conserva.
//  - Reutiliza el sender existente (enviarTemplateDulabs / resolverTokenMeta /
//    enviarPlantilla). Nunca envía si la plantilla no está APPROVED. Nunca
//    expone el token de Meta; loguea el detalle real de Meta para diagnóstico.

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const cuerpoCrudo = await request.text();
  if (!(await solicitudAutorizadaCron(request, cuerpoCrudo))) {
    return new Response("Forbidden", { status: 403 });
  }

  let job: WhatsappJob;
  try {
    job = JSON.parse(cuerpoCrudo) as WhatsappJob;
  } catch {
    return Response.json({ ok: false, motivo: "body_invalido" }, { status: 400 });
  }
  if (job?.tipo !== "bienvenida" && job?.tipo !== "pago") {
    return Response.json({ ok: false, motivo: "tipo_invalido" }, { status: 400 });
  }

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { workspaceId, idempotencyKey } = scopeYclaveJob(job);

  // Candado idempotente: solo el primer intento "gana" y procede a enviar.
  const claim = await reclamarIdempotencia(supabase, { workspaceId, idempotencyKey, payload: job });
  if (claim.resultado !== "nuevo") {
    console.log(`[developer/wa-job] skip ${job.tipo} (${claim.resultado}) key=${idempotencyKey}`);
    return Response.json({ ok: true, skipped: claim.resultado }, { status: 200 });
  }

  let r: ResultadoEnvioTemplate;
  try {
    r =
      job.tipo === "bienvenida"
        ? await enviarBienvenidaWhatsappPorUsuario(supabase, job.userId)
        : await enviarConfirmacionPagoWhatsappPorCuenta(supabase, { accountId: job.accountId, planCodigo: job.planCodigo, transactionId: job.transactionId });
  } catch (err) {
    // Excepción inesperada -> transitorio: liberar y pedir retry.
    await liberarIdempotencia(supabase, { workspaceId, idempotencyKey });
    console.error(`[developer/wa-job] excepcion ${job.tipo} key=${idempotencyKey}:`, err instanceof Error ? err.message : String(err));
    return Response.json({ ok: false, motivo: "excepcion" }, { status: 500 });
  }

  if (r.enviado) {
    console.log(`[developer/wa-job] ok ${job.tipo} wamid=${r.wamid} key=${idempotencyKey}`);
    return Response.json({ ok: true, wamid: r.wamid }, { status: 200 });
  }

  // Fallo: decidir si reintentar (transitorio) o cerrar (permanente).
  const detalle = "detalle" in r ? r.detalle : undefined;
  if (esFalloTransitorio(r)) {
    await liberarIdempotencia(supabase, { workspaceId, idempotencyKey });
    console.warn(`[developer/wa-job] transitorio ${job.tipo} motivo=${r.motivo}${detalle ? ` detalle="${detalle}"` : ""} -> retry`);
    return Response.json({ ok: false, motivo: r.motivo }, { status: 500 });
  }
  // Permanente: se conserva el candado (no reintentar) y se responde 200 para
  // que QStash no siga reintentando algo que nunca va a funcionar.
  console.warn(`[developer/wa-job] permanente ${job.tipo} motivo=${r.motivo}${detalle ? ` detalle="${detalle}"` : ""} -> no-retry`);
  return Response.json({ ok: false, motivo: r.motivo, permanent: true }, { status: 200 });
}
