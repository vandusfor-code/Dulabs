// "completada"/"no_show" agregados en la Fase 1 del sistema de reservas
// (aditivo, ver 20260904030000_daniela_reservas_modelo_v1.sql) -- el panel
// no los filtra todavía (ver Filtro más abajo), solo quedan habilitados.
export type EstadoCita = "pendiente" | "confirmada" | "rechazada" | "cancelada" | "propuesta" | "completada" | "no_show";

export type Cita = {
  id: number;
  nombre_cliente: string;
  telefono_cliente: string | null;
  servicio: string;
  // Fase 6A -- referencia estructurada al catálogo (dulabs_servicios) si la
  // cita se creó con el modelo nuevo; null en citas legacy. `servicio`
  // (texto) sigue siendo el snapshot a mostrar siempre -- esto solo indica
  // si la duración/edición debe quedar bloqueada al del servicio real.
  servicio_id: string | null;
  inicio: string;
  fin: string;
  estado: EstadoCita;
  origen: string;
  especialista_id: number;
  /** Quién atiende esta cita de verdad -- varias personas comparten el
   * mismo link/número (ver especialistasDelMismaPersona en el backend), así
   * que nunca asumir que es el dueño del token. */
  profesional: string;
};

export type MiembroEquipo = { id: number; nombre: string };

// Fase 5 (panel administrativo) — conteos reales del negocio para el
// resumen de inicio. Todos ya vienen filtrados por tenant desde el backend.
export type ResumenNegocio = {
  clientesRegistrados: number;
  serviciosActivos: number;
  profesionalesActivos: number;
};

export type DatosCargados = {
  planPausado?: false;
  negocio: string;
  especialista: { nombre: string; servicio: string; duracion_min: number };
  equipo: MiembroEquipo[];
  citas: Cita[];
  resumen: ResumenNegocio;
};

export type Datos = DatosCargados | { planPausado: true; negocio: string };

// "completar"/"no_show" (Fase 5) — cierre real de una cita ya pasada.
export type Accion = "confirmar" | "rechazar" | "reagendar" | "editar" | "cancelar" | "completar" | "no_show";
