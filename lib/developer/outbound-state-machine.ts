// DuLabs Developer V1 -- Fase 1 (autorizado, secciones 10, 11, 14 del brief).
// Máquina de estados PURA (sin red, sin DB) del ciclo de vida de un job
// saliente hacia Meta. La separación entre `status` (estado lógico, quién
// tiene la pelota) y `physicalOutcome` (¿el POST físico a Meta ocurrió de
// verdad?) es intencional y obligatoria -- son dos preguntas distintas:
// "¿qué toca hacer ahora?" vs. "¿es seguro volver a intentar sin duplicar
// el mensaje del lado del cliente final?".

export type EstadoJob = "created" | "queued" | "sending" | "success_confirmed" | "failed_by_meta" | "retry_pending" | "reconciliation_pending";

export type ResultadoFisico = "pre_send" | "uncertain" | "success_confirmed";

export const MAX_INTENTOS_FISICOS = 2;

export type EventoJob =
  | { tipo: "encolar" }
  | { tipo: "iniciar_envio" }
  // Meta respondió 2xx con confirmación real -- certeza total.
  | { tipo: "meta_confirmo_exito" }
  // Meta respondió con un error identificable (4xx/5xx CON cuerpo de
  // respuesta legible) -- certeza de que el mensaje NO se envió.
  | { tipo: "meta_rechazo"; codigoError?: string }
  // No hay certeza de si Meta recibió el POST (timeout de red, conexión
  // cortada, crash del proceso a mitad de la llamada). Regla crítica del
  // brief (sección 11): esto NUNCA se trata como "no enviado".
  | { tipo: "incertidumbre_de_red" }
  // Un proceso de reconciliación (fuera de esta máquina de estados)
  // confirmó, consultando a Meta, que el POST anterior NO llegó a
  // ejecutarse del lado de Meta -- solo entonces es seguro reintentar.
  | { tipo: "reconciliacion_confirmo_no_enviado" };

export type EstadoCompletoJob = {
  status: EstadoJob;
  physicalOutcome: ResultadoFisico;
  networkAttempts: number;
};

export type ResultadoTransicion = { permitida: true; siguiente: EstadoCompletoJob } | { permitida: false; motivo: string };

/**
 * Única función de transición -- ni el Gateway ni ningún Worker deben mutar
 * `status`/`physicalOutcome` directamente, siempre a través de esta
 * función, para que la regla crítica de la sección 11 (nunca reintentar
 * automáticamente tras incertidumbre) esté en UN solo lugar, comprobable
 * con una tabla de casos, no repetida/reinterpretada en cada Worker.
 */
export function transicionar(actual: EstadoCompletoJob, evento: EventoJob): ResultadoTransicion {
  switch (evento.tipo) {
    case "encolar": {
      if (actual.status !== "created") return { permitida: false, motivo: `no se puede encolar desde "${actual.status}"` };
      return { permitida: true, siguiente: { ...actual, status: "queued" } };
    }

    case "iniciar_envio": {
      if (actual.status !== "queued" && actual.status !== "retry_pending") {
        return { permitida: false, motivo: `no se puede iniciar envío desde "${actual.status}"` };
      }
      if (actual.networkAttempts >= MAX_INTENTOS_FISICOS) {
        return { permitida: false, motivo: `ya se agotaron los ${MAX_INTENTOS_FISICOS} intentos físicos permitidos` };
      }
      return {
        permitida: true,
        siguiente: { status: "sending", physicalOutcome: "pre_send", networkAttempts: actual.networkAttempts + 1 },
      };
    }

    case "meta_confirmo_exito": {
      if (actual.status !== "sending") return { permitida: false, motivo: `solo se confirma éxito desde "sending", no desde "${actual.status}"` };
      return { permitida: true, siguiente: { ...actual, status: "success_confirmed", physicalOutcome: "success_confirmed" } };
    }

    case "meta_rechazo": {
      if (actual.status !== "sending") return { permitida: false, motivo: `solo se procesa un rechazo desde "sending", no desde "${actual.status}"` };
      // Un rechazo CIERTO de Meta (no una duda de red) -- el mensaje
      // definitivamente no llegó al usuario final, así que sí es seguro
      // decidir si reintentar (a diferencia de la incertidumbre de red).
      if (actual.networkAttempts >= MAX_INTENTOS_FISICOS) {
        return { permitida: true, siguiente: { status: "failed_by_meta", physicalOutcome: "pre_send", networkAttempts: actual.networkAttempts } };
      }
      return { permitida: true, siguiente: { status: "retry_pending", physicalOutcome: "pre_send", networkAttempts: actual.networkAttempts } };
    }

    case "incertidumbre_de_red": {
      if (actual.status !== "sending") return { permitida: false, motivo: `solo aplica incertidumbre desde "sending", no desde "${actual.status}"` };
      // REGLA CRÍTICA (sección 11 del brief): nunca pasar automáticamente a
      // retry_pending desde acá. El único destino posible es
      // reconciliation_pending -- sin excepción, sin importar cuántos
      // intentos queden disponibles.
      return { permitida: true, siguiente: { status: "reconciliation_pending", physicalOutcome: "uncertain", networkAttempts: actual.networkAttempts } };
    }

    case "reconciliacion_confirmo_no_enviado": {
      if (actual.status !== "reconciliation_pending") {
        return { permitida: false, motivo: `solo aplica reconciliación desde "reconciliation_pending", no desde "${actual.status}"` };
      }
      if (actual.networkAttempts >= MAX_INTENTOS_FISICOS) {
        return { permitida: true, siguiente: { status: "failed_by_meta", physicalOutcome: "pre_send", networkAttempts: actual.networkAttempts } };
      }
      return { permitida: true, siguiente: { status: "retry_pending", physicalOutcome: "pre_send", networkAttempts: actual.networkAttempts } };
    }
  }
}

export function estadoInicial(): EstadoCompletoJob {
  return { status: "created", physicalOutcome: "pre_send", networkAttempts: 0 };
}
