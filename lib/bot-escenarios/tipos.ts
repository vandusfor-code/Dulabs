/**
 * Banco de escenarios/respuestas del bot conversacional (autorizado, AMORE
 * primer tenant). Ver migración supabase/migrations/20260912000000_dulabs_bot_escenarios.sql
 * para el porqué de unificar escenarios/FAQ/información del negocio en UNA
 * sola tabla genérica por tenant.
 */

export type ModoEscenario =
  | "deterministic"
  | "catalog"
  | "faq"
  | "ai"
  | "portal"
  | "transfer"
  // FASE 1 -- Agendamiento conversacional (autorizado) -- emitidos SOLO por
  // resolverAgendamiento (resolver.ts), nunca por la config estática de un
  // escenario: le dicen al Flow Engine (amore-router.flow.ts, sin tocar su
  // core) que debe ejecutar una acción real de Nylas ANTES de redactar con
  // IA -- "agendar_buscar_disponibilidad" consulta el pool real de horarios,
  // "agendar_crear_cita" ejecuta crearCitaConNylas() (con su propia
  // revalidación/idempotencia/rollback, sin ningún cambio). El nodo IA
  // existente (ai-generar-respuesta) redacta el resultado real en ambos
  // casos -- nunca un segundo nodo IA nuevo.
  | "agendar_buscar_disponibilidad"
  | "agendar_crear_cita";

/**
 * Códigos reservados que TODO tenant debe sembrar para usar este motor
 * genérico -- el resolver los busca por código exacto cuando ninguna
 * variante coincidió (fallback) o cuando una afirmación corta contextual
 * confirma una reserva ya ofrecida (portal). Nunca texto hardcodeado en el
 * motor: solo el nombre de la fila que cada tenant debe configurar.
 */
export const CODIGO_ESCENARIO_FALLBACK = "000_fallback";
export const CODIGO_ESCENARIO_PORTAL = "061_intencion_reservar";
/**
 * FASE 1 -- Agendamiento conversacional (autorizado). Código reservado
 * OPCIONAL: un tenant que no lo siembre simplemente nunca activa
 * agendamiento conversacional (resolverEscenario sigue funcionando
 * exactamente igual que antes de esta fase para cualquier tenant sin esta
 * fila -- ver el guard explícito en resolver.ts).
 */
export const CODIGO_ESCENARIO_AGENDAMIENTO = "070_agendamiento";

/**
 * Tipos de variante de activación. `contains`/`starts_with`/`exact` son
 * matching de texto plano (normalizado con lib/flow-triggers/normalize-text.ts,
 * MISMA función que ya usa el Trigger Router -- nunca reimplementada).
 * `servicio_detectado`/`categoria_detectada` no comparan texto: coinciden
 * cuando la extracción de entidades (ver entidades.ts) ya encontró un
 * servicio/categoría REAL del catálogo en el mensaje -- así un escenario de
 * "servicio específico" nunca necesita enumerar los 28+ nombres reales como
 * variantes estáticas (quedarían desactualizados en cuanto cambie el
 * catálogo). `afirmacion_corta`/`negacion_corta` son un vocabulario cerrado y
 * genérico de español (sí/no/ok/dale...), no datos de negocio -- por eso
 * viven en código, no en la fila de un tenant.
 */
export type TipoVariante =
  | "contains"
  | "starts_with"
  | "exact"
  | "servicio_detectado"
  | "categoria_detectada"
  | "afirmacion_corta"
  | "negacion_corta"
  // Prueba real de WhatsApp (autorizado) — coincide cuando la extracción de
  // entidades encontró DOS (o más) servicios reales distintos en el mismo
  // mensaje (ej. "Dipping vs Press On"), o cuando el contexto conversacional
  // los unió (ver resolver.ts). Nunca enumera nombres: depende 100% de
  // entidades.serviciosDetectados, igual que servicio_detectado.
  | "dos_servicios_detectados"
  // Prueba real de WhatsApp (autorizado) — variante genérica y reutilizable
  // para "intención combinada": coincide solo si TODAS las palabras de
  // `valores` aparecen en el mensaje (a diferencia de `contains`, que
  // coincide si CUALQUIER escenario con esa palabra suelta matchea). Nunca
  // texto hardcodeado en el motor -- las palabras vienen de la fila del
  // tenant (ej. ["manos","pies"] para "manos y pies").
  | "contains_todas";

export interface VarianteActivacion {
  tipo: TipoVariante;
  /** Requerido para contains/starts_with/exact; ignorado para el resto. */
  valor?: string;
  /** Requerido para contains_todas (2+ palabras, TODAS deben aparecer). */
  valores?: string[];
}

/** Config específica del modo -- nunca contiene datos inventados, solo referencias/instrucciones. */
export interface ConfigEscenario {
  /** modo=catalog: filtra listarCatalogoServiciosReal por categoría real exacta. */
  filtroCategoria?: string;
  /** modo=catalog: filtra por substring del nombre real -- OR (cualquiera), ej. ["Manos", "Pies"] muestra items con Manos O Pies. */
  filtroNombreContiene?: string[];
  /** modo=catalog: filtra por substring del nombre real -- AND (todas), ej. ["Manos", "Pies"] muestra SOLO items con Manos Y Pies juntos ("manos y pies" combinado). */
  filtroNombreContieneTodas?: string[];
  /** Palabras que activan `categoria_detectada` para `filtroCategoria` (ej. ["uñas","manicure"] -> "Uñas"). */
  sinonimos?: string[];
  /** modo=catalog: si no hay servicio/categoría resuelto, usar este texto en vez de las `respuestas` del escenario. */
  respuestaSinServicio?: string;
  /** modo=catalog: además de precio/duración, consulta profesionales elegibles reales (extra I/O, solo si el escenario lo necesita). */
  necesitaProfesionales?: boolean;
  /** modo=ai: instrucción breve y acotada a ESTE escenario (nunca el prompt genérico completo). */
  instruccionIA?: string;
}

export interface EscenarioRow {
  id: string;
  tenantId: string;
  codigo: string;
  nombre: string;
  modo: ModoEscenario;
  prioridad: number;
  activo: boolean;
  variantes: VarianteActivacion[];
  respuestas: string[];
  config: ConfigEscenario;
}

/**
 * Prueba real de WhatsApp (autorizado) — referencia a UNA opción de la
 * ÚLTIMA lista real que el bot mostró (ver ContextoConversacional.
 * ultimasOpcionesIds). La resolución contra las opciones REALES vive en
 * resolver.ts -- esto solo describe QUÉ TIPO de referencia hizo la clienta.
 */
export type ReferenciaOpcionMostrada =
  | { tipo: "ordinal"; posicion: number } // 1-based; -1 = última
  | { tipo: "precio"; monto: number }
  | { tipo: "duracion"; minutos: number }
  | { tipo: "extremo"; cual: "barata" | "cara" }
  | { tipo: "demostrativo" }; // "esa"/"esta" sin más calificador -- solo resuelve si la lista mostrada tiene 1 sola opción.

/** Entidades extraídas de forma determinista (nunca por IA) del mensaje actual. */
export interface EntidadesDetectadas {
  /** Solo presente cuando serviciosDetectados tiene EXACTAMENTE 1 elemento -- ver entidades.ts. */
  servicioId?: string;
  servicioNombre?: string;
  /**
   * TODOS los servicios reales del catálogo mencionados como palabra(s)
   * completa(s) en el mensaje, en orden de aparición, sin duplicados.
   * Longitud 0 = ninguno; 1 = servicio puntual (igual que servicioId/Nombre);
   * 2+ = comparación (ver dos_servicios_detectados y resolverModoCatalog).
   */
  serviciosDetectados: Array<{ id: string; nombre: string; categoria: string | null }>;
  categoria?: string;
  presupuestoMax?: number;
  duracionMaxMin?: number;
  esAfirmacionCorta: boolean;
  esNegacionCorta: boolean;
  /** Prueba real de WhatsApp (autorizado) — "caballero"/"hombre"/"masculino" mencionado explícitamente en ESTE mensaje. */
  indicaGeneroMasculino: boolean;
  /** Prueba real de WhatsApp (autorizado) — solo se calcula cuando el mensaje NO nombra ya un servicio/categoría real. */
  referenciaOpcion?: ReferenciaOpcionMostrada;
  /**
   * Corrección (autorizada, bug real "¿Cuáles?") — la clienta pide ver DE
   * NUEVO las opciones ya ofrecidas ("¿Cuáles?", "¿Qué opciones hay?"),
   * nunca una pregunta nueva sobre un servicio/categoría distinta.
   * Vocabulario cerrado, coincidencia EXACTA (mismo criterio que
   * esAfirmacionCorta/esNegacionCorta) -- la resolución contra
   * ultimaCategoria/ultimasOpcionesIds vive en resolver.ts.
   */
  pideVerOpcionesDeNuevo: boolean;
}

/**
 * FASE 1 -- Agendamiento conversacional (autorizado). ACUMULADOR de datos
 * reales, nunca una secuencia rígida de pasos obligatorios -- cada campo se
 * llena de forma independiente, en cualquier orden, según lo que la clienta
 * ya haya dado. Vive DENTRO de ContextoConversacional (mismo mecanismo de
 * state.variables ya existente) -- NUNCA una tabla ni un motor de estado
 * nuevo. `especialistaId`/`horarioSeleccionadoISO`/`servicioId` son siempre
 * ids reales, nunca texto libre -- se re-validan contra el catálogo/
 * elegibilidad real en cada paso, igual que `ultimasOpcionesIds` ya hace
 * para las referencias a listas mostradas.
 */
/**
 * MODO AGENDA GUIADA (autorizado) -- selección por menú de texto numerado,
 * nunca por interpretación libre de Gemini. Ver lib/bot-escenarios/agendamiento-guiado.ts.
 */
export type PasoAgendamientoGuiado =
  | "SELECCION_SERVICIO"
  | "SELECCION_PROFESIONAL"
  | "SELECCION_FECHA"
  | "SELECCION_HORARIO"
  | "CONFIRMACION"
  | "COMPLETADO";

export type TipoMenuAgendamiento = "servicio" | "profesional" | "fecha" | "horario" | "confirmacion";

/**
 * Una opción real de un menú guiado. `id` es SIEMPRE un valor estructurado
 * real (UUID de servicio, especialista_id como texto, fechaISO real, o un id
 * de control cerrado: "ANY", "VER_MAS_SERVICIOS", "VER_MAS_FECHAS",
 * "VER_MAS_PROFESIONALES", "CONFIRM_APPOINTMENT", "CAMBIAR_HORARIO",
 * "CANCELAR") -- NUNCA texto libre inventado. `sinonimos` son formas
 * normalizadas (ver normalizarBasico) contra las que se compara una
 * respuesta ESCRITA -- coincidencia EXACTA, nunca "contains" ni difusa.
 */
export interface MenuOpcionAgendamiento {
  numero: number;
  id: string;
  label: string;
  sinonimos: string[];
}

/**
 * Menú real actualmente mostrado -- única fuente de verdad para resolver la
 * PRÓXIMA respuesta del cliente (número o texto) contra IDs reales, nunca
 * contra una interpretación de Gemini. Se conserva TAL CUAL a través de
 * interrupciones informativas (sección 21 del pedido), igual que
 * `opcionesOfrecidas` ya se conservaba en el modo anterior.
 */
export interface MenuAgendamiento {
  tipo: TipoMenuAgendamiento;
  opciones: MenuOpcionAgendamiento[];
  /**
   * SOLO tipo="servicio"|"profesional"|"horario": entradas reales aún no
   * mostradas (mismo shape que una opción, sin `numero`) para "Ver más..."
   * sin repetir la consulta real (catálogo/especialistas/Nylas).
   */
  pendientes?: Array<{ id: string; label: string; sinonimos: string[] }>;
  /**
   * SOLO tipo="fecha": próximo offset de días (desde hoy) para "Ver más
   * fechas" -- las fechas se generan bajo demanda (America/Bogota), nunca se
   * precomputa una lista "infinita".
   */
  offsetFechas?: number;
}

export interface AgendamientoEnCurso {
  servicioId?: string;
  servicioNombre?: string;
  duracionMin?: number;
  /** MODO AGENDA GUIADA (autorizado) -- precio real del servicio elegido, capturado al seleccionarlo para poder armar el resumen de confirmación sin volver a consultar el catálogo. */
  precio?: number;
  /** MODO AGENDA GUIADA (autorizado) -- presente SOLO mientras el agendamiento usa la nueva modalidad de menús de texto numerados; ausente/undefined = modalidad anterior (conversación libre), sin ningún cambio de comportamiento. */
  modo?: "guiado";
  /** MODO AGENDA GUIADA (autorizado) -- paso determinístico actual; nunca lo decide Gemini. */
  paso?: PasoAgendamientoGuiado;
  /** MODO AGENDA GUIADA (autorizado) -- el menú real que se le acaba de mostrar al cliente. */
  menuActual?: MenuAgendamiento;
  /** Solo si la clienta mencionó una profesional puntual ("con Mary") -- si no, se consulta el pool completo de elegibles. */
  especialistaId?: number;
  especialistaNombre?: string;
  fechaISO?: string;
  bloquePreferido?: "manana" | "tarde" | "noche";
  horaPreferidaHHMM?: string;
  /**
   * Últimas opciones REALES ofrecidas (mismo criterio que
   * ContextoConversacional.ultimasOpcionesIds) -- para poder resolver "la de
   * las 4" o "con Mary" contra lo que de verdad se mostró, nunca contra un
   * valor inventado.
   */
  opcionesOfrecidas?: Array<{ especialistaId: number; especialistaNombre: string; horaTexto: string; horaISO: string }>;
  horarioSeleccionadoISO?: string;
  especialistaSeleccionadaId?: number;
  especialistaSeleccionadaNombre?: string;
  /** true SOLO entre el momento en que se ofrece un horario concreto y la clienta responde -- así una confirmación ambigua nunca se malinterpreta fuera de este momento puntual. */
  esperandoConfirmacion?: boolean;
  nombreCliente?: string;
  /** true justo después de que el bot preguntó "¿a nombre de quién?" -- el próximo mensaje que no matchee ningún otro dato se interpreta como el nombre. */
  nombrePendiente?: boolean;
  /**
   * Revisión (autorizada, sección 14 del pedido) -- true SOLO cuando
   * dulabs_clientes_conocidos no tenía ningún registro para este número al
   * momento de pedir el nombre (cliente genuinamente nuevo). Es la señal
   * que distingue "hay que completar su registro inicial" (incluye
   * cumpleaños) de un cliente ya existente (nunca se le vuelve a pedir
   * nada de esto). Se fija UNA sola vez y se conserva durante toda la
   * conversación de agendamiento -- nunca se recalcula a mitad de camino.
   */
  esClienteNuevo?: boolean;
  /** true justo después de preguntarle su fecha de cumpleaños a un cliente nuevo -- el próximo mensaje se interpreta con parseCumpleanosNatural. */
  cumpleanosPendiente?: boolean;
  /** true una vez guardado el cumpleaños (o si ya existía uno guardado) -- evita volver a pedirlo dentro de la MISMA conversación aunque algo dispare de nuevo la rama de "cliente nuevo". */
  cumpleanosCapturado?: boolean;
  /** true tras crear la cita real (éxito) -- el acumulador queda "cerrado", listo para limpiarse en el próximo turno sin intención de agendar. */
  completado?: boolean;
}

/** Contexto conversacional leído/escrito en state.variables (mismo mecanismo ya existente, sin tabla nueva). */
export interface ContextoConversacional {
  ultimoServicioId?: string;
  ultimoServicioNombre?: string;
  /** Segundo servicio de una comparación activa (ej. "Dipping" vs "Press On") -- ver resolver.ts. */
  ultimoServicioBId?: string;
  ultimoServicioBNombre?: string;
  ultimaCategoria?: string;
  ultimaAccionSugerida?: string;
  /**
   * Prueba real de WhatsApp (autorizado) — ids reales (nunca inventados) de
   * la ÚLTIMA lista de opciones que el bot mostró (categoría o comparación),
   * para resolver referencias como "la de 30 mil"/"la segunda"/"la más
   * barata". Se re-consulta el catálogo real cada vez -- nunca se guarda
   * precio/nombre acá, solo el id, para no arrastrar datos desactualizados.
   */
  ultimasOpcionesIds?: string[];
  /** FASE 1 -- Agendamiento conversacional (autorizado). Ver AgendamientoEnCurso. */
  agendamiento?: AgendamientoEnCurso;
}

/**
 * Base de conocimiento (autorizado, AMORE primer tenant) — explicación
 * profesional GENERAL por servicio, separada por construcción de los hechos
 * confirmados de AMORE (dulabs_servicios). `fuente` viaja siempre junto al
 * contenido para que la IA nunca presente conocimiento general como
 * protocolo específico de AMORE. Ver
 * supabase/migrations/20260913000000_dulabs_bot_conocimiento.sql.
 */
export type FuenteConocimiento = "confirmado_amore" | "conocimiento_general" | "no_confirmado";

export interface ConocimientoServicio {
  servicioId: string;
  fuente: FuenteConocimiento;
  queEs: string | null;
  paraQueSirve: string | null;
  /** Nunca se muestra a la clienta tal cual -- restricción para la IA sobre qué NO afirmar de este servicio. */
  limites: string | null;
}

export interface ResultadoResolucion {
  escenarioCodigo: string;
  modo: ModoEscenario;
  /** Presente cuando modo !== "ai": texto ya interpolado, listo para enviar. */
  respuestaTexto?: string;
  requiereIA: boolean;
  /** Presente solo cuando modo === "ai". */
  instruccionIA?: string;
  datosIA?: unknown;
  /**
   * Presente solo cuando modo === "ai" y hay servicio(s) real(es)
   * involucrados -- SIEMPRE una clave separada de datosIA, nunca fusionada
   * (regla explícita del pedido: precio/duración/categoría son hechos
   * confirmados; esto es explicación general, con su fuente declarada).
   */
  conocimientoGeneral?: unknown;
  /** Contexto actualizado para la PRÓXIMA vuelta (se fusiona en state.variables por el propio Engine). */
  contexto: ContextoConversacional;
}
