// FASE F16.1 (Commercial Scale — Dunning, autorizado) — dominio del ciclo de
// recuperación de pagos. Reutiliza F14/F14.2 sin reconstruirlo: nunca cobra
// directo a Wompi acá (eso lo sigue haciendo el caller vía lib/wompi.ts,
// igual que cobro-mensual), nunca calcula precio (eso sigue siendo
// resolverPrecioSuscripcion sobre la fila real de dulabs_suscripciones), y
// el ÚNICO lugar que finalmente marca estado='vencida' es
// expirarSuscripcionPorAgotamiento -- mientras el ciclo está `activo`, la
// suscripción sigue `activa` (grace period real, ver planDelTenant() en
// lib/plan-limits.ts: solo filtra por estado, así que esto no necesita
// tocar ningún gate de acceso).

import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularProximoIntento, debeExpirarFinal } from "./politica";

export type ResultadoDominioDunning<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export type CicloDunning = {
  id: number;
  id_tenant: string;
  estado: "activo" | "recuperado" | "vencido_final";
  intentos: number;
  motivo_ultimo_fallo: string | null;
  primer_fallo_at: string;
  ultimo_intento_at: string;
  proximo_intento_at: string | null;
  reclamado_en: string | null;
};

export async function obtenerCicloActivo(supabase: SupabaseClient, idTenant: string): Promise<CicloDunning | null> {
  const { data, error } = await supabase.from("dulabs_dunning_ciclos").select("*").eq("id_tenant", idTenant).eq("estado", "activo").maybeSingle();
  if (error) {
    // Fail-safe: si la migración 20261004000000 todavía no corrió (o hay un
    // error transitorio), "no hay ciclo activo" es la respuesta segura --
    // nunca debe tumbar cobro-mensual/webhook/checkout, que sí necesitan
    // seguir funcionando sin dunning. Se deja el log para que sea visible
    // que esto está pasando, en vez de fallar en silencio para siempre.
    console.error(`[dunning] error consultando ciclo activo de ${idTenant} (¿falta aplicar la migración 20261004000000?):`, error.message);
    return null;
  }
  return (data as CicloDunning | null) ?? null;
}

/**
 * Un pago falló para `idTenant` (primer fallo real, no un reintento
 * programado -- ese lo maneja registrarResultadoReintento). Si ya existe un
 * ciclo activo (p.ej. el webhook y el cron corrieron casi al mismo tiempo
 * para el mismo tenant), NO abre un segundo ciclo: solo registra el evento
 * payment_failed adicional y deja el ciclo existente intacto -- la
 * concurrencia real de esto la protege el UNIQUE(id_tenant) de la tabla
 * (ON CONFLICT), nunca una comprobación de "existe/no existe" separada del
 * write.
 */
export async function iniciarCicloDunning(
  supabase: SupabaseClient,
  params: { idTenant: string; motivoFallo: string },
): Promise<CicloDunning> {
  // Guard real contra reentrega de webhook (Wompi reintenta hasta 3 veces en
  // 24h si no respondemos 200 a tiempo -- ver comentario en
  // app/api/wompi/webhook/route.ts) o una carrera cron+webhook: si YA hay un
  // ciclo activo para este tenant, no se reinicia (perdería el progreso real
  // de intentos/fechas) -- solo se dega constancia del fallo adicional y se
  // devuelve el ciclo existente tal cual.
  const existente = await obtenerCicloActivo(supabase, params.idTenant);
  if (existente) {
    await supabase.from("dulabs_dunning_eventos").insert({
      id_tenant: params.idTenant,
      ciclo_id: existente.id,
      tipo: "payment_failed",
      metadata: { motivo: params.motivoFallo, intento: existente.intentos, nota: "ciclo ya estaba activo -- no se reinicia" },
    });
    return existente;
  }

  const ahora = new Date();
  const proximoIntento = calcularProximoIntento({ primerFalloAt: ahora, intentosRealizados: 1 });

  const { data, error } = await supabase
    .from("dulabs_dunning_ciclos")
    .upsert(
      {
        id_tenant: params.idTenant,
        estado: "activo",
        intentos: 1,
        motivo_ultimo_fallo: params.motivoFallo,
        primer_fallo_at: ahora.toISOString(),
        ultimo_intento_at: ahora.toISOString(),
        proximo_intento_at: proximoIntento ? proximoIntento.toISOString() : null,
        reclamado_en: null,
      },
      { onConflict: "id_tenant", ignoreDuplicates: false },
    )
    .select("*")
    .single();

  // upsert con onConflict SIEMPRE sobreescribe -- si ya había un ciclo
  // 'recuperado'/'vencido_final' de un episodio ANTERIOR (ya cerrado), esto
  // abre uno NUEVO correctamente (mismo criterio que dulabs_suscripciones:
  // una fila por tenant, se reescribe). El guard de arriba es lo que evita
  // pisar un ciclo 'activo' EN CURSO.
  if (error) throw error;
  const ciclo = data as CicloDunning;

  await Promise.all([
    supabase.from("dulabs_dunning_eventos").insert({
      id_tenant: params.idTenant,
      ciclo_id: ciclo.id,
      tipo: "payment_failed",
      metadata: { motivo: params.motivoFallo, intento: 1 },
    }),
    // dunning_started está en el índice único parcial (ciclo_id, tipo) --
    // si por una carrera real dos llamadas insertan el mismo ciclo_id, la
    // segunda simplemente falla con 23505 y se ignora: el ciclo ya quedó
    // registrado como iniciado por la primera.
    supabase
      .from("dulabs_dunning_eventos")
      .insert({ id_tenant: params.idTenant, ciclo_id: ciclo.id, tipo: "dunning_started", metadata: null })
      .then(({ error: e }) => {
        if (e && e.code !== "23505") console.error(`[dunning] error registrando dunning_started para ${params.idTenant}:`, e.message);
      }),
  ]);

  return ciclo;
}

/**
 * Reclama atómicamente el ciclo activo de `idTenant` para procesarlo
 * (reintento automático o manual). Devuelve null si no hay nada que hacer
 * todavía (no le toca, o ya lo tiene reclamado otro proceso) -- el caller
 * DEBE abortar sin cobrar en ese caso, igual que con
 * dulabs_reservar_suscripcion.
 */
export async function reclamarCicloParaReintento(
  supabase: SupabaseClient,
  idTenant: string,
  opts?: { ignorarHorario?: boolean },
): Promise<{ id: number; intentos: number; motivo_ultimo_fallo: string | null } | null> {
  const { data, error } = await supabase.rpc("dulabs_dunning_reclamar_reintento", { p_tenant: idTenant, p_ignorar_horario: opts?.ignorarHorario ?? false });
  if (error) {
    console.error(`[dunning] error reclamando ciclo de ${idTenant} (¿falta aplicar la migración 20261004000000?):`, error.message);
    return null;
  }
  const filas = data as { id: number; intentos: number; motivo_ultimo_fallo: string | null }[] | null;
  return filas && filas.length > 0 ? filas[0] : null;
}

export async function liberarReclamo(supabase: SupabaseClient, cicloId: number): Promise<void> {
  await supabase.from("dulabs_dunning_ciclos").update({ reclamado_en: null }).eq("id", cicloId);
}

/**
 * Un reintento (automático o manual) de cobro falló. Avanza el contador de
 * intentos y calcula el próximo reintento según la política -- si ya se
 * agotó, cierra el ciclo como vencido_final y devuelve `expirado: true` (el
 * caller es quien debe entonces marcar dulabs_suscripciones.estado =
 * 'vencida', vía expirarSuscripcionPorAgotamiento). Siempre libera el
 * reclamo, incluso al expirar.
 */
export async function registrarReintentoFallido(
  supabase: SupabaseClient,
  params: { cicloId: number; idTenant: string; primerFalloAt: Date; intentosActuales: number; motivoFallo: string },
): Promise<{ expirado: boolean }> {
  const intentosNuevos = params.intentosActuales + 1;
  const proximoIntento = calcularProximoIntento({ primerFalloAt: params.primerFalloAt, intentosRealizados: intentosNuevos });
  const expira = debeExpirarFinal({ intentosRealizados: intentosNuevos, proximoIntentoAt: proximoIntento });

  await supabase
    .from("dulabs_dunning_ciclos")
    .update({
      intentos: intentosNuevos,
      motivo_ultimo_fallo: params.motivoFallo,
      ultimo_intento_at: new Date().toISOString(),
      proximo_intento_at: proximoIntento ? proximoIntento.toISOString() : null,
      estado: expira ? "vencido_final" : "activo",
      reclamado_en: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.cicloId);

  await supabase.from("dulabs_dunning_eventos").insert({
    id_tenant: params.idTenant,
    ciclo_id: params.cicloId,
    tipo: "retry_failed",
    metadata: { motivo: params.motivoFallo, intento: intentosNuevos },
  });

  if (expira) {
    const { error } = await supabase
      .from("dulabs_dunning_eventos")
      .insert({ id_tenant: params.idTenant, ciclo_id: params.cicloId, tipo: "subscription_expired", metadata: null });
    if (error && error.code !== "23505") console.error(`[dunning] error registrando subscription_expired para ${params.idTenant}:`, error.message);
  }

  return { expirado: expira };
}

/**
 * Cierra el ciclo agotado marcando la suscripción real como vencida -- el
 * ÚNICO punto de todo F16.1 que escribe dulabs_suscripciones.estado =
 * 'vencida'. Reusa exactamente el mismo criterio que ya tenían cobro-mensual
 * y el webhook antes de esta fase (resolverEstadoPago ya calculaba
 * 'vencida' para cualquier estado terminal no-aprobado de Wompi) -- lo único
 * que cambió es CUÁNDO se llama: al agotar la política, no en el primer fallo.
 */
export async function expirarSuscripcionPorAgotamiento(supabase: SupabaseClient, idTenant: string): Promise<void> {
  await supabase.from("dulabs_suscripciones").update({ estado: "vencida", updated_at: new Date().toISOString() }).eq("id_tenant", idTenant);
}

/**
 * Un reintento (automático o manual) fue aprobado. Cierra el ciclo como
 * recuperado -- la reactivación real de dulabs_suscripciones (estado,
 * fecha_proximo_cobro) la hace el caller (webhook o el endpoint de
 * recuperación), reutilizando el mismo patrón que ya usa cobro-mensual para
 * una renovación exitosa -- acá solo se cierra el LADO del dunning.
 */
export async function recuperarCicloDunning(supabase: SupabaseClient, params: { cicloId: number; idTenant: string }): Promise<void> {
  await supabase
    .from("dulabs_dunning_ciclos")
    .update({ estado: "recuperado", reclamado_en: null, updated_at: new Date().toISOString() })
    .eq("id", params.cicloId);

  const { error } = await supabase
    .from("dulabs_dunning_eventos")
    .insert({ id_tenant: params.idTenant, ciclo_id: params.cicloId, tipo: "subscription_recovered", metadata: null });
  if (error && error.code !== "23505") console.error(`[dunning] error registrando subscription_recovered para ${params.idTenant}:`, error.message);
}
