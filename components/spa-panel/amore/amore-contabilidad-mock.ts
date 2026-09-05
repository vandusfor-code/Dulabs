// AMORE (Fase 5, diseño visual completo, autorizado) — datos MOCK de la
// pantalla Contabilidad. Ningún cálculo es real -- conectar esto a las citas
// y pagos reales es lógica funcional, fuera de esta fase.
export type MovimientoMock = {
  id: string;
  fecha: string;
  nombreCliente: string;
  servicio: string;
  valor: number;
  estado: "pagado" | "pendiente";
};

export const accountingMock = {
  ingresosDia: 1250000,
  ingresosMes: 8450000,
  citasCobradas: 24,
  citasPendientes: 4,
  porServicio: [
    { servicio: "Uñas", ingresos: 2100000 },
    { servicio: "Color + Cepillado", ingresos: 3200000 },
    { servicio: "Botox Capilar", ingresos: 1850000 },
    { servicio: "Maquillaje", ingresos: 1300000 },
  ],
  comisiones: [
    { profesional: "Mary", comision: 1420000 },
    { profesional: "Cristal", comision: 980000 },
    { profesional: "Nata", comision: 860000 },
    { profesional: "Jessica", comision: 1150000 },
  ],
  movimientos: [
    { id: "m1", fecha: "Hoy · 10:00 AM", nombreCliente: "María Fernanda López", servicio: "Balayage + Corte", valor: 380000, estado: "pagado" },
    { id: "m2", fecha: "Hoy · 11:30 AM", nombreCliente: "Valentina Ruiz", servicio: "Manicure + Pedicure", valor: 95000, estado: "pagado" },
    { id: "m3", fecha: "Hoy · 1:00 PM", nombreCliente: "Sofía Martínez", servicio: "Botox Capilar", valor: 220000, estado: "pendiente" },
    { id: "m4", fecha: "Ayer · 4:00 PM", nombreCliente: "Laura Hernández", servicio: "Color + Cepillado", valor: 310000, estado: "pagado" },
  ] as MovimientoMock[],
};
