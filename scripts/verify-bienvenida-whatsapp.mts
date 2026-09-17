// Prueba controlada del WhatsApp de bienvenida (bienvenida_2). ENVÍA UN MENSAJE
// REAL a un destino que TÚ indicas -- úsalo solo con un número de prueba tuyo.
// Reutiliza el mismo código de la app (lib/developer/dulabs-whatsapp), así que
// valida de punta a punta: resolución del token del número oficial DuLabs desde
// dulabs_clientes_config, lectura de la estructura real de la plantilla, y envío.
//
// Requisitos (entorno) -- los mismos que usa producción:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TOKEN_ENCRYPTION_KEY,
//   META_GRAPH_VERSION (opcional, por defecto v21.0)
// Argumentos:
//   node --import tsx scripts/verify-bienvenida-whatsapp.mts <destinoE164> [nombre]
// Ejemplo:
//   node --import tsx scripts/verify-bienvenida-whatsapp.mts +573001234567 "Juan"

import { createClient } from "@supabase/supabase-js";

const destino = process.argv[2];
const nombre = process.argv[3] || "Juan";
if (!destino) {
  console.error("Falta el destino. Uso: node --import tsx scripts/verify-bienvenida-whatsapp.mts <destinoE164> [nombre]");
  process.exit(2);
}
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY || !process.env.TOKEN_ENCRYPTION_KEY) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / TOKEN_ENCRYPTION_KEY en el entorno.");
  process.exit(2);
}

const { enviarTemplateDulabs } = await import("@/lib/developer/dulabs-whatsapp");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } }) as any;

console.log(`Enviando bienvenida_2 a ${destino} (nombre="${nombre}")…\n`);
const r = await enviarTemplateDulabs(sb, {
  nombrePlantilla: "bienvenida_2",
  idioma: "es_CO",
  destinoE164: destino,
  params: [nombre],
});

if (r.enviado) {
  console.log(`PASS  Meta aceptó el mensaje. wamid=${r.wamid}`);
  process.exit(0);
} else {
  console.log(`FAIL  motivo=${r.motivo}${r.detalle ? "  detalle=" + r.detalle : ""}`);
  process.exit(1);
}
