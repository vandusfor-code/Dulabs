// AMORE (Fase 5, panel administrativo móvil, autorizado) — datos MOCK del
// dashboard. Ningún módulo real (Citas/Clientes/Servicios/Contabilidad)
// está construido todavía -- estos valores son solo para representar
// visualmente el diseño. Separado del componente visual a propósito: cuando
// esos módulos existan, solo hay que reemplazar este objeto por una consulta
// real, sin tocar AmoreMetricCards/AmoreUpcomingAppointments.
export type CitaMock = {
  id: string;
  hora: string;
  nombreCliente: string;
  servicio: string;
  estado: "confirmada" | "pendiente";
};

export type DashboardDataMock = {
  citasHoy: { total: number; pendientes: number };
  clientesActivos: { total: number; nuevosEsteMes: number };
  serviciosHoy: { total: number; diferentes: number };
  ingresosMes: { total: number; variacionPct: number };
  proximasCitas: CitaMock[];
};

export const dashboardDataMock: DashboardDataMock = {
  citasHoy: { total: 8, pendientes: 2 },
  clientesActivos: { total: 142, nuevosEsteMes: 12 },
  serviciosHoy: { total: 16, diferentes: 6 },
  ingresosMes: { total: 8450000, variacionPct: 18 },
  proximasCitas: [
    { id: "1", hora: "10:00 AM", nombreCliente: "María Fernanda López", servicio: "Balayage + Corte", estado: "confirmada" },
    { id: "2", hora: "11:30 AM", nombreCliente: "Valentina Ruiz", servicio: "Manicure + Pedicure", estado: "confirmada" },
    { id: "3", hora: "1:00 PM", nombreCliente: "Sofía Martínez", servicio: "Botox Capilar", estado: "confirmada" },
    { id: "4", hora: "2:30 PM", nombreCliente: "Camila Torres", servicio: "Corte + Keratina", estado: "pendiente" },
    { id: "5", hora: "4:00 PM", nombreCliente: "Laura Hernández", servicio: "Color + Cepillado", estado: "pendiente" },
  ],
};

export function formatearCOP(valor: number): string {
  return `$${valor.toLocaleString("es-CO")}`;
}
