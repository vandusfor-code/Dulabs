// AMORE (Fase 5, diseño visual completo, autorizado) — datos MOCK de la
// pantalla Equipo. Los NOMBRES (Mary/Cristal/Nata/Jessica) y qué servicios
// hace cada quién son reales (dulabs_especialistas de AMORE); horario,
// estado y desempeño son visuales -- calcular desempeño real es lógica
// funcional, fuera de esta fase.
export type MiembroEquipoMock = {
  id: string;
  nombre: string;
  servicios: string;
  horario: string;
  estado: "disponible" | "ocupada" | "descanso";
  desempeno: { serviciosRealizados: number; ingresos: number; comision: number };
};

export const teamMock: MiembroEquipoMock[] = [
  {
    id: "mary",
    nombre: "Mary",
    servicios: "Todos los servicios",
    horario: "Lun-Sáb · 8:00 AM - 5:00 PM",
    estado: "disponible",
    desempeno: { serviciosRealizados: 42, ingresos: 4200000, comision: 1420000 },
  },
  {
    id: "cristal",
    nombre: "Cristal",
    servicios: "Uñas",
    horario: "Lun-Sáb · 8:00 AM - 5:00 PM",
    estado: "ocupada",
    desempeno: { serviciosRealizados: 38, ingresos: 2900000, comision: 980000 },
  },
  {
    id: "nata",
    nombre: "Nata",
    servicios: "Uñas + cepillados",
    horario: "Lun-Sáb · 8:00 AM - 5:00 PM",
    estado: "disponible",
    desempeno: { serviciosRealizados: 33, ingresos: 2500000, comision: 860000 },
  },
  {
    id: "jessica",
    nombre: "Jessica",
    servicios: "Todos los servicios",
    horario: "Lun-Sáb · 3:00 PM - 8:00 PM",
    estado: "descanso",
    desempeno: { serviciosRealizados: 36, ingresos: 3300000, comision: 1150000 },
  },
];
