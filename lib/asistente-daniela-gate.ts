/**
 * Fase 8A (piloto controlado) — gate EXPLÍCITO y aislado para decidir si un
 * mensaje entrante debe atenderse con el nuevo asistente
 * (lib/asistente-daniela-ia.ts) en vez del sistema LEGACY actual
 * (generarRespuestaConEspecialistaIA, sin cambios).
 *
 * Diseño deliberadamente conservador tras el incidente real de la Fase 7
 * (un test sin aislar disparó mensajes reales a producción): CUATRO
 * condiciones independientes deben cumplirse a la vez. Si CUALQUIERA falla,
 * el webhook sigue exactamente por el camino legacy -- cero cambio de
 * comportamiento para cualquier otro tenant, número, o incluso para
 * Daniela si escribe desde un número que no sea el autorizado.
 *
 * PILOTO_ASISTENTE_DANIELA_ACTIVO es el único interruptor pensado para
 * tocarse a mano. Todo lo demás es identidad real verificada directamente
 * contra dulabs_clientes_config el 2026-09-04 (Fase 8A) -- nunca un dato
 * que llegue del mensaje del usuario.
 */

// Interruptor único del piloto. false = comportamiento actual para TODOS,
// sin excepción, sin importar el resto de esta configuración.
export const PILOTO_ASISTENTE_DANIELA_ACTIVO = true;

// Identidad real de Daniela (verificada contra Supabase, no inventada) --
// se exige coincidencia de AMBOS campos, no solo uno.
const ID_TENANT_DANIELA = "c64fac97-eff8-45f2-b691-30b3449da524";
const PHONE_NUMBER_ID_DANIELA = "1282448611609227";

// ÚNICO número real autorizado para entrar al piloto (instrucción explícita
// de la Fase 8A: +57 314 812 7388). Cualquier otro remitente -- incluida
// una clienta real de Daniela -- sigue por el camino legacy sin tocar nada.
// Exportado (no solo interno) porque es TAMBIÉN el único destinatario que
// cualquier prueba de esta fase puede usar para un envío real -- ver
// asegurarDestinatarioAutorizadoParaPruebas más abajo.
export const NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP = "573148127388";
const NUMEROS_AUTORIZADOS_PILOTO: ReadonlySet<string> = new Set([NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP]);

/**
 * `idTenant`/`phoneNumberId` deben venir SIEMPRE del `cliente` ya resuelto
 * por el webhook contra Supabase (nunca de datos enviados por el usuario);
 * `telefonoRemitente` debe venir del remitente real ya resuelto por Meta
 * (ver resolverTelefonoRemitenteMeta), nunca de texto libre del mensaje.
 *
 * `opts.pilotoActivo` existe SOLO para que las pruebas puedan ejercitar el
 * camino "gate OFF" de forma determinista sin depender de -ni pisar- la
 * constante real PILOTO_ASISTENTE_DANIELA_ACTIVO. El webhook real (único
 * caller en producción) nunca la pasa -- siempre usa la constante real.
 */
export function debeUsarAsistenteDanielaIA(
  cliente: { id_tenant: string; phone_number_id: string },
  telefonoRemitente: string,
  opts?: { pilotoActivo?: boolean }
): boolean {
  const pilotoActivo = opts?.pilotoActivo ?? PILOTO_ASISTENTE_DANIELA_ACTIVO;
  if (!pilotoActivo) return false;
  if (cliente.id_tenant !== ID_TENANT_DANIELA) return false;
  if (cliente.phone_number_id !== PHONE_NUMBER_ID_DANIELA) return false;
  if (!NUMEROS_AUTORIZADOS_PILOTO.has(telefonoRemitente)) return false;
  return true;
}

/**
 * Guarda de seguridad EXPLÍCITA para pruebas (Fase 8A, Paso 14 punto J, tras
 * el incidente real de la Fase 7): cualquier prueba que esté a punto de
 * disparar un envío real de WhatsApp debe llamar esto primero con el
 * destinatario exacto. Lanza si no es el único número autorizado -- nunca
 * deja pasar un envío real a nadie más, sin importar qué datos de prueba
 * existan en Supabase en ese momento.
 */
export function asegurarDestinatarioAutorizadoParaPruebas(telefono: string): void {
  if (telefono !== NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP) {
    throw new Error(
      `Envío de WhatsApp bloqueado: "${telefono}" no es el número autorizado para pruebas (${NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP}).`
    );
  }
}
