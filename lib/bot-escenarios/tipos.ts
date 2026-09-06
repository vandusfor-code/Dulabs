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
  | "dos_servicios_detectados";

export interface VarianteActivacion {
  tipo: TipoVariante;
  /** Requerido para contains/starts_with/exact; ignorado para el resto. */
  valor?: string;
}

/** Config específica del modo -- nunca contiene datos inventados, solo referencias/instrucciones. */
export interface ConfigEscenario {
  /** modo=catalog: filtra listarCatalogoServiciosReal por categoría real exacta. */
  filtroCategoria?: string;
  /** modo=catalog: filtra por substring del nombre real (ej. ["Manos", "Pies"]). */
  filtroNombreContiene?: string[];
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
  /** Contexto actualizado para la PRÓXIMA vuelta (se fusiona en state.variables por el propio Engine). */
  contexto: ContextoConversacional;
}
