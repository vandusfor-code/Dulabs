// AMORE (Fase 5, diseño visual completo) — el estado de conexión ya es real
// desde la Fase 9A (ver app/agenda/[token]/whatsapp/page.tsx y
// app/api/agenda/[token]/whatsapp-qr/*). Lo único que sigue siendo mock acá
// es el conteo de uso por tipo de mensaje -- no se pidió construir esa
// métrica real en esta fase.
export const whatsappMock = {
  uso: [
    { label: "Confirmaciones", cantidad: 128 },
    { label: "Recordatorios", cantidad: 96 },
    { label: "Cumpleaños", cantidad: 12 },
    { label: "Fidelización", cantidad: 34 },
  ],
};
