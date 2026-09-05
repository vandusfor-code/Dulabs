// AMORE (Fase 5, diseño visual completo, autorizado) — datos MOCK de la
// pantalla Citas (agenda). Ningún módulo de reservas real está conectado
// todavía: nada de esto se lee ni se guarda en Supabase.
export type EstadoCitaAgenda = "confirmada" | "pendiente" | "cancelada" | "completada";

export type CitaAgendaMock = {
  id: string;
  fechaISO: string; // yyyy-mm-dd
  hora: string;
  nombreCliente: string;
  servicio: string;
  profesional: string;
  estado: EstadoCitaAgenda;
};

function hoyISO(offsetDias = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  return d.toISOString().slice(0, 10);
}

export const appointmentsMock: CitaAgendaMock[] = [
  { id: "a1", fechaISO: hoyISO(0), hora: "9:00 AM", nombreCliente: "Ana María Rojas", servicio: "Manicure", profesional: "Cristal", estado: "completada" },
  { id: "a2", fechaISO: hoyISO(0), hora: "10:00 AM", nombreCliente: "María Fernanda López", servicio: "Balayage + Corte", profesional: "Mary", estado: "confirmada" },
  { id: "a3", fechaISO: hoyISO(0), hora: "11:30 AM", nombreCliente: "Valentina Ruiz", servicio: "Manicure + Pedicure", profesional: "Nata", estado: "confirmada" },
  { id: "a4", fechaISO: hoyISO(0), hora: "1:00 PM", nombreCliente: "Sofía Martínez", servicio: "Botox Capilar", profesional: "Jessica", estado: "confirmada" },
  { id: "a5", fechaISO: hoyISO(0), hora: "2:30 PM", nombreCliente: "Camila Torres", servicio: "Corte + Keratina", profesional: "Mary", estado: "pendiente" },
  { id: "a6", fechaISO: hoyISO(0), hora: "4:00 PM", nombreCliente: "Laura Hernández", servicio: "Color + Cepillado", profesional: "Jessica", estado: "pendiente" },
  { id: "a7", fechaISO: hoyISO(0), hora: "5:30 PM", nombreCliente: "Isabella Gómez", servicio: "Uñas acrílicas", profesional: "Cristal", estado: "cancelada" },
  { id: "a8", fechaISO: hoyISO(1), hora: "9:30 AM", nombreCliente: "Daniela Castro", servicio: "Cepillado", profesional: "Nata", estado: "confirmada" },
  { id: "a9", fechaISO: hoyISO(1), hora: "11:00 AM", nombreCliente: "Paula Jiménez", servicio: "Uña", profesional: "Cristal", estado: "pendiente" },
  { id: "a10", fechaISO: hoyISO(1), hora: "3:00 PM", nombreCliente: "Juliana Vargas", servicio: "Maquillaje", profesional: "Jessica", estado: "confirmada" },
];
