/**
 * FASE 3B.9D — CONFIGURACIÓN COMPLETA Y ACTIVACIÓN CONTROLADA de Aquí Sí Lo Compras (puro: sin red ni base de datos).
 *
 * Qué hace este módulo:
 *   1. Define la configuración COMPLETA de ASLC (checkout_opciones + negocio) con lo que el negocio ya definió (DATOS_APROBADOS_ASLC y el aviso
 *      obligatorio) y con las decisiones ADOPTADAS el 2026-10-03 (DECISIONES_ASLC / TEXTOS_ASLC / POLITICAS_ASLC): son recomendaciones que el
 *      negocio puede cambiar y que NO vienen de otro negocio. Se valida con el MISMO esquema que el runtime. El aviso entra por parámetro (no hay
 *      copia en el código) y se verifica byte a byte con su SHA-256.
 *   2. Genera los SQL que el dueño corre en el SQL Editor, EN ESTE ORDEN:
 *        08  ver el equipo (solo lectura)      -> para saber el id de la persona responsable
 *        03  configurar completo sin activar   -> checkout_opciones completo (sin candado) + negocio; la fila sigue DESHABILITADA y pausada
 *        05  activación CONTROLADA             -> habilita el agente y quita la pausa SOLO si la IA sigue restringida a números de prueba
 *        06  abrir al público                  -> quita la restricción (solo si la activación controlada está en marcha)
 *        07  freno de emergencia               -> pausa la IA de inmediato
 *        10  reanudar tras el freno            -> quita SOLO la pausa y deja la restricción como estaba (controlado o público)
 *        11  ajustar comportamiento            -> con la fila ya habilitada: estilo, políticas e información oficial del negocio, texto tras el "sí", transportadora
 *        09  cambiar de responsable            -> con la fila ya habilitada (p. ej. cuando exista la persona real)
 *        12  avisos de decisión al cliente     -> textos de aceptado / rechazado / cancelado + módulo avisos_decision_pedidos (SIN los avisos genéricos de cada etapa)
 *        13  aviso por correo a la responsable -> además del panel, un correo (solo el número de pedido y el enlace) cuando un pedido espera su aceptación
 *      Cada uno es UNA sola sentencia (un bloque DO atómico) con guardas: si una falla, no queda nada. Este código nunca toca una base.
 *
 * Qué NO hace: no activa nada por sí mismo, no crea personas (el responsable es un id que el dueño pone y la base verifica), no enciende
 * notificaciones_pedidos (mandaría avisos genéricos de otro negocio), no abre al público sin pasar por la etapa controlada.
 */
import { createHash } from "node:crypto";
import { businessConfigSchema, parseAgentConfig, type BusinessConfig } from "@/lib/agente/config";
import { CREDENCIAL_GEMINI_ASLC, DATOS_APROBADOS_ASLC, IDENTIDAD_ASLC_PRODUCCION } from "@/lib/agente/aprovisionamiento";
import { checkoutOpcionesSchema, type CheckoutOpciones, type FuncionFase3B } from "@/lib/agente/perfil-negocio";
import { MARCADORES_PERMITIDOS, plantillaValida } from "@/lib/agente/textos-cliente";
import type { ModuloId } from "@/lib/tenant-modulos";

// ---------------------------------------------------------------------------
// El aviso obligatorio: EXACTO
// ---------------------------------------------------------------------------

/** SHA-256 y largo (bytes UTF-8) del aviso OFICIAL aprobado por el negocio. El texto vive en supabase/provisioning/aslc/textos-aprobados.json. */
export const AVISO_OFICIAL_SHA256 = "c0bf58e071859d51d86f2de4f703faa8f95ea866e644386d40eb9d6d1a75179a";
export const AVISO_OFICIAL_BYTES = 747;

export const sha256Utf8 = (texto: string): string => createHash("sha256").update(Buffer.from(texto, "utf8")).digest("hex");

/** Lanza si el texto NO es, byte a byte, el aviso aprobado (ni una palabra, emoji, puntuación o salto de línea distinto). */
export function verificarAviso(aviso: string): void {
  if (Buffer.byteLength(aviso, "utf8") !== AVISO_OFICIAL_BYTES || sha256Utf8(aviso) !== AVISO_OFICIAL_SHA256) {
    throw new Error("el aviso obligatorio NO es byte a byte el aprobado por el negocio (747 bytes, SHA-256 fijo)");
  }
}

// ---------------------------------------------------------------------------
// Decisiones ADOPTADAS (recomendaciones del 2026-10-03; el negocio las puede cambiar)
// ---------------------------------------------------------------------------

/**
 * Lo que NO dijo el negocio y se adoptó como recomendación (ver docs/CATALOG_SALES_FASE_3B9_DECISIONES.md). Cambiar un valor = cambiar esta
 * constante, regenerar los SQL (npx tsx scripts/generar-aprovisionamiento-aslc.ts) y volver a correr el 03 mientras la fila siga deshabilitada.
 */
export const DECISIONES_ASLC = Object.freeze({
  /** D3: el teléfono de contacto puede ser "este mismo WhatsApp". */
  telefonoAceptaMismoWhatsapp: true,
  /** D2: el retiro en oficina se ofrece solo si el cliente lo pide (sin dirección ni barrio; oficina escrita por el cliente). */
  oficinaOferta: "solo_si_cliente_pide" as const,
  /** D4: el documento se conserva cifrado 30 días. */
  documentoRetencionDias: 30,
  /** D14: se le muestra al cliente el número de pedido. */
  mostrarNumeroPedido: true,
  /** D7: aceptan la responsable, su respaldo y los administradores (equipo pequeño: evita pedidos trabados). */
  aceptan: "responsable_y_admins" as const,
  /** D5: stock reservado mientras espera aceptación (12 h). */
  reservaMinutos: 720,
  /** D6: si nadie lo acepta ni lo cierra, vence a las 24 h. */
  vencimientoMinutos: 1440,
  /** D10: la regla de las 11:30 de Bogotá cuenta de lunes a viernes; los festivos se ignoran (el sistema no tiene un calendario confiable). */
  corteDias: ["lun", "mar", "mie", "jue", "vie"] as const,
});

/**
 * Textos al cliente PROPUESTOS (no son del negocio). Sin ninguno de los opcionales el sistema usa sus mensajes neutros de siempre, por eso NO se
 * configuran los de envíos sin cobertura / no verificable / error (rige el traspaso y el mensaje neutro). Los de aceptado / rechazado / cancelado (Fase 3B.9E)
 * SÍ se proponen: salen con el módulo avisos_decision_pedidos, que NO enciende los avisos genéricos de otro negocio (notificaciones_pedidos sigue apagado).
 */
export const TEXTOS_ASLC = Object.freeze({
  /** Respuesta ÚNICA al "sí" del cliente tras el aviso (el pedido ya quedó con una persona; el "sí" no confirma nada). */
  trasAvisoConfirma: "¡Gracias por confirmar! 🙌 Una persona de nuestro equipo continuará con tu pedido y te escribirá por este mismo chat.",
  /** Línea de envío del resumen del pedido (regla del negocio: envío gratis). */
  envioResumen: "Envío gratis",
  /** Nota de envío que ve la persona responsable en el panel. */
  notaEnvioPanel: "Envío GRATIS",
  bogotaTexto: "Envío gratis a Bogotá.",
  /**
   * Regla del negocio: antes de las 11:30 PUEDE tener entrega el mismo día y NUNCA se dice que está garantizado. El modelo repite estos textos TAL CUAL y el
   * candado de envíos (3B.6) revisa lo que repite: «(no está garantizado)» activaba `guarantee` y «no tendría entrega el mismo día» activaba `same_day_unbacked`
   * (el candado no entiende la negación), así que en un día hábil TODA consulta de envío a Bogotá pasaba a una persona. Una prueba exige que cada texto que el
   * motor puede devolver pase el candado repetido tal cual. Después de las 11:30 el negocio no dio un texto: se dice solo lo verificable, sin «mismo día».
   */
  bogotaAntes: "Envío gratis. Tu pedido, hecho antes de las 11:30 a. m., puede tener entrega el mismo día.",
  bogotaDespues: "Envío gratis. Como tu pedido se hace después de las 11:30 a. m., el tiempo exacto de entrega depende de la ciudad y la transportadora.",
  restoTexto: "Envío gratis. Normalmente de 2 a 3 días hábiles, según la ciudad y la transportadora.",
  /**
   * Mensajes al cliente tras la decisión de una persona sobre su pedido (Fase 3B.9E). PROPUESTOS por DuLabs, no del negocio: sin nombres de personas, sin fechas,
   * despacho, stock ni alternativas prometidas y sin {motivo} (lo escribe el equipo para el equipo y no siempre existe: con {motivo} y sin motivo no se envía
   * nada). Solo repiten lo que el negocio ya dijo (pago contraentrega y tener el dinero disponible). Si el negocio aprueba otros, van en textos-aprobados.json
   * (aceptado / rechazado / cancelado) y tienen prioridad. Solo salen con el módulo avisos_decision_pedidos y dentro de la ventana de 24 h de WhatsApp.
   */
  avisoAceptado: "¡Buenas noticias! 🎉 Tu pedido {pedido} fue aceptado. Recuerda que el pago es contraentrega: ten el dinero disponible cuando lo recibas. Si tienes alguna duda, escríbenos por este mismo chat.",
  avisoRechazado: "Hola 👋 Lamentamos informarte que tu pedido {pedido} no pudo ser aceptado. Si tienes alguna duda, escríbenos por este mismo chat y te ayudamos.",
  avisoCancelado: "Hola 👋 Tu pedido {pedido} fue cancelado. Si tienes alguna duda, escríbenos por este mismo chat y te ayudamos.",
});

/**
 * Estilo de atención que pidió el negocio (cuestionario del 2026-10-03, sección 11): amable, cercano, comercial y persuasivo, que TUTEA, con emojis
 * moderados y respuestas breves, orientado al cierre sin presionar. Es configuración del negocio (negocio.tono y negocio.personalidad): el prompt base
 * de la plataforma no fija ningún estilo. El seguimiento cada 2 horas NO es estilo: es un mecanismo aparte (no implementado).
 */
export const ESTILO_ASLC = Object.freeze({
  tono: "Cercano, cordial y profesional. Siempre tuteas (tú, te, puedes, me confirmas), nunca de usted salvo que el cliente lo pida. Comercial y persuasivo, sin presionar. Pocos emojis; respuestas breves.",
  personalidad:
    "Eres el asistente de ventas de Aquí Sí Lo Compras. Tu objetivo es ayudar al cliente, resolver sus dudas y objeciones con naturalidad, generar confianza y llevar la conversación hacia el cierre de la venta, sin inventar nada y sin presionar. " +
    "Tutea siempre de forma cordial y natural (tú, te, puedes, quieres, me confirmas); no uses el usted salvo que el cliente lo pida. Usa emojis con moderación y respuestas claras, naturales y no muy largas. " +
    "Cuando el cliente muestre interés, propón el siguiente paso (por ejemplo, agregar el producto a su pedido) y termina con una pregunta amable que invite a avanzar. Insiste de forma estratégica y moderada: no repitas lo mismo ni resultes agresivo o incómodo. Ante una objeción de precio, destaca lo que incluye y su garantía; si ofreces otra opción, que sea más económica. " +
    "Apóyate en lo que está confirmado: el pago es contraentrega y los accesorios y la garantía que figuren en la información del producto. Del envío (si es gratis, cobertura, tiempos, transportadora) solo hablas después de preguntar la ciudad del cliente y consultarla con la herramienta de envíos: antes no lo menciones y, cuando muestre interés, pídele su ciudad con naturalidad. " +
    "Si el cliente duda de la compra o pregunta si es una estafa, responde con calma, cordialidad y seguridad, sin discutir ni molestarte, usando la información oficial del negocio. " +
    "Si el cliente dice claramente que no le interesa o que no quiere más mensajes, respétalo y despídete con amabilidad.",
});

/**
 * Políticas para el modelo (negocio.politicas, ≤300 caracteres cada una). Son GUÍA, no autoridad: lo crítico (pago, envío, confirmación) lo hace el
 * backend. Salen de las reglas que dio el negocio. La respuesta a "¿es una estafa?" y la ubicación NO van aquí: son textos del negocio (conocimiento).
 * Los traspasos por queja, garantía, devolución o falta de información dependen del criterio del modelo (el bloque `handoff` determinista no está
 * implementado): por eso se piden aquí de forma explícita y se prueban con el modelo real.
 *
 * El ENVÍO no se menciona antes de consultar la ciudad: el candado de envíos (3B.6) solo respalda lo que devolvió `consultar_envio` en el turno y, si el
 * modelo afirma "gratis", tiempos o cobertura sin ese respaldo, descarta la respuesta ENTERA (precio, qué incluye, garantía…) y pide la ciudad. La
 * evaluación con Gemini real lo mostró: ni el estilo, ni las políticas, ni los textos del negocio que el modelo repite pueden empujarlo a decir "envío gratis".
 */
export const POLITICAS_ASLC: readonly string[] = Object.freeze([
  "Pago ÚNICAMENTE contraentrega: el cliente paga al recibir su pedido. Nunca ofrezcas ni aceptes anticipos, transferencias, Nequi, Daviplata ni cuenta bancaria.",
  "Del envío (si es gratis, cobertura, tiempos, transportadora) NO digas nada hasta consultar_envio con la ciudad del cliente; entonces repite solo lo que devuelva. Si pregunta por el envío sin dar ciudad, pídesela. No lo menciones al dar precios ni descripciones.",
  "Si el cliente desconfía o pregunta si es una estafa, usa la respuesta oficial de la información del negocio, con calma y sin discutir. Puedes ofrecer una nota de dejar revisar el pedido, pero NUNCA prometas que la transportadora permitirá abrir el paquete antes de pagar.",
  "Nunca confirmes ni des por aceptado un pedido: lo decide una persona del equipo.",
  "Si un producto está agotado o no disponible, díselo con claridad y, si hay productos parecidos disponibles, ofrécelos como alternativa. No prometas fecha de llegada ni de reposición.",
  "Si no tienes confirmada la respuesta (tiempos sin confirmar, garantías o casos especiales sin información, disponibilidad específica, o cualquier dato que no esté en el producto o en la información del negocio), NO la inventes: pasa con un asesor (handoff_to_human, motivo out_of_scope).",
  "Pasa con un asesor (handoff_to_human) si el cliente pide hablar con una persona, presenta una queja o inconformidad, tiene un problema con un pedido o con la entrega, reclama una garantía, devolución o cambio, o tiene una solicitud especial.",
  "Si preguntan dónde estamos ubicados, responde con la información oficial de ubicación (es la bodega de despacho), sin inventar otras direcciones, y pregúntale en qué ciudad está para confirmarle el envío.",
  "Si el cliente describe una necesidad (\"algo para cocinar\", \"un regalo para mi hijo\"), busca con varios términos del producto que la resuelve (freidora, tablet, reloj, celular) antes de decir que no hay; si aun así no hay, ofrece el catálogo completo.",
]);

/** Los textos que el negocio aprobó (supabase/provisioning/aslc/textos-aprobados.json). El CÓDIGO no trae ninguno: ni el aviso ni el nombre de ninguna persona. */
export interface TextosAprobadosAslc {
  aviso: string;
  /** Lo que se le dice al cliente cuando contesta "sí" al aviso: nombra a la persona responsable que indicó el negocio. */
  tras_aviso_confirma: string;
  /** Respuesta del negocio a "¿dónde están ubicados?". */
  ubicacion: string;
  /** Respuesta del negocio a un cliente que desconfía o pregunta si es una estafa. */
  desconfianza: string;
  /** Opcionales (Fase 3B.9E): si el negocio aprueba sus propios mensajes de decisión, van aquí y tienen prioridad sobre la propuesta de TEXTOS_ASLC. */
  aceptado?: string | null;
  rechazado?: string | null;
  cancelado?: string | null;
}

/** Lanza si un mensaje de decisión aprobado (opcional) no es una plantilla válida: texto, sin espacios en los bordes, ≤ 500 caracteres y solo con {pedido} (y {motivo} en rechazo y cancelación). */
function verificarTextosDeDecision(t: Pick<TextosAprobadosAslc, "aceptado" | "rechazado" | "cancelado">): void {
  for (const k of ["aceptado", "rechazado", "cancelado"] as const) {
    const v = t[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string" || v.trim().length === 0 || v !== v.trim() || v.length > 500 || !plantillaValida(v, MARCADORES_PERMITIDOS[k])) {
      throw new Error("textos-aprobados.json: '" + k + "' debe ser un texto de hasta 500 caracteres, sin espacios en los bordes y solo con los marcadores permitidos");
    }
  }
}

/** Lo que el negocio aprobó para las decisiones (solo las claves con texto): el resto lo cubre la propuesta de TEXTOS_ASLC. */
export function decisionDe(t: Pick<TextosAprobadosAslc, "aceptado" | "rechazado" | "cancelado">): { aceptado?: string; rechazado?: string; cancelado?: string } {
  const r: { aceptado?: string; rechazado?: string; cancelado?: string } = {};
  for (const k of ["aceptado", "rechazado", "cancelado"] as const) if (typeof t[k] === "string") r[k] = t[k] as string;
  return r;
}

/** Lanza si falta alguno de los textos aprobados, está vacío o trae espacios en los bordes; el aviso se verifica byte a byte. */
export function verificarTextosAprobados(t: TextosAprobadosAslc): void {
  verificarAviso(t.aviso);
  verificarTextosDeDecision(t);
  for (const k of ["tras_aviso_confirma", "ubicacion", "desconfianza"] as const) {
    const v = t[k];
    if (typeof v !== "string" || v.trim().length === 0 || v !== v.trim()) throw new Error(`textos-aprobados.json: '${k}' debe ser un texto no vacío y sin espacios en los bordes`);
  }
}

// ---------------------------------------------------------------------------
// Configuración completa
// ---------------------------------------------------------------------------

export interface EntradaConfiguracion {
  /** Aviso obligatorio (de textos-aprobados.json): se verifica byte a byte. */
  aviso: string;
  /** Respuesta al "sí" del cliente (de textos-aprobados.json, nombra a la responsable). Sin ella, el texto neutro de TEXTOS_ASLC. */
  trasAvisoConfirma?: string;
  /** Id (dulabs_miembros_equipo.id) de la persona responsable: un miembro ACTIVO de ASLC con rol admin o agente. */
  miembroId: number;
  respaldoMiembroId?: number | null;
  /** Mensajes de decisión aprobados por el negocio (de textos-aprobados.json); sin ellos, la propuesta de TEXTOS_ASLC. */
  decision?: { aceptado?: string; rechazado?: string; cancelado?: string };
}

/** checkout_opciones COMPLETO (sin el candado activacion_pendiente), validado con el esquema del runtime. */
export function configuracionCompletaAslc(e: EntradaConfiguracion): CheckoutOpciones {
  verificarAviso(e.aviso);
  const d = DECISIONES_ASLC;
  const t = TEXTOS_ASLC;
  const transportadora = DATOS_APROBADOS_ASLC.transportadoraHabitual;
  const candidato = {
    entregas: ["domicilio", "oficina_transportadora"],
    pagos: DATOS_APROBADOS_ASLC.pagos.map((metodo) => ({ metodo })),
    campos: { nombre_completo: true, telefono: { modo: "requerido", acepta_mismo_whatsapp: d.telefonoAceptaMismoWhatsapp }, departamento: true, barrio: true },
    oficina: {
      transportadora,
      oferta: d.oficinaOferta,
      pide_direccion: false,
      pide_barrio: false,
      seleccion: { tipo: "texto_libre" },
      documento: { modo: "requerido", tipos: "sin_especificar", retencion: { tipo: "dias", dias: d.documentoRetencionDias }, si_se_niega: "handoff" },
    },
    cierre: {
      modo: "aceptacion_humana",
      validacion_resumen: "boton_datos_correctos",
      mostrar_numero_pedido: d.mostrarNumeroPedido,
      textos: {
        aviso: e.aviso,
        tras_aviso_confirma: e.trasAvisoConfirma ?? t.trasAvisoConfirma,
        aceptado: e.decision?.aceptado ?? t.avisoAceptado,
        rechazado: e.decision?.rechazado ?? t.avisoRechazado,
        cancelado: e.decision?.cancelado ?? t.avisoCancelado,
      },
      responsable: { miembro_id: e.miembroId, respaldo_miembro_id: e.respaldoMiembroId ?? null, canales: ["panel"] },
      aceptan: d.aceptan,
      reserva: { tipo: "ttl", minutos: d.reservaMinutos },
      vencimiento: { tipo: "tras", minutos: d.vencimientoMinutos },
      reserva_tras_aceptar: { tipo: "plataforma" },
      respuesta_tras_aviso: { si_ya_respondio_persona: "no_responder" },
      pregunta_sin_respuesta: "handoff_inmediato",
    },
    envios: {
      cobertura: { tipo: "todo_el_pais_salvo", excluidas: [] },
      tiempos: [
        {
          ciudades: ["bogota"],
          texto: t.bogotaTexto,
          corte: {
            ...DATOS_APROBADOS_ASLC.corteBogota,
            dias: [...d.corteDias],
            festivos: { tipo: "ignorar" },
            texto_antes: t.bogotaAntes,
            texto_despues: t.bogotaDespues,
          },
        },
        { ciudades: "resto_con_cobertura", texto: t.restoTexto, dias_habiles: { ...DATOS_APROBADOS_ASLC.diasHabiles } },
      ],
      sin_certeza: DATOS_APROBADOS_ASLC.sinCerteza,
      ciudad_desconocida_en_checkout: "handoff",
      envio_gratis: DATOS_APROBADOS_ASLC.envioGratis,
      transportadora_habitual: transportadora,
      texto_resumen: t.envioResumen,
    },
  };
  const r = checkoutOpcionesSchema.safeParse(candidato);
  if (!r.success) throw new Error(`la configuración completa de ASLC no es válida: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

/**
 * negocio (JSON de la fila): nombre, estilo de atención, políticas para el modelo, nota de envío para la persona responsable y, con los textos
 * aprobados, la información oficial del negocio (ubicación de la bodega, respuesta a quien desconfía y horario del asistente). Sin saludo inventado.
 */
export function negocioCompletoAslc(textos?: Pick<TextosAprobadosAslc, "ubicacion" | "desconfianza">): BusinessConfig {
  const conocimiento = textos
    ? [
        { tema: "Ubicación de la bodega", info: textos.ubicacion },
        { tema: "Si el cliente desconfía o pregunta si es una estafa", info: textos.desconfianza },
        { tema: "Horario del asistente", info: "Este asistente atiende las 24 horas del día, los 7 días de la semana." },
      ]
    : undefined;
  const r = businessConfigSchema.safeParse({
    nombre_negocio: DATOS_APROBADOS_ASLC.nombreNegocio,
    tono: ESTILO_ASLC.tono,
    personalidad: ESTILO_ASLC.personalidad,
    politicas: [...POLITICAS_ASLC],
    ...(conocimiento ? { conocimiento } : {}),
    pedido: { nota_envio_domicilio: TEXTOS_ASLC.notaEnvioPanel },
  });
  if (!r.success) throw new Error(`el negocio de ASLC no es válido: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

// ---------------------------------------------------------------------------
// SQL (se genera; el dueño lo revisa y lo corre: este código nunca toca una base)
// ---------------------------------------------------------------------------

const { idTenant: TENANT, phoneNumberId: PHONE, patronNombre: NOMBRE } = IDENTIDAD_ASLC_PRODUCCION;
/** MISMA identidad que 02 / 04: tenant + phone_number_id + nombre (nunca telefono_negocio). */
export const SQL_IDENTIDAD = `id_tenant::text = '${TENANT}' and phone_number_id::text = '${PHONE}' and nombre_negocio ~* '${NOMBRE}'`;

/** Entregas válidas para aceptar pedidos en el panel: la API exige rol admin o agente (un rol "lectura" no puede decidir). */
const ROLES_QUE_DECIDEN = "rol in ('admin', 'agente')";

const ENCABEZADO_COMUN = (nombre: string) =>
  `-- FASE 3B.9D — ${nombre}
-- GENERADO por lib/agente/activacion-aslc.ts: no se edita a mano (salvo las líneas marcadas con "← EDITAR"); una prueba verifica que este archivo es EXACTAMENTE su salida.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico): si cualquier guarda falla, no queda nada.`;

/** Identifica a ASLC por tenant + phone_number_id + nombre (exactamente UNA fila). Deja v_tenant y v_phone listos. */
const SQL_PASO_IDENTIDAD = `  -- Identidad: UNA sola fila con ese tenant, ese phone_number_id y ese nombre.
  select count(*) into v_filas from public.dulabs_clientes_config where ${SQL_IDENTIDAD};
  if v_filas <> 1 then
    raise exception 'ASLC: se esperaba exactamente UNA fila de dulabs_clientes_config (tenant, phone_number_id y nombre), hay %', v_filas;
  end if;
  select id_tenant, phone_number_id into v_tenant, v_phone from public.dulabs_clientes_config where ${SQL_IDENTIDAD};`;

/** Valida a la persona responsable (y al respaldo) contra el equipo REAL: del mismo negocio, ACTIVA y con un rol que puede decidir pedidos. */
const SQL_PASO_RESPONSABLE = `  -- Persona responsable: obligatoria, del equipo de ASLC, ACTIVA y con rol admin o agente (un rol "lectura" no puede aceptar pedidos).
  if v_responsable is null then
    raise exception 'PATRICIA_REAL_PENDIENTE: edita v_responsable con el id de la persona responsable (ver 08_ver_equipo_solo_lectura.sql)';
  end if;
  if not exists (select 1 from public.dulabs_miembros_equipo where id = v_responsable and tenant_id = v_tenant and estado = 'activo' and ${ROLES_QUE_DECIDEN}) then
    raise exception 'v_responsable (%) no es un miembro ACTIVO del equipo de ASLC con rol admin o agente (un invitado que aún no entró, un suspendido o un rol lectura no sirven)', v_responsable;
  end if;
  if v_respaldo is not null then
    if v_respaldo = v_responsable then
      raise exception 'el respaldo no puede ser la misma persona que la responsable';
    end if;
    if not exists (select 1 from public.dulabs_miembros_equipo where id = v_respaldo and tenant_id = v_tenant and estado = 'activo' and ${ROLES_QUE_DECIDEN}) then
      raise exception 'v_respaldo (%) no es un miembro ACTIVO del equipo de ASLC con rol admin o agente', v_respaldo;
    end if;
  end if;`;

/** La fila del agente que dejó el 02: una, deshabilitada, del tipo y la credencial propios. */
const SQL_CONDICION_FILA_DE_PARTIDA = `phone_number_id = v_phone and id_tenant = v_tenant and tipo = 'catalog_sales' and credencial_ref = '${CREDENCIAL_GEMINI_ASLC}'`;

/** Comprobaciones de que la configuración cargada por el 03 está completa (para 05 y 06). Deja v_opciones y v_responsable. */
const SQL_PASO_CONFIG_COMPLETA = `  -- La configuración COMPLETA (la que carga 03_configurar_completo_sin_activar.sql) debe estar cargada: sin el candado, con el cierre por aceptación humana,
  -- con las reglas de envío, con el checkout conversacional y con una persona responsable ACTIVA.
  select checkout_opciones, checkout_conversacional into v_opciones, v_checkout
    from public.dulabs_agente_runtime_config where ${SQL_CONDICION_FILA_DE_PARTIDA};
  if v_opciones is null then
    raise exception 'ASLC no tiene fila de agente con la credencial propia: corre antes 02_aprovisionar_sin_activar.sql';
  end if;
  if v_opciones -> 'activacion_pendiente' is not null then
    raise exception 'la configuración sigue con el candado activacion_pendiente: corre antes 03_configurar_completo_sin_activar.sql';
  end if;
  if coalesce(v_opciones #>> '{cierre,modo}', '') <> 'aceptacion_humana' or v_opciones -> 'envios' is null or v_opciones -> 'oficina' is null or v_opciones -> 'campos' is null then
    raise exception 'la configuración de ASLC no está completa (cierre, envíos, oficina y campos): corre antes 03_configurar_completo_sin_activar.sql';
  end if;
  if v_checkout is distinct from true then
    raise exception 'checkout_conversacional debe estar encendido (lo enciende 03_configurar_completo_sin_activar.sql)';
  end if;
  v_responsable := (v_opciones #>> '{cierre,responsable,miembro_id}')::bigint;
  if not exists (select 1 from public.dulabs_miembros_equipo where id = v_responsable and tenant_id = v_tenant and estado = 'activo' and ${ROLES_QUE_DECIDEN}) then
    raise exception 'la persona responsable configurada (%) ya no es un miembro ACTIVO de ASLC con rol admin o agente', v_responsable;
  end if;
  -- notificaciones_pedidos debe seguir APAGADO: encendido mandaría también los avisos genéricos de otras etapas del pedido (con el tono de otro negocio).
  if exists (select 1 from public.dulabs_tenant_modulos where id_tenant = v_tenant and modulo = 'notificaciones_pedidos' and habilitado) then
    raise exception 'el módulo notificaciones_pedidos está encendido para ASLC: apágalo antes (mandaría avisos genéricos de otro negocio)';
  end if;`;

const DECLARE_ACTIVACION = `  v_tenant uuid;
  v_phone text;
  v_filas integer;
  v_opciones jsonb;
  v_checkout boolean;
  v_responsable bigint;
  v_restringida text;`;

/** 03 — configuración completa, SIN activar. */
export function generarSqlConfiguracionCompleta(textos: TextosAprobadosAslc): string {
  verificarTextosAprobados(textos);
  const config = configuracionCompletaAslc({ aviso: textos.aviso, trasAvisoConfirma: textos.tras_aviso_confirma, miembroId: 1, decision: decisionDe(textos) });
  const jsonConfig = JSON.stringify(config, null, 2);
  const jsonNegocio = JSON.stringify(negocioCompletoAslc(textos), null, 2);
  if (jsonConfig.includes("$cfg$") || jsonNegocio.includes("$neg$")) throw new Error("el JSON contiene un delimitador reservado del script");
  return `${ENCABEZADO_COMUN("CONFIGURACIÓN COMPLETA DE AQUÍ SÍ LO COMPRAS, SIN ACTIVAR")}
--
-- ANTES DE CORRER: editar las DOS líneas marcadas con "← EDITAR" (v_responsable y v_respaldo). Lo demás no se toca.
--   v_responsable = id (número) de la persona que acepta los pedidos: un miembro ACTIVO del equipo de ASLC con rol admin o agente.
--                   Para ver los ids: 08_ver_equipo_solo_lectura.sql. Una persona recién invitada sigue "invitado" hasta su primer login.
--   v_respaldo    = id de una segunda persona que también puede aceptar (otra distinta), o null si no hay.
--
-- QUÉ HACE:
--   1. Identifica a ASLC (tenant + phone_number_id + nombre): exactamente UNA fila. Exige ia_pausada = true (sigue apagado).
--   2. Valida a v_responsable (y v_respaldo) contra el equipo real: de ASLC, ACTIVOS y con rol admin o agente.
--   3. Exige que la fila del agente exista y siga DESHABILITADA con la credencial propia (la que dejó 02_aprovisionar_sin_activar.sql).
--   4. Exige que el aviso obligatorio de este script sea byte a byte el aprobado (SHA-256), por si el portapapeles lo alteró.
--   5. Reemplaza checkout_opciones por la configuración completa (sin el candado activacion_pendiente) y negocio por sus políticas, y enciende
--      checkout_conversacional (requisito del cierre con aceptación humana).
-- QUÉ NO HACE: no habilita el agente, no toca ia_pausada ni ia_restringida_a, no crea personas, no toca módulos ni otros negocios, no envía nada.
-- Se puede volver a correr mientras la fila siga deshabilitada (p. ej. para cambiar de responsable).
--
-- REVERSA (solo de este script; deja la fila como la dejó el 02). Descomentar y correr:
--   update public.dulabs_agente_runtime_config
--      set checkout_opciones = '{"entregas":["domicilio"],"pagos":[{"metodo":"contra_entrega"}],"activacion_pendiente":true}'::jsonb,
--          negocio = '{"nombre_negocio":"${DATOS_APROBADOS_ASLC.nombreNegocio}"}'::jsonb, checkout_conversacional = false, updated_at = now()
--    where ${SQL_CONDICION_FILA_DE_PARTIDA.replace(/v_phone/g, `'${PHONE}'`).replace(/v_tenant/g, `'${TENANT}'::uuid`)} and habilitado = false;

do $$
declare
  v_responsable bigint := null;  -- ← EDITAR: id de la persona responsable (obligatorio)
  v_respaldo bigint := null;     -- ← EDITAR (opcional): id de la persona de respaldo, o dejar null
  v_tenant uuid;
  v_phone text;
  v_filas integer;
  -- Configuración completa. OJO: miembro_id y respaldo_miembro_id de abajo son MARCADORES; el script los reemplaza con v_responsable y v_respaldo.
  v_config jsonb := $cfg$
${jsonConfig}
$cfg$::jsonb;
  v_negocio jsonb := $neg$
${jsonNegocio}
$neg$::jsonb;
begin
${SQL_PASO_IDENTIDAD}

  -- Estado seguro: la IA sigue pausada (esto NO la activa).
  if not exists (select 1 from public.dulabs_clientes_config where phone_number_id = v_phone and ia_pausada is true) then
    raise exception 'ASLC no está pausado (ia_pausada <> true): abortando sin cambios';
  end if;

${SQL_PASO_RESPONSABLE}

  -- La fila del agente que dejó el 02: UNA, deshabilitada, con la credencial propia.
  select count(*) into v_filas from public.dulabs_agente_runtime_config where ${SQL_CONDICION_FILA_DE_PARTIDA} and habilitado = false;
  if v_filas <> 1 then
    raise exception 'se esperaba la fila del agente de ASLC DESHABILITADA con la credencial propia (la deja 02_aprovisionar_sin_activar.sql); hay %', v_filas;
  end if;

  -- El aviso obligatorio es EXACTAMENTE el aprobado (un portapapeles o editor que cambie una letra, un emoji o un salto de línea lo detiene).
  if encode(sha256(convert_to(v_config #>> '{cierre,textos,aviso}', 'UTF8')), 'hex') <> '${AVISO_OFICIAL_SHA256}' then
    raise exception 'el aviso obligatorio pegado NO es byte a byte el aprobado (¿se alteró al copiar y pegar?): abortando sin cambios';
  end if;

  -- Persona responsable real en la configuración.
  v_config := jsonb_set(v_config, '{cierre,responsable,miembro_id}', to_jsonb(v_responsable));
  v_config := jsonb_set(v_config, '{cierre,responsable,respaldo_miembro_id}', coalesce(to_jsonb(v_respaldo), 'null'::jsonb));

  update public.dulabs_agente_runtime_config
     set checkout_opciones = v_config, negocio = v_negocio, checkout_conversacional = true, updated_at = now()
   where ${SQL_CONDICION_FILA_DE_PARTIDA} and habilitado = false;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'no se pudo actualizar exactamente UNA fila del agente (%): abortando', v_filas;
  end if;

  -- Comprobación final dentro de la misma transacción.
  if exists (
    select 1 from public.dulabs_agente_runtime_config
     where phone_number_id = v_phone
       and (habilitado is distinct from false or checkout_conversacional is distinct from true or checkout_opciones -> 'activacion_pendiente' is not null
            or (checkout_opciones #>> '{cierre,responsable,miembro_id}')::bigint is distinct from v_responsable)
  ) then
    raise exception 'la fila del agente de ASLC no quedó como se esperaba: abortando';
  end if;
  if not exists (select 1 from public.dulabs_clientes_config where phone_number_id = v_phone and ia_pausada is true) then
    raise exception 'ASLC dejó de estar pausado: abortando';
  end if;
end $$;
`;
}

/** 05 — activación CONTROLADA: habilita el agente y quita la pausa, pero SOLO si la IA sigue restringida a números de prueba. */
export function generarSqlActivacionControlada(): string {
  return `${ENCABEZADO_COMUN("ACTIVACIÓN CONTROLADA DE AQUÍ SÍ LO COMPRAS")}
--
-- Correr DESPUÉS de 03_configurar_completo_sin_activar.sql y DESPUÉS de que el código con el cierre por aceptación humana esté desplegado.
--
-- QUÉ HACE:
--   1. Identifica a ASLC (tenant + phone_number_id + nombre): exactamente UNA fila.
--   2. EXIGE que la IA esté restringida a números de prueba (ia_restringida_a no vacío). Si no lo está, SE NIEGA: este script nunca abre al público.
--   3. Exige la configuración completa cargada (sin candado, cierre, envíos, oficina, campos, checkout conversacional) y a la persona responsable ACTIVA.
--   4. Exige que notificaciones_pedidos siga apagado.
--   5. Habilita la fila del agente, enciende la transcripción de notas de voz y quita la pausa de la IA.
-- RESULTADO: el agente contesta SOLO a los números de ia_restringida_a (tu número de prueba). Cualquier otro número queda en silencio.
-- QUÉ NO HACE: no toca ia_restringida_a (sigue protegiendo), notificaciones_pedidos, módulos ni otros negocios.
-- FRENO: 07_freno_de_emergencia.sql pausa la IA al instante. Para abrir al público, DESPUÉS de probar: 06_abrir_al_publico.sql.

do $$
declare
${DECLARE_ACTIVACION}
begin
${SQL_PASO_IDENTIDAD}

  -- Modo controlado: la IA debe seguir restringida a números de prueba.
  select ia_restringida_a into v_restringida from public.dulabs_clientes_config where phone_number_id = v_phone and id_tenant = v_tenant;
  if coalesce(btrim(v_restringida), '') = '' then
    raise exception 'la IA de ASLC NO está restringida a números de prueba: este script no abre al público. Primero restringe: update public.dulabs_clientes_config set ia_restringida_a = ''57XXXXXXXXXX'' where phone_number_id = ''${PHONE}'';';
  end if;

${SQL_PASO_CONFIG_COMPLETA}

  update public.dulabs_agente_runtime_config
     set habilitado = true, transcripcion_audio = true, updated_at = now()
   where ${SQL_CONDICION_FILA_DE_PARTIDA};
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'no se pudo habilitar exactamente UNA fila del agente (%): abortando', v_filas;
  end if;
  update public.dulabs_clientes_config set ia_pausada = false where phone_number_id = v_phone and id_tenant = v_tenant;

  -- Comprobación final dentro de la misma transacción.
  if not exists (
    select 1 from public.dulabs_agente_runtime_config
     where phone_number_id = v_phone and habilitado is true and checkout_conversacional is true and transcripcion_audio is true and meta_token_plataforma is false
  ) then
    raise exception 'la fila del agente de ASLC no quedó habilitada como se esperaba: abortando';
  end if;
  if not exists (select 1 from public.dulabs_clientes_config where phone_number_id = v_phone and ia_pausada is false and coalesce(btrim(ia_restringida_a), '') <> '') then
    raise exception 'ASLC debe quedar SIN pausa y con la restricción a números de prueba: abortando';
  end if;
end $$;
`;
}

/** 06 — abrir al público: quita la restricción (solo con la activación controlada en marcha). */
export function generarSqlAbrirAlPublico(): string {
  return `${ENCABEZADO_COMUN("ABRIR AL PÚBLICO AQUÍ SÍ LO COMPRAS")}
--
-- Correr SOLO cuando la prueba controlada (05) salió bien con tu número de prueba.
--
-- QUÉ HACE:
--   1. Identifica a ASLC (tenant + phone_number_id + nombre): exactamente UNA fila.
--   2. Exige que la activación controlada esté en marcha: fila del agente HABILITADA, IA sin pausa y todavía restringida a números de prueba.
--   3. Vuelve a exigir la configuración completa, a la persona responsable ACTIVA y notificaciones_pedidos apagado.
--   4. Quita la restricción (ia_restringida_a = null): desde ese momento el agente contesta a TODOS los clientes.
-- FRENO: 07_freno_de_emergencia.sql pausa la IA al instante (los mensajes siguen llegando al Inbox para atenderlos a mano).

do $$
declare
${DECLARE_ACTIVACION}
begin
${SQL_PASO_IDENTIDAD}

  -- La activación controlada debe estar en marcha.
  select ia_restringida_a into v_restringida from public.dulabs_clientes_config where phone_number_id = v_phone and id_tenant = v_tenant;
  if coalesce(btrim(v_restringida), '') = '' then
    raise exception 'ASLC ya está abierto al público (ia_restringida_a vacío): nada que hacer';
  end if;
  if not exists (select 1 from public.dulabs_clientes_config where phone_number_id = v_phone and id_tenant = v_tenant and ia_pausada is false) then
    raise exception 'ASLC está pausado: si es la primera activación corre 05_activacion_controlada.sql; si fue un freno (07), corre 10_reanudar_tras_freno.sql';
  end if;
  if not exists (select 1 from public.dulabs_agente_runtime_config where ${SQL_CONDICION_FILA_DE_PARTIDA} and habilitado is true) then
    raise exception 'la fila del agente de ASLC no está habilitada: corre antes 05_activacion_controlada.sql';
  end if;

${SQL_PASO_CONFIG_COMPLETA}

  update public.dulabs_clientes_config set ia_restringida_a = null where phone_number_id = v_phone and id_tenant = v_tenant;

  -- Comprobación final dentro de la misma transacción.
  if not exists (select 1 from public.dulabs_clientes_config where phone_number_id = v_phone and ia_pausada is false and ia_restringida_a is null) then
    raise exception 'ASLC no quedó abierto como se esperaba: abortando';
  end if;
end $$;
`;
}

/** 07 — freno de emergencia: pausa la IA de ASLC al instante (una sola sentencia). */
export function generarSqlFrenoDeEmergencia(): string {
  return `${ENCABEZADO_COMUN("FRENO DE EMERGENCIA DE AQUÍ SÍ LO COMPRAS")}
--
-- Pausa la IA de ASLC AL INSTANTE: el agente deja de contestar (silencio total, nunca otro bot). Los mensajes de los clientes siguen llegando al Inbox
-- para atenderlos a mano. No borra nada ni toca la configuración. Para reanudar: 10_reanudar_tras_freno.sql (deja la restricción tal como estaba).

update public.dulabs_clientes_config
   set ia_pausada = true
 where ${SQL_IDENTIDAD}
returning nombre_negocio, ia_pausada, ia_restringida_a is not null as restringida;
`;
}

/** 10 — reanudar tras el freno (07): quita SOLO la pausa y deja la restricción como estaba (controlado o público). Nunca es la primera activación. */
export function generarSqlReanudarTrasFreno(): string {
  return `${ENCABEZADO_COMUN("REANUDAR LA IA DE AQUÍ SÍ LO COMPRAS TRAS EL FRENO")}
--
-- Correr DESPUÉS de 07_freno_de_emergencia.sql, cuando el problema ya se resolvió.
--
-- QUÉ HACE:
--   1. Identifica a ASLC (tenant + phone_number_id + nombre): exactamente UNA fila.
--   2. Exige que la IA esté pausada (si no, no hay nada que reanudar) y que la fila del agente YA esté habilitada: la primera activación es
--      05_activacion_controlada.sql, no este script.
--   3. Vuelve a exigir la configuración completa, a la persona responsable ACTIVA y notificaciones_pedidos apagado.
--   4. Quita la pausa (ia_pausada = false) y NADA más: ia_restringida_a queda exactamente como estaba. Si ya estaba abierto al público, sigue
--      abierto; si estaba restringido a números de prueba, sigue restringido.

do $$
declare
${DECLARE_ACTIVACION}
begin
${SQL_PASO_IDENTIDAD}

  -- Debe estar pausado y con el agente ya habilitado (esto NO es la primera activación).
  select ia_restringida_a into v_restringida from public.dulabs_clientes_config where phone_number_id = v_phone and id_tenant = v_tenant;
  if not exists (select 1 from public.dulabs_clientes_config where phone_number_id = v_phone and id_tenant = v_tenant and ia_pausada is true) then
    raise exception 'ASLC no está pausado: no hay nada que reanudar';
  end if;
  if not exists (select 1 from public.dulabs_agente_runtime_config where ${SQL_CONDICION_FILA_DE_PARTIDA} and habilitado is true) then
    raise exception 'la fila del agente de ASLC no está habilitada: este script solo reanuda tras el freno; la primera activación es 05_activacion_controlada.sql';
  end if;

${SQL_PASO_CONFIG_COMPLETA}

  update public.dulabs_clientes_config set ia_pausada = false where phone_number_id = v_phone and id_tenant = v_tenant;

  -- Comprobación final dentro de la misma transacción: sin pausa y con la MISMA restricción que tenía.
  if not exists (select 1 from public.dulabs_clientes_config where phone_number_id = v_phone and id_tenant = v_tenant and ia_pausada is false and ia_restringida_a is not distinct from v_restringida) then
    raise exception 'ASLC no quedó reanudado como se esperaba: abortando';
  end if;
end $$;
`;
}

/** 08 — ver el equipo de ASLC (solo lectura): para saber el id de la persona responsable. */
export function generarSqlVerEquipo(): string {
  return `${ENCABEZADO_COMUN("EQUIPO DE AQUÍ SÍ LO COMPRAS (SOLO LECTURA)")}
--
-- Lista a las personas del equipo de ASLC. Para ser RESPONSABLE de aceptar pedidos hace falta: estado = 'activo' y rol = 'admin' o 'agente'.
-- Una persona recién invitada aparece como 'invitado' hasta que entra por primera vez; un 'suspendido' o un rol 'lectura' no sirve.
-- Copia el miembro_id de la persona elegida a v_responsable en 03_configurar_completo_sin_activar.sql (o 09_cambiar_responsable.sql).

select id as miembro_id, nombre, rol, estado, (rol in ('admin', 'agente') and estado = 'activo') as sirve_como_responsable
  from public.dulabs_miembros_equipo
 where tenant_id::text = '${TENANT}'
 order by id;
`;
}

/** 09 — cambiar la persona responsable con la fila ya habilitada (p. ej. cuando exista la persona real). */
export function generarSqlCambiarResponsable(): string {
  return `${ENCABEZADO_COMUN("CAMBIAR LA PERSONA RESPONSABLE DE AQUÍ SÍ LO COMPRAS")}
--
-- ANTES DE CORRER: editar las DOS líneas marcadas con "← EDITAR" (v_responsable y v_respaldo).
-- Sirve con la fila ya habilitada: cambia SOLO cierre.responsable.miembro_id y respaldo_miembro_id de checkout_opciones y deja todo lo demás igual.
-- Los pedidos que ya están pendientes siguen asignados a la persona anterior (se reasignan desde el Inbox); los nuevos van a la persona nueva.

do $$
declare
  v_responsable bigint := null;  -- ← EDITAR: id de la nueva persona responsable (obligatorio)
  v_respaldo bigint := null;     -- ← EDITAR (opcional): id de la persona de respaldo, o dejar null
  v_tenant uuid;
  v_phone text;
  v_filas integer;
  v_opciones jsonb;
begin
${SQL_PASO_IDENTIDAD}

${SQL_PASO_RESPONSABLE}

  select checkout_opciones into v_opciones from public.dulabs_agente_runtime_config where ${SQL_CONDICION_FILA_DE_PARTIDA};
  if v_opciones is null or v_opciones -> 'activacion_pendiente' is not null or coalesce(v_opciones #>> '{cierre,modo}', '') <> 'aceptacion_humana' then
    raise exception 'ASLC no tiene la configuración completa cargada: corre antes 03_configurar_completo_sin_activar.sql';
  end if;
  v_opciones := jsonb_set(v_opciones, '{cierre,responsable,miembro_id}', to_jsonb(v_responsable));
  v_opciones := jsonb_set(v_opciones, '{cierre,responsable,respaldo_miembro_id}', coalesce(to_jsonb(v_respaldo), 'null'::jsonb));

  update public.dulabs_agente_runtime_config set checkout_opciones = v_opciones, updated_at = now() where ${SQL_CONDICION_FILA_DE_PARTIDA};
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'no se pudo actualizar exactamente UNA fila del agente (%): abortando', v_filas;
  end if;
end $$;
`;
}

/**
 * 11 — ajustar el comportamiento con la fila YA habilitada (sin pausar ni reconfigurar nada más): el estilo, las políticas y la información oficial del
 * negocio (negocio), el texto que recibe el cliente cuando contesta "sí" al aviso y la escritura de la transportadora. Es el cambio que lleva una fila
 * cargada por el 03 ANTERIOR a exactamente lo que el 03 de hoy carga en una instalación nueva (una prueba lo verifica en una base local).
 */
export function generarSqlAjustarComportamiento(textos: TextosAprobadosAslc): string {
  verificarTextosAprobados(textos);
  const jsonNegocio = JSON.stringify(negocioCompletoAslc(textos), null, 2);
  const transportadora = DATOS_APROBADOS_ASLC.transportadoraHabitual;
  // Lo que el 03 de hoy carga es la verdad: si algo no coincide, no se genera un script que deje la fila distinta.
  const vigente = configuracionCompletaAslc({ aviso: textos.aviso, trasAvisoConfirma: textos.tras_aviso_confirma, miembroId: 1, decision: decisionDe(textos) });
  const trasAvisoVigente = vigente.cierre?.modo === "aceptacion_humana" ? vigente.cierre.textos.tras_aviso_confirma : undefined;
  if (vigente.oficina?.transportadora !== transportadora || vigente.envios?.transportadora_habitual !== transportadora || trasAvisoVigente !== textos.tras_aviso_confirma || !vigente.envios?.tiempos) {
    throw new Error("el ajuste no coincide con la configuración completa vigente");
  }
  const jsonTiempos = JSON.stringify(vigente.envios.tiempos, null, 2);
  if (jsonNegocio.includes("$neg$") || jsonTiempos.includes("$tiempos$") || textos.tras_aviso_confirma.includes("$tras$") || transportadora.includes("'")) throw new Error("un texto contiene un delimitador reservado del script");
  return `${ENCABEZADO_COMUN("AJUSTAR EL COMPORTAMIENTO DE AQUÍ SÍ LO COMPRAS (CON EL AGENTE YA HABILITADO)")}
--
-- Aplica lo que pidió el negocio sin pausar ni reconfigurar nada más:
--   · negocio: estilo de atención (tono y personalidad), políticas y la información oficial (ubicación de la bodega, respuesta a quien desconfía, horario).
--   · checkout_opciones: el texto que recibe el cliente cuando contesta "sí" al aviso (nombra a la responsable), la escritura de la transportadora y los textos de los tiempos de envío
--     (Bogotá antes y después de las 11:30 y el resto de ciudades: el modelo los repite tal cual y el candado de envíos los acepta).
-- NO toca: ia_pausada, ia_restringida_a, habilitado, el aviso obligatorio, la persona responsable, los módulos ni otros negocios.
-- Se puede repetir sin efectos nuevos. Después: scripts/verificar-aslc-solo-lectura.mts --etapa=controlado (o publico) confirma que la fila sigue válida.

do $$
declare
  v_tenant uuid;
  v_phone text;
  v_filas integer;
  v_negocio jsonb := $neg$
${jsonNegocio}
$neg$::jsonb;
  v_tras text := $tras$${textos.tras_aviso_confirma}$tras$;
  v_tiempos jsonb := $tiempos$
${jsonTiempos}
$tiempos$::jsonb;
begin
${SQL_PASO_IDENTIDAD}

  -- La fila del agente: UNA, con la credencial propia y la configuración completa cargada (sin candado, con el cierre por aceptación humana).
  select count(*) into v_filas from public.dulabs_agente_runtime_config
   where ${SQL_CONDICION_FILA_DE_PARTIDA} and checkout_opciones -> 'activacion_pendiente' is null and coalesce(checkout_opciones #>> '{cierre,modo}', '') = 'aceptacion_humana';
  if v_filas <> 1 then
    raise exception 'se esperaba la fila del agente de ASLC con la configuración completa cargada (sin candado y con el cierre por aceptación humana): corre antes 03_configurar_completo_sin_activar.sql; hay %', v_filas;
  end if;

  -- El aviso obligatorio sigue EXACTO (este script no lo toca; se comprueba por si alguien lo cambió).
  if not exists (select 1 from public.dulabs_agente_runtime_config where ${SQL_CONDICION_FILA_DE_PARTIDA} and encode(sha256(convert_to(checkout_opciones #>> '{cierre,textos,aviso}', 'UTF8')), 'hex') = '${AVISO_OFICIAL_SHA256}') then
    raise exception 'el aviso obligatorio guardado NO es el aprobado: no se ajusta nada';
  end if;

  update public.dulabs_agente_runtime_config
     set negocio = v_negocio,
         checkout_opciones = jsonb_set(jsonb_set(jsonb_set(jsonb_set(checkout_opciones,
           '{cierre,textos,tras_aviso_confirma}', to_jsonb(v_tras)),
           '{oficina,transportadora}', to_jsonb('${transportadora}'::text)),
           '{envios,transportadora_habitual}', to_jsonb('${transportadora}'::text)),
           '{envios,tiempos}', v_tiempos),
         updated_at = now()
   where ${SQL_CONDICION_FILA_DE_PARTIDA};
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'no se pudo actualizar exactamente UNA fila del agente (%): abortando', v_filas;
  end if;

  -- Comprobación final dentro de la misma sentencia.
  if not exists (
    select 1 from public.dulabs_agente_runtime_config
     where ${SQL_CONDICION_FILA_DE_PARTIDA}
       and negocio = v_negocio
       and checkout_opciones #>> '{cierre,textos,tras_aviso_confirma}' = v_tras
       and checkout_opciones #>> '{oficina,transportadora}' = '${transportadora}'
       and checkout_opciones #>> '{envios,transportadora_habitual}' = '${transportadora}'
       and checkout_opciones #> '{envios,tiempos}' = v_tiempos
       and checkout_opciones -> 'activacion_pendiente' is null
  ) then
    raise exception 'la fila del agente de ASLC no quedó como se esperaba: abortando';
  end if;
end $$;
`;
}

/** Módulo que enciende SOLO el mensaje al cliente tras aceptar / rechazar / cancelar (no los avisos genéricos de cada etapa del pedido). */
export const MODULO_AVISOS_DECISION: ModuloId = "avisos_decision_pedidos";

/**
 * 12 — avisos al cliente tras la decisión de una persona (aceptar, rechazar, cancelar un pedido pendiente de aceptación). Con la configuración completa ya
 * cargada: guarda los tres textos en checkout_opciones.cierre.textos y enciende el módulo avisos_decision_pedidos. NO enciende notificaciones_pedidos (que
 * mandaría también los avisos genéricos de cada etapa del pedido, con plantillas de la plataforma) y exige que siga apagado. Se puede repetir.
 */
export function generarSqlAvisosDeDecision(textos: TextosAprobadosAslc): string {
  verificarTextosAprobados(textos);
  const vigente = configuracionCompletaAslc({ aviso: textos.aviso, trasAvisoConfirma: textos.tras_aviso_confirma, miembroId: 1, decision: decisionDe(textos) });
  const cierre = vigente.cierre;
  if (cierre?.modo !== "aceptacion_humana" || !cierre.textos.aceptado || !cierre.textos.rechazado || !cierre.textos.cancelado) throw new Error("la configuración vigente no trae los tres mensajes de decisión");
  const { aceptado, rechazado, cancelado } = cierre.textos;
  if (aceptado.includes("$ac$") || rechazado.includes("$re$") || cancelado.includes("$ca$")) throw new Error("un texto contiene un delimitador reservado del script");
  return `${ENCABEZADO_COMUN("AVISOS AL CLIENTE TRAS ACEPTAR, RECHAZAR O CANCELAR UN PEDIDO (AQUÍ SÍ LO COMPRAS)")}
--
-- TEXTOS PROPUESTOS por DuLabs (no son del negocio): léelos abajo antes de correr. Si el negocio prefiere otros, se ponen en textos-aprobados.json
-- (aceptado / rechazado / cancelado) y este archivo se regenera. Solo admiten el marcador {pedido} (el número público del pedido): ni datos del cliente ni
-- un motivo escrito por el equipo. No prometen fechas, despacho, stock ni alternativas.
--
-- QUÉ HACE (todo o nada, con la fila ya habilitada o no):
--   1. Guarda los tres textos en checkout_opciones.cierre.textos (aceptado, rechazado, cancelado) de la fila del agente de ASLC.
--   2. Enciende el módulo avisos_decision_pedidos de ASLC: SOLO el mensaje tras una decisión de la persona del equipo, dentro de la ventana de 24 h de
--      WhatsApp, una sola vez por pedido y decisión, con el número y el token de ASLC. No cambia el estado de ningún pedido.
-- QUÉ NO HACE: no enciende notificaciones_pedidos (avisos genéricos de cada etapa con plantillas de la plataforma: sigue apagado y este script se niega a
--   correr si alguien lo encendió), no toca ia_pausada, ia_restringida_a, habilitado, el aviso obligatorio, la persona responsable ni otros negocios.
-- Se puede repetir sin efectos nuevos.
--
-- REVERSA: apagar SOLO el módulo (los textos quedan guardados y sin uso):
--   update public.dulabs_tenant_modulos set habilitado = false, updated_at = now()
--    where id_tenant = '${TENANT}'::uuid and modulo = '${MODULO_AVISOS_DECISION}';

do $$
declare
  v_tenant uuid;
  v_phone text;
  v_filas integer;
  v_aceptado text := $ac$${aceptado}$ac$;
  v_rechazado text := $re$${rechazado}$re$;
  v_cancelado text := $ca$${cancelado}$ca$;
begin
${SQL_PASO_IDENTIDAD}

  -- La fila del agente: UNA, con la credencial propia y la configuración completa cargada (sin candado, con el cierre por aceptación humana).
  select count(*) into v_filas from public.dulabs_agente_runtime_config
   where ${SQL_CONDICION_FILA_DE_PARTIDA} and checkout_opciones -> 'activacion_pendiente' is null and coalesce(checkout_opciones #>> '{cierre,modo}', '') = 'aceptacion_humana';
  if v_filas <> 1 then
    raise exception 'se esperaba la fila del agente de ASLC con la configuración completa cargada (sin candado y con el cierre por aceptación humana): corre antes 03_configurar_completo_sin_activar.sql; hay %', v_filas;
  end if;

  -- El aviso obligatorio sigue EXACTO (este script no lo toca; se comprueba por si alguien lo cambió).
  if not exists (select 1 from public.dulabs_agente_runtime_config where ${SQL_CONDICION_FILA_DE_PARTIDA} and encode(sha256(convert_to(checkout_opciones #>> '{cierre,textos,aviso}', 'UTF8')), 'hex') = '${AVISO_OFICIAL_SHA256}') then
    raise exception 'el aviso obligatorio guardado NO es el aprobado: no se ajusta nada';
  end if;

  -- notificaciones_pedidos debe seguir APAGADO: encendido mandaría también los avisos genéricos de cada etapa del pedido (plantillas de la plataforma).
  if exists (select 1 from public.dulabs_tenant_modulos where id_tenant = v_tenant and modulo = 'notificaciones_pedidos' and habilitado) then
    raise exception 'el módulo notificaciones_pedidos está encendido para ASLC: apágalo antes (mandaría avisos genéricos de otro negocio)';
  end if;

  update public.dulabs_agente_runtime_config
     set checkout_opciones = jsonb_set(jsonb_set(jsonb_set(checkout_opciones,
           '{cierre,textos,aceptado}', to_jsonb(v_aceptado)),
           '{cierre,textos,rechazado}', to_jsonb(v_rechazado)),
           '{cierre,textos,cancelado}', to_jsonb(v_cancelado)),
         updated_at = now()
   where ${SQL_CONDICION_FILA_DE_PARTIDA};
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'no se pudo actualizar exactamente UNA fila del agente (%): abortando', v_filas;
  end if;

  insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado)
  values (v_tenant, '${MODULO_AVISOS_DECISION}', true)
  on conflict (id_tenant, modulo) do update set habilitado = true, updated_at = now();

  -- Comprobación final dentro de la misma sentencia.
  if not exists (
    select 1 from public.dulabs_agente_runtime_config
     where ${SQL_CONDICION_FILA_DE_PARTIDA}
       and checkout_opciones #>> '{cierre,textos,aceptado}' = v_aceptado
       and checkout_opciones #>> '{cierre,textos,rechazado}' = v_rechazado
       and checkout_opciones #>> '{cierre,textos,cancelado}' = v_cancelado
       and checkout_opciones -> 'activacion_pendiente' is null
  ) then
    raise exception 'la fila del agente de ASLC no quedó como se esperaba: abortando';
  end if;
  if not exists (select 1 from public.dulabs_tenant_modulos where id_tenant = v_tenant and modulo = '${MODULO_AVISOS_DECISION}' and habilitado) then
    raise exception 'el módulo ${MODULO_AVISOS_DECISION} no quedó encendido: abortando';
  end if;
  if exists (select 1 from public.dulabs_tenant_modulos where id_tenant = v_tenant and modulo = 'notificaciones_pedidos' and habilitado) then
    raise exception 'notificaciones_pedidos quedó encendido: abortando';
  end if;
end $$;
`;
}

/**
 * 13 — además del panel, un correo a la persona responsable cuando un pedido espera su aceptación (cierre.responsable.canales = ["panel", "correo"]).
 * El correo solo lleva el número público del pedido y el enlace al panel (nada del cliente). EXIGE que la persona responsable tenga un correo: sin él el
 * runtime marcaría la configuración como inválida y el agente callaría, así que el script se niega a cambiar nada. Se puede repetir; reversa en el encabezado.
 */
export function generarSqlAvisoPorCorreo(): string {
  return `${ENCABEZADO_COMUN("AVISO POR CORREO A LA PERSONA RESPONSABLE DE AQUÍ SÍ LO COMPRAS")}
--
-- Cuando el cliente confirma su pedido, la conversación se le asigna a la persona responsable y el pedido aparece en Pedidos → Por aceptar (panel). Este script
-- agrega un correo a esa persona (solo el número de pedido y el enlace al panel; ningún dato del cliente), para que no dependa de estar mirando el panel.
--
-- QUÉ HACE: cambia SOLO checkout_opciones.cierre.responsable.canales de la fila del agente de ASLC a ["panel", "correo"].
-- GUARDAS (todo o nada): la fila con la configuración completa cargada; la persona responsable ACTIVA, con rol admin o agente y CON un correo válido
--   (sin correo la configuración quedaría inválida y el agente callaría: por eso se niega).
-- QUÉ NO HACE: no toca ia_pausada, ia_restringida_a, habilitado, módulos, textos ni otros negocios, y no envía nada por sí mismo. El correo sale por Resend
--   (RESEND_API_KEY ya existe en producción); sin la clave el correo simplemente no sale y el panel sigue igual. Remitente opcional: PEDIDOS_EMAIL_FROM.
-- Se puede repetir sin efectos nuevos.
--
-- REVERSA (volver a solo el panel):
--   update public.dulabs_agente_runtime_config
--      set checkout_opciones = jsonb_set(checkout_opciones, '{cierre,responsable,canales}', '["panel"]'::jsonb), updated_at = now()
--    where ${SQL_CONDICION_FILA_DE_PARTIDA.replace(/v_phone/g, `'${PHONE}'`).replace(/v_tenant/g, `'${TENANT}'::uuid`)};

do $$
declare
  v_tenant uuid;
  v_phone text;
  v_filas integer;
  v_opciones jsonb;
  v_responsable bigint;
begin
${SQL_PASO_IDENTIDAD}

  select checkout_opciones into v_opciones from public.dulabs_agente_runtime_config
   where ${SQL_CONDICION_FILA_DE_PARTIDA} and checkout_opciones -> 'activacion_pendiente' is null and coalesce(checkout_opciones #>> '{cierre,modo}', '') = 'aceptacion_humana';
  if v_opciones is null then
    raise exception 'se esperaba la fila del agente de ASLC con la configuración completa cargada (sin candado y con el cierre por aceptación humana): corre antes 03_configurar_completo_sin_activar.sql';
  end if;

  -- La persona responsable: ACTIVA, con rol que decide y CON un correo válido (sin correo, el runtime marcaría la configuración como inválida y el agente callaría).
  v_responsable := (v_opciones #>> '{cierre,responsable,miembro_id}')::bigint;
  if not exists (
    select 1 from public.dulabs_miembros_equipo
     where id = v_responsable and tenant_id = v_tenant and estado = 'activo' and ${ROLES_QUE_DECIDEN}
       and btrim(coalesce(email, '')) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ) then
    raise exception 'la persona responsable configurada (%) no es un miembro ACTIVO de ASLC con rol admin o agente y un correo válido: no se cambia nada', v_responsable;
  end if;

  update public.dulabs_agente_runtime_config
     set checkout_opciones = jsonb_set(checkout_opciones, '{cierre,responsable,canales}', '["panel","correo"]'::jsonb), updated_at = now()
   where ${SQL_CONDICION_FILA_DE_PARTIDA};
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'no se pudo actualizar exactamente UNA fila del agente (%): abortando', v_filas;
  end if;

  -- Comprobación final dentro de la misma sentencia.
  if not exists (
    select 1 from public.dulabs_agente_runtime_config
     where ${SQL_CONDICION_FILA_DE_PARTIDA}
       and checkout_opciones #> '{cierre,responsable,canales}' = '["panel","correo"]'::jsonb
       and checkout_opciones -> 'activacion_pendiente' is null
  ) then
    raise exception 'la fila del agente de ASLC no quedó como se esperaba: abortando';
  end if;
end $$;
`;
}

/** Los archivos que genera este módulo (nombre -> contenido). Los textos aprobados vienen de textos-aprobados.json (el código no trae ninguno). */
export function archivosDeActivacion(textos: TextosAprobadosAslc): Readonly<Record<string, string>> {
  return Object.freeze({
    "03_configurar_completo_sin_activar.sql": generarSqlConfiguracionCompleta(textos),
    "05_activacion_controlada.sql": generarSqlActivacionControlada(),
    "06_abrir_al_publico.sql": generarSqlAbrirAlPublico(),
    "07_freno_de_emergencia.sql": generarSqlFrenoDeEmergencia(),
    "08_ver_equipo_solo_lectura.sql": generarSqlVerEquipo(),
    "09_cambiar_responsable.sql": generarSqlCambiarResponsable(),
    "10_reanudar_tras_freno.sql": generarSqlReanudarTrasFreno(),
    "11_ajustar_comportamiento.sql": generarSqlAjustarComportamiento(textos),
    "12_avisos_de_decision.sql": generarSqlAvisosDeDecision(textos),
    "13_aviso_por_correo.sql": generarSqlAvisoPorCorreo(),
  });
}

// ---------------------------------------------------------------------------
// Verificación por etapas (pura: la usa scripts/verificar-aslc-solo-lectura.mts con datos leídos en SOLO LECTURA)
// ---------------------------------------------------------------------------

export const ETAPAS_ASLC = ["inicial", "aprovisionado", "configurado", "controlado", "publico"] as const;
export type EtapaAslc = (typeof ETAPAS_ASLC)[number];

/** checkout_opciones tal como está guardado (JSON sin validar): solo lo que la verificación mira. */
interface OpcionesGuardadas {
  activacion_pendiente?: unknown;
  pagos?: Array<{ metodo?: unknown }>;
  envios?: unknown;
  cierre?: { modo?: unknown; textos?: { aviso?: unknown }; responsable?: { miembro_id?: unknown; respaldo_miembro_id?: unknown } };
}

/** Fila de dulabs_agente_runtime_config tal como la devuelve la base (puede traer más columnas). */
export interface FilaAgenteVerificable {
  habilitado?: boolean;
  credencial_ref?: unknown;
  herramientas?: string[] | null;
  checkout_conversacional?: boolean | null;
  transcripcion_audio?: boolean | null;
  meta_token_plataforma?: boolean | null;
  vocabulario?: unknown;
  checkout_opciones?: OpcionesGuardadas | null;
  [columna: string]: unknown;
}

export interface DatosEtapaAslc {
  iaPausada: boolean | null;
  /** dulabs_clientes_config.ia_restringida_a: lista separada por comas; vacío o null = abierto a todos. */
  iaRestringidaA: string | null;
  /** Filas del agente del número de ASLC (0 o 1). */
  agenteAslc: readonly FilaAgenteVerificable[];
  /** Filas del agente de los OTROS números: solo para comprobar que nadie comparte la credencial de ASLC. */
  agentesOtros: ReadonlyArray<{ credencial_ref?: unknown }>;
  modulosAslc: ReadonlyArray<{ modulo: string; habilitado: boolean }>;
  equipo: ReadonlyArray<{ id: number; rol: string; estado: string }>;
}

const listaDeNumeros = (csv: string | null): string[] => (csv ?? "").split(",").map((x) => x.trim()).filter(Boolean);

/**
 * El checklist de cada etapa (true = bien). La fila se juzga con el MISMO parser y las MISMAS compuertas que usa el runtime en producción (`funciones3b`
 * solo existe para pruebas), no con una copia de sus reglas. Sin etapa solo informa el estado de seguridad básico.
 */
export function comprobacionesDeEtapa(etapa: EtapaAslc | null, d: DatosEtapaAslc, opts: { funciones3b?: Readonly<Record<FuncionFase3B, boolean>> } = {}): Record<string, boolean> {
  const a = d.agenteAslc[0];
  const op = a?.checkout_opciones ?? null;
  const cierre = op?.cierre;
  const habilitadoMod = (m: string) => d.modulosAslc.some((x) => x.modulo === m && x.habilitado === true);
  const decide = (id: unknown) => typeof id === "number" && d.equipo.some((m) => m.id === id && m.estado === "activo" && (m.rol === "admin" || m.rol === "agente"));
  const soloContraEntrega = !!a && JSON.stringify((op?.pagos ?? []).map((p) => p.metodo)) === JSON.stringify(["contra_entrega"]);
  const modulosDelPedido = habilitadoMod("catalogo") && habilitadoMod("pedidos") && habilitadoMod("pedidos_por_aceptar");
  const credencialNoCompartida = !d.agentesOtros.some((o) => o.credencial_ref === CREDENCIAL_GEMINI_ASLC);
  const sinConfirmOrder = !!a && !(a.herramientas ?? []).includes("confirm_order");

  /** La configuración COMPLETA que carga el 03 (y que 05 / 06 / 10 vuelven a exigir). */
  const configuracionCompleta = (): Record<string, boolean> => {
    const aviso = cierre?.textos?.aviso;
    const respaldo = cierre?.responsable?.respaldo_miembro_id ?? null;
    return {
      una_fila_de_agente: d.agenteAslc.length === 1,
      credencial_propia_no_compartida: !!a && a.credencial_ref === CREDENCIAL_GEMINI_ASLC && credencialNoCompartida,
      sin_candado_de_activacion: !!op && op.activacion_pendiente === undefined,
      cierre_aceptacion_humana: cierre?.modo === "aceptacion_humana",
      envios_cargados: !!op?.envios,
      checkout_conversacional_encendido: a?.checkout_conversacional === true,
      sin_confirm_order: sinConfirmOrder,
      solo_contra_entrega: soloContraEntrega,
      aviso_oficial_exacto: typeof aviso === "string" && Buffer.byteLength(aviso, "utf8") === AVISO_OFICIAL_BYTES && sha256Utf8(aviso) === AVISO_OFICIAL_SHA256,
      responsable_activa_con_rol_que_decide: decide(cierre?.responsable?.miembro_id),
      respaldo_valido_si_hay: respaldo === null || (respaldo !== cierre?.responsable?.miembro_id && decide(respaldo)),
      valida_con_las_compuertas_reales: !!a && parseAgentConfig({ ...a, habilitado: true }, { tenantId: TENANT, phoneNumberId: PHONE }, { funciones3b: opts.funciones3b }).kind === "ok",
      modulos_catalogo_pedidos_por_aceptar: modulosDelPedido,
    };
  };

  const checks: Record<string, boolean> = { notificaciones_pedidos_apagado: !habilitadoMod("notificaciones_pedidos") };
  if (etapa === null || etapa === "inicial" || etapa === "aprovisionado" || etapa === "configurado") {
    checks.ia_pausada = d.iaPausada === true;
    checks.sin_agente_habilitado = !d.agenteAslc.some((x) => x.habilitado === true);
  }
  if (etapa === "inicial") {
    checks.sin_fila_de_agente = d.agenteAslc.length === 0;
    checks.sin_modulos = d.modulosAslc.length === 0;
  }
  if (etapa === "aprovisionado") {
    checks.una_fila_de_agente = d.agenteAslc.length === 1;
    checks.fila_deshabilitada_con_candado =
      !!a &&
      a.habilitado === false &&
      op?.activacion_pendiente === true &&
      a.credencial_ref === CREDENCIAL_GEMINI_ASLC &&
      a.checkout_conversacional === false &&
      a.transcripcion_audio === false &&
      a.meta_token_plataforma === false &&
      a.vocabulario === null &&
      sinConfirmOrder;
    checks.solo_contra_entrega = soloContraEntrega;
    checks.modulos_catalogo_pedidos_por_aceptar = modulosDelPedido;
    checks.credencial_no_compartida = credencialNoCompartida;
  }
  if (etapa === "configurado") {
    Object.assign(checks, configuracionCompleta());
    checks.fila_deshabilitada = !!a && a.habilitado === false;
  }
  if (etapa === "controlado" || etapa === "publico") {
    Object.assign(checks, configuracionCompleta());
    checks.agente_habilitado = !!a && a.habilitado === true;
    checks.transcripcion_audio_encendida = !!a && a.transcripcion_audio === true;
    checks.ia_activa_sin_pausa = d.iaPausada === false;
    if (etapa === "controlado") checks.restringida_a_numeros_de_prueba = listaDeNumeros(d.iaRestringidaA).length > 0;
    else checks.sin_restriccion_abierta_al_publico = listaDeNumeros(d.iaRestringidaA).length === 0;
  }
  return checks;
}
