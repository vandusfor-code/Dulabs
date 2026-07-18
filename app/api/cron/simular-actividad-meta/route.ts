import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

// Cuenta de prueba que Meta usa para revisar la app (ver
// supabase/seed-cuenta-prueba-meta.sql, que sembró los primeros 7 días).
// No sabemos qué día entra el revisor, así que esta ruta corre a diario
// (Vercel Cron, ver vercel.json) y agrega UNA conversación de demostración
// con marca de tiempo relativa a "ahora" — para que siempre haya actividad
// de las últimas horas, sin importar cuándo se abra el dashboard.
const EMAIL_CUENTA_PRUEBA_META = "duvan.ramos@peoplebpo.com";

const ESCENARIOS: { telefono: string; mensajes: { direccion: "entrante" | "saliente"; contenido: string; origen: string; minutosAtras: number }[] }[] = [
  {
    telefono: "15555550101",
    mensajes: [
      { direccion: "entrante", contenido: "Hola, ¿tienen turno disponible para hoy?", origen: "entrante", minutosAtras: 22 },
      { direccion: "saliente", contenido: "¡Hola! Sí, tenemos disponibilidad a las 4:00pm y 5:30pm. ¿Cuál prefieres?", origen: "ia", minutosAtras: 21 },
      { direccion: "entrante", contenido: "La de las 4pm por favor", origen: "entrante", minutosAtras: 18 },
      { direccion: "saliente", contenido: "Listo, quedas agendado hoy a las 4:00pm. ¡Te esperamos!", origen: "ia", minutosAtras: 17 },
    ],
  },
  {
    telefono: "15555550102",
    mensajes: [
      { direccion: "entrante", contenido: "¿Cuánto cuesta el corte de cabello?", origen: "entrante", minutosAtras: 45 },
      { direccion: "saliente", contenido: "El corte de cabello tiene un valor de $30.000 COP. ¿Deseas agendar una cita?", origen: "ia", minutosAtras: 44 },
      { direccion: "entrante", contenido: "Sí, ¿qué días tienen disponible esta semana?", origen: "entrante", minutosAtras: 40 },
      { direccion: "saliente", contenido: "Tenemos cupos de martes a sábado, de 9:00am a 6:00pm. ¿Qué día te queda mejor?", origen: "ia", minutosAtras: 39 },
    ],
  },
  {
    telefono: "15555550103",
    mensajes: [
      { direccion: "entrante", contenido: "Buenas, ¿están abiertos hoy?", origen: "entrante", minutosAtras: 60 },
      { direccion: "saliente", contenido: "¡Sí! Atendemos de lunes a sábado, de 9:00am a 6:00pm.", origen: "ia", minutosAtras: 59 },
    ],
  },
];

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = supabaseAdmin();

  const { data: miembro } = await supabase
    .from("dulabs_miembros_equipo")
    .select("tenant_id")
    .eq("email", EMAIL_CUENTA_PRUEBA_META)
    .eq("estado", "activo")
    .maybeSingle();
  if (!miembro) {
    return Response.json({ error: "Cuenta de prueba de Meta no encontrada" }, { status: 404 });
  }

  const { data: negocio } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id")
    .eq("id_tenant", miembro.tenant_id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!negocio) {
    return Response.json({ error: "La cuenta de prueba no tiene un número conectado" }, { status: 404 });
  }

  // Idempotencia: si ya se simuló actividad en las últimas 12h, no duplicar
  // (evita que dos disparos del cron el mismo día inflen la tabla).
  const desde = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("dulabs_mensajes_log")
    .select("id", { count: "exact", head: true })
    .eq("phone_number_id", negocio.phone_number_id)
    .in("telefono_cliente", ESCENARIOS.map((e) => e.telefono))
    .gte("created_at", desde);
  if (count && count > 0) {
    return Response.json({ simulado: false, motivo: "Ya hay actividad simulada reciente" });
  }

  const escenario = ESCENARIOS[new Date().getUTCDate() % ESCENARIOS.length];
  const ahora = Date.now();
  const filas = escenario.mensajes.map((m) => ({
    phone_number_id: negocio.phone_number_id,
    telefono_cliente: escenario.telefono,
    direccion: m.direccion,
    contenido: m.contenido,
    origen: m.origen,
    created_at: new Date(ahora - m.minutosAtras * 60 * 1000).toISOString(),
  }));

  const { error: insertError } = await supabase.from("dulabs_mensajes_log").insert(filas);
  if (insertError) {
    return Response.json({ error: insertError.message }, { status: 500 });
  }

  const respuestasIA = filas.filter((f) => f.origen === "ia").length;
  const mesActual = new Date().toISOString().slice(0, 7);
  const { data: clienteConfig } = await supabase
    .from("dulabs_clientes_config")
    .select("id, mensajes_usados_mes, mes_actual")
    .eq("phone_number_id", negocio.phone_number_id)
    .maybeSingle();
  if (clienteConfig) {
    const nuevoUsados = clienteConfig.mes_actual === mesActual ? clienteConfig.mensajes_usados_mes + respuestasIA : respuestasIA;
    await supabase
      .from("dulabs_clientes_config")
      .update({ mensajes_usados_mes: nuevoUsados, mes_actual: mesActual })
      .eq("id", clienteConfig.id);
  }

  return Response.json({ simulado: true, telefono: escenario.telefono, mensajes: filas.length });
}
