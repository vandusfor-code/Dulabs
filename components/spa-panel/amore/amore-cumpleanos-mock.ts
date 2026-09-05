// AMORE (Fase 5, diseño visual completo, autorizado) — datos MOCK de la
// pantalla Cumpleaños. El día/mes real de cumpleaños de cada clienta YA vive
// en dulabs_clientes_conocidos (Fase 3/4) -- pero conectar esta pantalla a
// esos datos reales y a un envío real es lógica funcional, fuera de esta
// fase (solo diseño visual). Nada de esto se lee/guarda en Supabase.
export type CumpleañosMock = {
  id: string;
  nombre: string;
  fecha: string; // ya formateada para mostrar, ej. "4 de septiembre"
  esHoy: boolean;
};

export const birthdaysMock: CumpleañosMock[] = [
  { id: "b1", nombre: "María Fernanda López", fecha: "Hoy", esHoy: true },
  { id: "b2", nombre: "Camila Torres", fecha: "Hoy", esHoy: true },
  { id: "b3", nombre: "Valentina Ruiz", fecha: "8 de septiembre", esHoy: false },
  { id: "b4", nombre: "Sofía Martínez", fecha: "12 de septiembre", esHoy: false },
  { id: "b5", nombre: "Laura Hernández", fecha: "21 de septiembre", esHoy: false },
  { id: "b6", nombre: "Isabella Gómez", fecha: "3 de octubre", esHoy: false },
];

export const cumpleanosConfigMock = {
  activo: true,
  mensaje: "¡Feliz cumpleaños, {{nombre}}! 🎉 Todo el equipo de AMORE te desea un día hermoso. Como regalo, tienes un 15% de descuento esta semana.",
  horaEnvio: "9:00 AM",
};
