// AMORE (Fase "sistema completo", autorizado) — solo tipos + formatearCOP,
// reutilizados por AmoreDashboardHome (datos reales) y otras pantallas.
export type EstadoCitaMock = "confirmada" | "pendiente" | "cancelada" | "completada";

export type CitaMock = {
  id: string;
  hora: string;
  nombreCliente: string;
  servicio: string;
  estado: EstadoCitaMock;
};

export type DashboardDataMock = {
  citasHoy: { total: number; pendientes: number };
  clientesActivos: { total: number; nuevosEsteMes: number };
  serviciosHoy: { total: number; diferentes: number };
  ingresosMes: { total: number; variacionPct: number };
  proximasCitas: CitaMock[];
};

export function formatearCOP(valor: number): string {
  return `$${valor.toLocaleString("es-CO")}`;
}
