// AMORE (Fase 5, diseño visual completo, autorizado) — datos MOCK de la
// pantalla Fidelización. Ninguna regla se evalúa de verdad y ningún mensaje
// se envía -- automatizar esto es lógica funcional, fuera de esta fase.
export type ReglaFidelizacionMock = { id: string; servicio: string; dias: number; activa: boolean };

export const loyaltyRulesMock: ReglaFidelizacionMock[] = [
  { id: "r1", servicio: "Uñas", dias: 20, activa: true },
  { id: "r2", servicio: "Color + Cepillado", dias: 30, activa: true },
  { id: "r3", servicio: "Botox Capilar", dias: 45, activa: false },
];

export type ClienteContactarMock = { id: string; nombre: string; servicio: string; ultimaVisita: string; proximoContacto: string };

export const loyaltyContactsMock: ClienteContactarMock[] = [
  { id: "c1", nombre: "Ana María Rojas", servicio: "Uñas", ultimaVisita: "15 de agosto", proximoContacto: "Hoy" },
  { id: "c2", nombre: "Paula Jiménez", servicio: "Uñas", ultimaVisita: "18 de agosto", proximoContacto: "Mañana" },
  { id: "c3", nombre: "Daniela Castro", servicio: "Color + Cepillado", ultimaVisita: "3 de agosto", proximoContacto: "En 2 días" },
];

export const loyaltyMessageMock = "Hola, {{nombre}}... 💕 Ya pasaron unos días desde tu última visita a AMORE. ¿Te gustaría agendar tu próxima cita?";
