// Contabilidad (Fase 10, genérico, autorizado) — tipos compartidos del
// módulo. Ningún tipo acá es específico de AMORE.

export type TipoPeriodo = "hoy" | "semana" | "mes" | "personalizado";

export type RangoFechas = { desde: Date; hasta: Date };

export type FilaCitaCompletada = {
  id: number;
  inicio: string;
  nombreCliente: string;
  servicioTexto: string;
  servicioId: string | null;
  servicioNombre: string | null;
  precio: number | null;
  especialistaId: number;
  profesionalNombre: string;
  estado: string;
};

export type Movimiento = {
  id: number;
  fecha: string;
  cliente: string;
  servicio: string;
  profesional: string;
  /** null = "Sin precio configurado" -- nunca inventar un valor. */
  valor: number | null;
  estado: string;
};

export type IngresoPorServicio = {
  servicioId: string | null;
  servicio: string;
  cantidad: number;
  ingresos: number;
};

// NUEVA FASE (autorizado) -- la comisión ahora se calcula sumando línea por
// línea (cada servicio real de cada cita puede tener su propio tipo/valor,
// ver lib/contabilidad/comisiones.ts), así que un profesional ya no tiene UN
// solo tipo/valor -- solo el monto total resultante tiene sentido acá.
export type ConfigComision = { estado: "configurada"; monto: number } | { estado: "no_configurada" };

export type IngresoPorProfesional = {
  especialistaId: number;
  profesional: string;
  cantidad: number;
  ingresos: number;
  comision: ConfigComision;
};

export type ComparacionIngresos = {
  actual: number;
  anterior: number;
  /** null cuando no hay período anterior con qué comparar (anterior=0 y actual>0). */
  variacionPorcentual: number | null;
};

export type ReporteContabilidad = {
  periodo: { tipo: TipoPeriodo; desde: string; hasta: string };
  ingresos: ComparacionIngresos;
  citasCompletadas: number;
  porServicio: IngresoPorServicio[];
  porProfesional: IngresoPorProfesional[];
  movimientos: Movimiento[];
};
