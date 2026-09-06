/**
 * Banco de escenarios/respuestas del bot conversacional (autorizado, AMORE
 * primer tenant). Ver migración supabase/migrations/20260912000000_dulabs_bot_escenarios.sql
 * para el porqué de unificar escenarios/FAQ/información del negocio en UNA
 * sola tabla genérica por tenant.
 */

export type ModoEscenario = "deterministic" | "catalog" | "faq" | "ai" | "portal" | "transfer";

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
