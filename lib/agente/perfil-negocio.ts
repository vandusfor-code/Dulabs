/**
 * PERFIL COMERCIAL DE CADA NEGOCIO (catalog_sales multi-negocio).
 *
 * Lo que cambia de un negocio a otro SIN tocar el motor:
 *   - vocabulario (columna dulabs_agente_runtime_config.vocabulario): cómo se nombra lo que vende
 *     (botón de búsqueda, ejemplos, palabras que señalan un producto o que nunca son un nombre).
 *   - opciones del checkout (columna checkout_opciones): entregas y pagos que el negocio OFRECE, en
 *     qué orden, con qué política (un pago solo con cierta entrega) y sus textos propios.
 *
 * Los MÉTODOS son un catálogo CERRADO de la plataforma (DELIVERY_TYPES / PAYMENT_METHODS, los mismos
 * valores que los CHECK de la BD): cada negocio elige un subconjunto, nunca inventa uno, y el modelo
 * no los decide (los lee y valida el backend).
 *
 * Neutral por defecto: sin vocabulario configurado se habla de "producto" (nunca de joyas). Sin
 * opciones de checkout, un número con checkout conversacional es config INVÁLIDA (fail-closed).
 *
 * PERFIL_LEGADO = el comportamiento ANTERIOR a esta generalización (el de Delacour, único negocio con
 * agente). Solo se usa cuando la fila se leyó SIN las columnas nuevas (la migración
 * 20261205000000_dulabs_agente_perfil_negocio.sql aún no se aplicó): así el despliegue del código antes
 * que la migración no cambia nada. La migración escribe ese mismo perfil EXPLÍCITO en la fila de
 * Delacour (la prueba de paridad verifica que sean idénticos).
 */
import { z } from "zod";
import { DELIVERY_TYPES, PAYMENT_METHODS, POLICY_MINUTES_MAX, type AcceptancePolicy, type AcceptedReservation, type DeliveryType, type PaymentMethod } from "@/lib/catalogo/pedidos/contrato";
import { DOCUMENT_RETENTION_DAYS_MAX, DOCUMENT_TYPE_CODE, DOCUMENTO_SIN_TIPO } from "@/lib/catalogo/pedidos/documento";
import { normalizar } from "@/lib/agente/lenguaje/normalizar";
import { MARCADORES_PERMITIDOS, plantillaValida, type ClaveTextoDecision } from "@/lib/agente/textos-cliente";
import { MARCADORES_ETAPA } from "@/lib/agente/textos-etapa";

// ---------------------------------------------------------------------------
// Vocabulario
// ---------------------------------------------------------------------------

/** Palabra o frase ya normalizada (minúsculas, sin tildes ni signos): se compara con el texto normalizado. */
const frase = z
  .string()
  .min(2)
  .max(40)
  .refine((w) => normalizar(w) === w, "debe estar normalizada (minúsculas, sin tildes ni signos)");
/** UNA palabra normalizada (sin espacios). */
const palabra = frase.refine((w) => !w.includes(" "), "una sola palabra");

export const vocabularioSchema = z
  .object({
    /** Sustantivo de lo que vende, sin artículo: "qué {producto} buscas". */
    producto: z.string().trim().min(2).max(30),
    /** Título del botón de búsqueda del menú de inicio (WhatsApp: máximo 20 caracteres). */
    boton_buscar: z.string().trim().min(2).max(20),
    /** Ejemplos REALES de búsqueda del negocio. El texto corto usa los dos primeros; el largo, todos. */
    ejemplos: z.array(z.string().trim().min(2).max(40)).max(5),
    /** Qué conviene entender al inicio (orientación del modelo), p. ej. "tipo de producto, presupuesto". */
    pistas_busqueda: z.string().trim().min(3).max(160),
    /** Palabras o frases que señalan que el cliente pide un producto ("quiero dos aretes"). */
    palabras_producto: z.array(frase).max(120),
    /**
     * Palabras de producto que, en el paso de la dirección y sin número, indican que el mensaje no es
     * una dirección. Opcional: sin ella se usan las palabras de `palabras_producto` (de una palabra).
     */
    palabras_producto_direccion: z.array(palabra).max(120).optional(),
    /** Palabras que nunca forman parte del nombre de una persona (productos del negocio). */
    no_es_nombre: z.array(palabra).max(120),
    /** Palabras de `no_es_nombre` que sí aparecen en nombres de negocio ("Joyas Mary"): válidas junto a una palabra propia. */
    nombre_comercial: z.array(palabra).max(30),
  })
  .strict();

export type Vocabulario = z.infer<typeof vocabularioSchema>;

/** Vocabulario NEUTRAL de la plataforma: "producto". Nunca supone un rubro. */
export const VOCABULARIO_NEUTRAL: Vocabulario = Object.freeze({
  producto: "producto",
  boton_buscar: "🔎 Buscar producto",
  ejemplos: [],
  pistas_busqueda: "tipo de producto, características, presupuesto",
  palabras_producto: [],
  no_es_nombre: [],
  nombre_comercial: [],
});

/**
 * Fase 3B.9A — ¿es el vocabulario NEUTRAL de la plataforma (el de un negocio sin vocabulario configurado)? Los textos por defecto que
 * mencionan un rubro concreto (el saludo con 💍, los ejemplos de joyería del prompt) solo se usan con un vocabulario que NO es el neutral:
 * un negocio neutral nunca recibe palabras de otro rubro.
 */
export const esVocabularioNeutral = (v: Vocabulario): boolean => JSON.stringify(v) === JSON.stringify(VOCABULARIO_NEUTRAL);

// ---------------------------------------------------------------------------
// Opciones del checkout
// ---------------------------------------------------------------------------

const entregaSchema = z.enum(DELIVERY_TYPES);
const pagoSchema = z.enum(PAYMENT_METHODS);

// ---------------------------------------------------------------------------
// FASE 3B.3 — bloques nuevos de configuración (checkout con aceptación del negocio).
//
// TODOS OPCIONALES: sin ellos el checkout es exactamente el de siempre (Delacour no cambia).
// SIN VALORES COMERCIALES POR DEFECTO: cada decisión pendiente del negocio (D1–D18) es un campo
// OBLIGATORIO dentro de su bloque; si el bloque se usa sin decidirla, la configuración es inválida.
// Mientras el runtime no implemente un bloque (Fases 3B.4–3B.6), usarlo también es configuración
// inválida (funcionesNoDisponibles): nadie puede encenderlo a medias.
// ---------------------------------------------------------------------------

/**
 * Texto que el sistema envía TAL CUAL (sin IA, sin resumir ni parafrasear): se valida, nunca se
 * transforma (ni siquiera se recorta), para que lo guardado sea exactamente lo que sale.
 */
const textoControlado = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => s.trim() === s && s.trim().length > 0, "sin espacios al inicio ni al final");
/**
 * Fase 3B.8 — texto del negocio para el cliente tras una decisión humana (aceptar, rechazar, cancelar). Se envía tal cual; solo
 * admite los marcadores cerrados de textos-cliente.ts ({pedido} y, en rechazo y cancelación, {motivo}).
 */
const plantillaDecision = (clave: ClaveTextoDecision) =>
  textoControlado(500).refine((s) => plantillaValida(s, MARCADORES_PERMITIDOS[clave]), "solo admite los marcadores {pedido} y, en rechazo y cancelación, {motivo}");
/**
 * Fase 3B.9F — texto del negocio para el cliente cuando su pedido, ya aceptado, avanza de etapa ("en preparación", "enviado", "entregado"). Se envía tal cual; solo admite
 * el marcador cerrado {pedido} (textos-cliente.ts): ningún dato del cliente ni un motivo escrito por el equipo.
 */
const plantillaEtapa = () => textoControlado(500).refine((s) => plantillaValida(s, MARCADORES_ETAPA), "solo admite el marcador {pedido}");
/** Fase 3B.8 — texto fijo de envíos: sin marcadores (se envía exactamente como está escrito). */
const textoSinMarcadores = (max: number) => textoControlado(max).refine((s) => plantillaValida(s, []), "este texto no admite llaves {}");
/** Ciudad o municipio normalizado (minúsculas, sin tildes ni signos) para compararlo con lo que escribe el cliente. */
const ciudadNormalizada = frase;
const minutosPolitica = z.number().int().min(1).max(POLICY_MINUTES_MAX);
const codigoDocumento = z.string().regex(DOCUMENT_TYPE_CODE, "código en minúsculas (p. ej. cc, ce)");

/** Datos del pedido que el negocio pide (sin el bloque: los de siempre). */
const camposSchema = z
  .object({
    /** Nombre y apellido (no un solo nombre). */
    nombre_completo: z.boolean().optional(),
    /** D3: teléfono de contacto; si se pide, ¿vale "este mismo WhatsApp"? */
    telefono: z
      .discriminatedUnion("modo", [
        z.object({ modo: z.literal("no_pedir") }).strict(),
        z.object({ modo: z.literal("requerido"), acepta_mismo_whatsapp: z.boolean() }).strict(),
      ])
      .optional(),
    departamento: z.boolean().optional(),
    /** Barrio con entrega a domicilio. */
    barrio: z.boolean().optional(),
  })
  .strict();

/** D4: documento para reclamar en oficina (tipos, retención; negarse siempre pasa a una persona). */
const documentoOficinaSchema = z.discriminatedUnion("modo", [
  z.object({ modo: z.literal("no_pedir") }).strict(),
  z
    .object({
      modo: z.literal("requerido"),
      /**
       * Tipos aceptados, o "sin_especificar" (D4 pendiente: el documento se recibe como texto, sin tipo).
       * Elegir "sin_especificar" es una decisión EXPLÍCITA de la configuración, no un valor por defecto.
       */
      tipos: z.union([z.literal("sin_especificar"), z.array(codigoDocumento).min(1).max(10)]),
      retencion: z.discriminatedUnion("tipo", [
        z.object({ tipo: z.literal("sin_borrado_automatico") }).strict(),
        z.object({ tipo: z.literal("dias"), dias: z.number().int().min(1).max(DOCUMENT_RETENTION_DAYS_MAX) }).strict(),
      ]),
      si_se_niega: z.literal("handoff"),
    })
    .strict(),
]);

/** D2: entrega en oficina de la transportadora. Obligatorio si `entregas` la incluye. */
const oficinaSchema = z
  .object({
    /** Nombre que ve el cliente (lo define el negocio; nunca uno fijo en el código). */
    transportadora: textoControlado(60),
    oferta: z.enum(["boton", "solo_si_cliente_pide"]),
    pide_direccion: z.boolean(),
    pide_barrio: z.boolean(),
    seleccion: z.discriminatedUnion("tipo", [
      z.object({ tipo: z.literal("texto_libre") }).strict(),
      z.object({ tipo: z.literal("lista"), oficinas: z.array(textoControlado(160)).min(1).max(500) }).strict(),
    ]),
    documento: documentoOficinaSchema,
  })
  .strict();

/** Cómo termina el checkout: el botón de siempre, o el envío a aceptación del negocio. */
const cierreSchema = z.discriminatedUnion("modo", [
  z.object({ modo: z.literal("boton_confirmar") }).strict(),
  z
    .object({
      modo: z.literal("aceptacion_humana"),
      /** D1: ¿el cliente valida el resumen con un botón antes del aviso? */
      validacion_resumen: z.enum(["boton_datos_correctos", "sin_validacion"]),
      /** D14: ¿se le muestra el número de pedido? */
      mostrar_numero_pedido: z.boolean(),
      /** Aviso obligatorio y respuesta si el cliente confirma después: textos EXACTOS del negocio. */
      textos: z
        .object({
          aviso: textoControlado(2000),
          tras_aviso_confirma: textoControlado(500),
          /** Fase 3B.8 (opcionales: sin ellos NO se le escribe nada al cliente al decidir): lo decide el negocio, nunca un valor por defecto. */
          aceptado: plantillaDecision("aceptado").optional(),
          rechazado: plantillaDecision("rechazado").optional(),
          cancelado: plantillaDecision("cancelado").optional(),
          /** Fase 3B.9F (opcionales: sin ellos NO se le escribe nada al cliente al cambiar de etapa): aviso de "en preparación", "enviado" y "entregado". */
          en_preparacion: plantillaEtapa().optional(),
          enviado: plantillaEtapa().optional(),
          entregado: plantillaEtapa().optional(),
        })
        .strict(),
      /** D8: persona responsable (miembro del equipo DEL MISMO negocio), su respaldo y por dónde se le avisa. */
      responsable: z
        .object({
          miembro_id: z.number().int().positive(),
          respaldo_miembro_id: z.number().int().positive().nullable(),
          canales: z.array(z.enum(["panel", "correo", "whatsapp"])).min(1).max(3),
          /** Solo con canal whatsapp: destino y plantilla aprobada por Meta (fuera de la ventana de 24 h). */
          whatsapp: z
            .object({ destino: z.string().regex(/^[0-9]{8,15}$/), plantilla: z.string().regex(/^[a-z0-9_]{1,512}$/), idioma: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/) })
            .strict()
            .optional(),
        })
        .strict(),
      /** D7: quién puede aceptar el pedido en el panel. */
      aceptan: z.enum(["solo_responsable", "responsable_y_admins"]),
      /** D5: stock mientras espera (nunca hereda las 72 h). */
      reserva: z.discriminatedUnion("tipo", [z.object({ tipo: z.literal("sin_reserva") }).strict(), z.object({ tipo: z.literal("ttl"), minutos: minutosPolitica }).strict()]),
      /** D6: si nadie lo acepta ni lo cierra. */
      vencimiento: z.discriminatedUnion("tipo", [z.object({ tipo: z.literal("sin_vencimiento") }).strict(), z.object({ tipo: z.literal("tras"), minutos: minutosPolitica }).strict()]),
      /** D18: plazo de la reserva al aceptar. */
      reserva_tras_aceptar: z.discriminatedUnion("tipo", [z.object({ tipo: z.literal("plataforma") }).strict(), z.object({ tipo: z.literal("ttl"), minutos: minutosPolitica }).strict()]),
      /** D11: si una persona ya le escribió al cliente, ¿el sistema igual responde tras el aviso? */
      respuesta_tras_aviso: z.object({ si_ya_respondio_persona: z.enum(["no_responder", "responder"]) }).strict(),
      /** D12: pregunta sin respuesta verificable durante el checkout. */
      pregunta_sin_respuesta: z.enum(["handoff_inmediato", "seguir_checkout"]),
    })
    .strict(),
]);

const diaSemana = z.enum(["lun", "mar", "mie", "jue", "vie", "sab", "dom"]);
/** D10: corte horario (p. ej. "pedidos antes de las 11:30 pueden salir el mismo día"); festivos explícitos. */
const corteSchema = z
  .object({
    hora_limite: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    zona_horaria: z.literal("America/Bogota"),
    dias: z.array(diaSemana).min(1).max(7),
    festivos: z.discriminatedUnion("tipo", [
      z.object({ tipo: z.literal("ignorar") }).strict(),
      z.object({ tipo: z.literal("no_aplica_en"), fechas: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(60) }).strict(),
    ]),
    texto_antes: textoControlado(300),
    texto_despues: textoControlado(300),
  })
  .strict();

/** Envíos (D9 cobertura, D10 tiempos). Sin certeza => siempre una persona (regla del negocio). */
const enviosSchema = z
  .object({
    cobertura: z.discriminatedUnion("tipo", [
      z.object({ tipo: z.literal("lista_blanca"), ciudades: z.array(ciudadNormalizada).min(1).max(1200) }).strict(),
      z.object({ tipo: z.literal("todo_el_pais_salvo"), excluidas: z.array(ciudadNormalizada).max(1200) }).strict(),
    ]),
    tiempos: z
      .array(
        z
          .object({
            ciudades: z.union([z.array(ciudadNormalizada).min(1).max(1200), z.literal("resto_con_cobertura")]),
            texto: textoControlado(300),
            /**
             * Fase 3B.6: el rango en DÍAS HÁBILES que el negocio declara (opcional: sin él, solo existe su texto y el
             * sistema no afirma ningún número). Nunca se convierte en fechas (no hay calendario de festivos confiable).
             */
            dias_habiles: z
              .object({ min: z.number().int().min(0).max(30), max: z.number().int().min(0).max(30) })
              .strict()
              .refine((d) => d.min <= d.max, "dias_habiles: min no puede superar a max")
              .optional(),
            /** Fase 3B.6: transportadora que el negocio fija para ESTAS ciudades (opcional; sin ella no se promete ninguna). */
            transportadora: textoControlado(60).optional(),
            corte: corteSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    sin_certeza: z.literal("handoff"),
    /** D9: ciudad sin certeza de cobertura en el checkout. */
    ciudad_desconocida_en_checkout: z.enum(["handoff", "continuar"]),
    /** Línea del resumen sobre el envío (texto del negocio). */
    texto_resumen: textoControlado(120).optional(),
    /** Fase 3B.6: el envío es GRATIS (regla del negocio). Sin esto, el sistema no dice nada del costo del envío. */
    envio_gratis: z.boolean().optional(),
    /** Fase 3B.6: transportadora más frecuente del negocio (información, no una promesa para cada ciudad). */
    transportadora_habitual: textoControlado(60).optional(),
    /**
     * Fase 3B.8: lo que se le dice al cliente cuando el motor de envíos no da tiempos (opcionales; sin ellos rige el mensaje
     * neutro de siempre). Tres situaciones distintas: excluida explícitamente / no verificable / error técnico.
     */
    textos: z
      .object({
        sin_cobertura: textoSinMarcadores(300).optional(),
        cobertura_no_verificable: textoSinMarcadores(300).optional(),
        error_consulta: textoSinMarcadores(300).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** D17: motivos con los que el backend pasa a una persona SIN depender del modelo. */
export const MOTIVOS_HANDOFF_DETERMINISTAS = ["queja", "garantia", "devolucion", "cambio", "problema_pedido", "problema_entrega", "solicitud_especial", "inconforme"] as const;
const handoffSchema = z
  .object({
    motivos_deterministas: z.array(z.enum(MOTIVOS_HANDOFF_DETERMINISTAS)).min(1).max(MOTIVOS_HANDOFF_DETERMINISTAS.length),
    /** D13: mensaje al pasar a una persona (texto del negocio). */
    texto: textoControlado(300).optional(),
  })
  .strict();

/** D13: respuestas fijas del negocio (se envían tal cual). */
const textosSchema = z
  .object({
    ubicacion: textoControlado(500).optional(),
    confianza: textoControlado(800).optional(),
    agotado: textoControlado(300).optional(),
  })
  .strict();

export const checkoutOpcionesSchema = z
  .object({
    /** Entregas que ofrece el negocio, en el orden de los botones. Una sola => no se pregunta. */
    entregas: z.array(entregaSchema).min(1).max(DELIVERY_TYPES.length),
    /**
     * Pagos que ofrece, en el orden de los botones. `solo_con` = política: ese pago solo se ofrece con
     * esas entregas (sin ella, con todas; "contra_entrega" nunca con recoger en tienda).
     */
    pagos: z
      .array(z.object({ metodo: pagoSchema, solo_con: z.array(entregaSchema).min(1).max(DELIVERY_TYPES.length).optional() }).strict())
      .min(1)
      .max(PAYMENT_METHODS.length),
    /** Textos propios (opcionales). Sin ellos se arman con los nombres de los métodos ofrecidos. */
    mensajes: z
      .object({
        /** El cliente duda sin decir qué cambia ("me equivoqué"). */
        duda: z.string().trim().min(1).max(400).optional(),
        /** Pide un pago que no se ofrece para su entrega ("contra entrega" con domicilio, si no se ofrece). */
        pago_no_disponible: z.string().trim().min(1).max(400).optional(),
        /** Recordatorio del paso de la entrega (p. ej. tras una nota de voz). */
        recordatorio_entrega: z.string().trim().min(1).max(200).optional(),
        /** Recordatorio del paso del pago. */
        recordatorio_pago: z.string().trim().min(1).max(200).optional(),
      })
      .strict()
      .optional(),
    /**
     * Fase 3B.9A — CANDADO de activación: un negocio aprovisionado pero todavía NO listo (faltan el responsable real, textos aprobados,
     * cobertura…) lleva `activacion_pendiente: true`. Mientras esté, la configuración es INVÁLIDA (el agente no responde, aunque alguien
     * habilite la fila por error) y NUNCA cae a otro bot. Se quita al activar, reemplazando todo el bloque por la configuración completa.
     */
    activacion_pendiente: z.literal(true).optional(),
    // --- Fase 3B.3 (opcionales; ver arriba) ---
    campos: camposSchema.optional(),
    oficina: oficinaSchema.optional(),
    cierre: cierreSchema.optional(),
    envios: enviosSchema.optional(),
    handoff: handoffSchema.optional(),
    textos: textosSchema.optional(),
  })
  .strict()
  .superRefine((o, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (new Set(o.entregas).size !== o.entregas.length) issue("entregas repetidas");
    if (new Set(o.pagos.map((p) => p.metodo)).size !== o.pagos.length) issue("pagos repetidos");
    for (const p of o.pagos) {
      if (p.solo_con && new Set(p.solo_con).size !== p.solo_con.length) issue(`${p.metodo}: solo_con repetido`);
      if (p.solo_con?.some((e) => !o.entregas.includes(e))) issue(`${p.metodo}: solo_con con una entrega que no se ofrece`);
      if (p.metodo === "contra_entrega" && p.solo_con?.includes("tienda")) issue("contra_entrega no aplica a recoger en tienda");
      if (entregasDelPago(o, p).length === 0) issue(`${p.metodo}: no aplica a ninguna entrega ofrecida`);
    }
    // Cada entrega ofrecida debe tener al menos un pago: si no, el checkout no podría terminar.
    for (const e of o.entregas) if (pagosPara(o, e).length === 0) issue(`${e}: sin ningún pago disponible`);
    // Fase 3B: la oficina existe si y solo si se ofrece esa entrega.
    const conOficina = o.entregas.includes("oficina_transportadora");
    if (conOficina && !o.oficina) issue("oficina_transportadora: falta el bloque `oficina` (transportadora, oferta, selección y documento)");
    if (!conOficina && o.oficina) issue("bloque `oficina` sin ofrecer la entrega oficina_transportadora");
    // Fase 3B.4: los datos nuevos (y la oficina) solo se guardan en el envío a aceptación: con el botón
    // "Confirmar" de siempre se perderían, así que sin cierre por aceptación la configuración es inválida.
    const conAceptacion = o.cierre?.modo === "aceptacion_humana";
    if ((o.campos || conOficina) && !conAceptacion) issue("`campos` y la oficina de transportadora requieren cierre con aceptación (`cierre.modo = aceptacion_humana`)");
    if (o.cierre?.modo === "aceptacion_humana") {
      const r = o.cierre.responsable;
      if (new Set(r.canales).size !== r.canales.length) issue("responsable: canales repetidos");
      if (r.canales.includes("whatsapp") !== Boolean(r.whatsapp)) issue("responsable: el canal whatsapp requiere `whatsapp` (destino, plantilla, idioma) y viceversa");
      if (r.respaldo_miembro_id !== null && r.respaldo_miembro_id === r.miembro_id) issue("responsable: el respaldo no puede ser la misma persona");
    }
    if (o.envios) {
      if (o.envios.tiempos.filter((t) => t.ciudades === "resto_con_cobertura").length > 1) issue("envios: más de una regla para el resto con cobertura");
      if (o.envios.cobertura.tipo === "lista_blanca") {
        const cubiertas = new Set(o.envios.cobertura.ciudades);
        for (const t of o.envios.tiempos) if (Array.isArray(t.ciudades) && t.ciudades.some((c) => !cubiertas.has(c))) issue("envios: tiempo para una ciudad sin cobertura");
      }
    }
  });

export type CheckoutOpciones = z.infer<typeof checkoutOpcionesSchema>;

/** Entregas con las que se ofrece un pago (contra entrega: lo que viaja, nunca recoger en tienda). */
function entregasDelPago(o: Pick<CheckoutOpciones, "entregas">, p: CheckoutOpciones["pagos"][number]): DeliveryType[] {
  const base = p.solo_con ?? o.entregas;
  return p.metodo === "contra_entrega" ? base.filter((e) => e !== "tienda") : [...base];
}

/** Pagos ofrecidos con ESA entrega (en el orden configurado). Sin entrega: todos los ofrecidos. */
export function pagosPara(o: Pick<CheckoutOpciones, "entregas" | "pagos">, entrega: DeliveryType | null): PaymentMethod[] {
  return o.pagos.filter((p) => entrega === null || entregasDelPago(o, p).includes(entrega)).map((p) => p.metodo);
}

/**
 * Cómo se presenta cada método del catálogo de la plataforma (botón, palabra en los textos fijos,
 * línea del resumen, "anotado", nombre). Igual para todos los negocios: lo que cambia es cuáles ofrece.
 */
export const ENTREGA_INFO: Readonly<Record<DeliveryType, { boton: { id: string; title: string }; palabra: string; resumen: string; anotado: string }>> = {
  tienda: { boton: { id: "checkout_tienda", title: "🏬 Recoger en tienda" }, palabra: "recoger en tienda", resumen: "🏬 Entrega: Recoger en tienda", anotado: "Anotado: *recoger en tienda* 🏬" },
  domicilio: { boton: { id: "checkout_domicilio", title: "🏠 Domicilio" }, palabra: "domicilio", resumen: "🏠 Entrega: Domicilio", anotado: "Anotado: entrega a *domicilio* 🏠" },
  // Fase 3B: genérico de la plataforma (el nombre de la transportadora lo pone el negocio en `oficina`). No se
  // ofrece hasta que el checkout lo implemente (funcionesNoDisponibles).
  oficina_transportadora: { boton: { id: "checkout_oficina_transportadora", title: "📦 En oficina" }, palabra: "reclamar en oficina", resumen: "📦 Entrega: Reclamar en oficina", anotado: "Anotado: *reclamar en oficina* 📦" },
};

export const PAGO_INFO: Readonly<Record<PaymentMethod, { boton: { id: string; title: string }; palabra: string; resumen: string; anotado: string; nombre: string }>> = {
  pago_en_tienda: { boton: { id: "checkout_pago_tienda", title: "💵 Pago en tienda" }, palabra: "pago en tienda", resumen: "Pago en tienda", anotado: "Anotado: pago *en tienda* 💵", nombre: "pago en tienda" },
  transferencia: { boton: { id: "checkout_transferencia", title: "🏦 Transferencia" }, palabra: "transferencia", resumen: "Transferencia", anotado: "Anotado: pago por *transferencia* 🏦", nombre: "pago por transferencia" },
  contra_entrega: { boton: { id: "checkout_contra_entrega", title: "🚚 Contra entrega" }, palabra: "contra entrega", resumen: "Contra entrega", anotado: "Anotado: pago *contra entrega* 🚚", nombre: "pago contra entrega" },
  link_pago: { boton: { id: "checkout_link_pago", title: "💳 Link de pago" }, palabra: "link de pago", resumen: "Link de pago", anotado: "Anotado: pago con *link de pago* 💳", nombre: "pago con link de pago" },
};

/** ¿El negocio ofrece esa entrega? */
export const ofreceEntrega = (o: Pick<CheckoutOpciones, "entregas">, e: DeliveryType) => o.entregas.includes(e);

/** ¿Ese pago se ofrece con esa entrega? (la última palabra del backend antes de registrar un pedido) */
export const pagoPermitido = (o: Pick<CheckoutOpciones, "entregas" | "pagos">, pago: PaymentMethod, entrega: DeliveryType | null) => pagosPara(o, entrega).includes(pago);

// ---------------------------------------------------------------------------
// Perfil completo y perfil anterior a la generalización
// ---------------------------------------------------------------------------

/** Lo que el lenguaje del checkout necesita de un negocio. */
export interface PerfilNegocio {
  vocabulario: Vocabulario;
  opciones: CheckoutOpciones;
}

/** Vocabulario anterior a la generalización (Delacour Joyería). Ver el encabezado. */
export const VOCABULARIO_LEGADO: Vocabulario = Object.freeze({
  producto: "joya",
  boton_buscar: "🔎 Buscar una joya",
  ejemplos: ["dijes", "aretes dorados", "collar corazón"],
  pistas_busqueda: "tipo de joya, color, material, presupuesto",
  palabras_producto: [
    "arete", "aretes", "collar", "collares", "dije", "dijes", "pulsera", "pulseras", "anillo", "anillos", "cadena", "cadenas",
    "tobillera", "tobilleras", "candonga", "candongas", "joya", "joyas", "otra joya",
  ],
  palabras_producto_direccion: ["aretes", "collar", "dije", "dijes", "pulsera", "anillo"],
  no_es_nombre: ["arete", "aretes", "collar", "collares", "dije", "dijes", "pulsera", "pulseras", "anillo", "anillos", "cadena", "cadenas", "joya", "joyas"],
  nombre_comercial: ["joya", "joyas"],
});

/** Opciones del checkout anteriores a la generalización (Delacour): tienda o domicilio; pago en tienda o transferencia (sin contra entrega). */
export const CHECKOUT_OPCIONES_LEGADO: CheckoutOpciones = Object.freeze({
  entregas: ["tienda", "domicilio"],
  pagos: [{ metodo: "pago_en_tienda" }, { metodo: "transferencia" }],
  mensajes: {
    duda: "Claro 😊 ¿Qué quieres cambiar? Puedes escribirme, por ejemplo, *recoger en tienda*, *domicilio*, *transferencia* o *pago en tienda*. Para cambiar cantidades dime cuántas y de cuál producto.",
    pago_no_disponible: "Por ahora no manejamos pago contra entrega 🙏 Puedes pagar por *transferencia* o *en la tienda*.",
    recordatorio_entrega: "Escríbeme si prefieres *domicilio* o *recoger en tienda*.",
    recordatorio_pago: "Escríbeme si pagas por *transferencia* o *en tienda*.",
  },
}) as CheckoutOpciones;

export const PERFIL_LEGADO: PerfilNegocio = Object.freeze({ vocabulario: VOCABULARIO_LEGADO, opciones: CHECKOUT_OPCIONES_LEGADO });

/**
 * Columna `vocabulario` de la fila:
 *   undefined (fila leída sin la columna: migración pendiente) -> el de antes (legado)
 *   null (sin configurar)                                       -> NEUTRAL
 *   objeto                                                      -> el del negocio (estricto) o inválido
 */
export function resolverVocabulario(raw: unknown): { ok: true; vocabulario: Vocabulario; legado: boolean } | { ok: false } {
  if (raw === undefined) return { ok: true, vocabulario: VOCABULARIO_LEGADO, legado: true };
  if (raw === null) return { ok: true, vocabulario: VOCABULARIO_NEUTRAL, legado: false };
  const v = vocabularioSchema.safeParse(raw);
  return v.success ? { ok: true, vocabulario: v.data, legado: false } : { ok: false };
}

/**
 * Columna `checkout_opciones` de la fila:
 *   undefined (sin la columna: migración pendiente) -> las de antes (legado)
 *   null (sin configurar)                           -> null (con checkout encendido: config inválida)
 *   objeto                                          -> las del negocio (estrictas) o inválido
 */
export function resolverCheckoutOpciones(raw: unknown): { ok: true; opciones: CheckoutOpciones | null; legado: boolean } | { ok: false } {
  if (raw === undefined) return { ok: true, opciones: CHECKOUT_OPCIONES_LEGADO, legado: true };
  if (raw === null) return { ok: true, opciones: null, legado: false };
  const o = checkoutOpcionesSchema.safeParse(raw);
  return o.success ? { ok: true, opciones: o.data, legado: false } : { ok: false };
}

// ---------------------------------------------------------------------------
// Fase 3B.3 — lo que el runtime aún no implementa, y de la configuración a las políticas del motor
// ---------------------------------------------------------------------------

export const FUNCIONES_FASE_3B = ["campos", "oficina", "cierre_aceptacion_humana", "envios", "handoff_determinista", "textos_fijos", "documento_varios_tipos", "oficina_lista"] as const;
export type FuncionFase3B = (typeof FUNCIONES_FASE_3B)[number];

/**
 * Bloques de la Fase 3B que el runtime YA atiende.
 *   - campos y oficina: los atiende el checkout (Fase 3B.4).
 *   - cierre_aceptacion_humana: el checkout (Fase 3B.4) y la aceptación humana (Fase 3B.5: responsable,
 *     asignación, aviso, panel "Por aceptar", aceptar / rechazar, "sí" del cliente). Estuvo BLOQUEADO a propósito
 *     hasta la Fase 3B.9D, que la ABRE. Abrirla NO activa a ningún negocio: solo opera el checkout nuevo el que
 *     tiene su configuración completa (sin el candado activacion_pendiente), su fila de agente habilitada y su IA
 *     sin pausa; ASLC lo hace en etapas controladas (supabase/provisioning/aslc/05 y 06). Un negocio sin bloque
 *     `cierre` (Delacour) no cambia.
 *   - envios: Fase 3B.6 (motor de envíos: herramienta consultar_envio, guardián de afirmaciones sobre envíos, derivación
 *     determinista y cobertura en el checkout).
 *   - handoff_determinista y textos_fijos: siguen sin implementarse (textos finales: Fase 3B.8).
 *   - documento_varios_tipos: elegir entre varios tipos de documento necesita sus nombres (D4 pendiente).
 *   - oficina_lista: la oficina se recibe como texto (D2); no hay catálogo de oficinas todavía.
 */
export const FUNCIONES_3B_IMPLEMENTADAS: Readonly<Record<FuncionFase3B, boolean>> = Object.freeze({
  campos: true,
  oficina: true,
  cierre_aceptacion_humana: true,
  envios: true,
  handoff_determinista: false,
  textos_fijos: false,
  documento_varios_tipos: false,
  oficina_lista: false,
});

/**
 * Bloques configurados que el runtime todavía no implementa: si hay alguno, la configuración es
 * INVÁLIDA (el agente no responde). Así nada se enciende a medias ni se ignora en silencio.
 * `cierre: { modo: "boton_confirmar" }` es el comportamiento de siempre (no cuenta).
 */
export function funcionesNoDisponibles(o: CheckoutOpciones, implementadas: Readonly<Record<FuncionFase3B, boolean>> = FUNCIONES_3B_IMPLEMENTADAS): FuncionFase3B[] {
  const usadas: FuncionFase3B[] = [];
  if (o.campos) usadas.push("campos");
  if (o.oficina || o.entregas.includes("oficina_transportadora")) usadas.push("oficina");
  if (o.cierre?.modo === "aceptacion_humana") usadas.push("cierre_aceptacion_humana");
  if (o.envios) usadas.push("envios");
  if (o.handoff) usadas.push("handoff_determinista");
  if (o.textos) usadas.push("textos_fijos");
  const doc = o.oficina?.documento;
  if (doc?.modo === "requerido" && Array.isArray(doc.tipos) && doc.tipos.length > 1) usadas.push("documento_varios_tipos");
  if (o.oficina?.seleccion.tipo === "lista") usadas.push("oficina_lista");
  return usadas.filter((f) => !implementadas[f]);
}

/** Fase 3B.4 — el cierre con aceptación del negocio (null = el checkout de siempre, con el botón "Confirmar"). */
export type CierreAceptacion = Extract<NonNullable<CheckoutOpciones["cierre"]>, { modo: "aceptacion_humana" }>;
export function cierreConAceptacion(o: Pick<CheckoutOpciones, "cierre">): CierreAceptacion | null {
  return o.cierre?.modo === "aceptacion_humana" ? o.cierre : null;
}

/** Fase 3B.4 — tipo con que se guarda el documento: el único configurado, o "sin especificar" (D4). */
export function tipoDocumento(o: Pick<CheckoutOpciones, "oficina">): string | null {
  const doc = o.oficina?.documento;
  if (doc?.modo !== "requerido") return null;
  return doc.tipos === "sin_especificar" ? DOCUMENTO_SIN_TIPO : (doc.tipos[0] ?? null);
}

/**
 * Políticas del motor (submitForAcceptance) a partir de la configuración. null = el negocio no usa la
 * aceptación. Todo sale de decisiones EXPLÍCITAS del negocio (el esquema no tiene valores por defecto).
 */
export function politicaDeAceptacion(o: CheckoutOpciones): AcceptancePolicy | null {
  if (o.cierre?.modo !== "aceptacion_humana") return null;
  const c = o.cierre;
  const doc = o.oficina?.documento;
  return {
    reservation: c.reserva.tipo === "ttl" ? { kind: "ttl", minutes: c.reserva.minutos } : { kind: "none" },
    expiration: c.vencimiento.tipo === "tras" ? { kind: "after", minutes: c.vencimiento.minutos } : { kind: "none" },
    document:
      doc?.modo === "requerido"
        ? {
            kind: "required_for_office",
            allowedTypes: doc.tipos === "sin_especificar" ? [DOCUMENTO_SIN_TIPO] : [...doc.tipos],
            retention: doc.retencion.tipo === "dias" ? { kind: "days", days: doc.retencion.dias } : { kind: "no_automatic_deletion" },
          }
        : { kind: "not_collected" },
  };
}

/** Plazo de la reserva al aceptar (acceptOrder). null = el negocio no usa la aceptación. */
export function reservaAlAceptar(o: CheckoutOpciones): AcceptedReservation | null {
  if (o.cierre?.modo !== "aceptacion_humana") return null;
  const r = o.cierre.reserva_tras_aceptar;
  return r.tipo === "ttl" ? { kind: "ttl", minutes: r.minutos } : { kind: "platform" };
}
