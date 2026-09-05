// AMORE (Fase 5, diseño visual completo, autorizado) — datos MOCK de la
// pantalla WhatsApp. Conectar/desconectar de verdad (QR, Meta) es lógica
// funcional, fuera de esta fase -- ver dulabs_clientes_config para el estado
// real, que esta pantalla todavía no consulta.
export const whatsappMock = {
  conectado: true,
  numero: "+57 XXX XXX XXXX",
  uso: [
    { label: "Confirmaciones", cantidad: 128 },
    { label: "Recordatorios", cantidad: 96 },
    { label: "Cumpleaños", cantidad: 12 },
    { label: "Fidelización", cantidad: 34 },
  ],
};
