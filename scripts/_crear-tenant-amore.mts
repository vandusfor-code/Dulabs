/**
 * FASE 1 (autorizado) — base inicial del tenant AMORE.
 *
 * Reutiliza EXACTAMENTE las mismas tablas ya usadas por Daniela para su
 * sistema de reservas (dulabs_clientes_config / dulabs_especialistas /
 * dulabs_horario_especialista / dulabs_servicios / dulabs_servicio_especialista)
 * -- cero tablas nuevas, cero migraciones, cero arquitectura paralela.
 *
 * Catálogo cargado desde "precios AMORE.xlsx" tal cual (nombre/precio/
 * duración respetados exactamente). Los 2 ítems marcados "adicional"
 * (Secado Rápido, Base Ruber) se EXCLUYEN a propósito de esta carga: el
 * sistema actual (dulabs_servicios) no tiene ningún mecanismo de "adicional/
 * modificador" distinto de un servicio reservable independiente (verificado
 * contra el catálogo real de Daniela, que no tiene ese concepto tampoco) --
 * convertirlos automáticamente en servicios independientes sería inventar
 * un comportamiento no pedido. Quedan pendientes de decisión del cliente.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const envLocal = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of envLocal.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const supabase: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const TENANT_ID = randomUUID();
// Placeholder -- NUNCA un phone_number_id real de Meta. Debe reemplazarse
// cuando se conecte WhatsApp de verdad (Fase 2) -- ver reporte.
const PHONE_NUMBER_ID_PENDIENTE = `pendiente-amore-${TENANT_ID.slice(0, 8)}`;

type ServicioSeed = {
  nombre: string;
  categoria: string;
  precio: number;
  duracionMin: number;
  elegibilidad: "unas" | "otro";
};

// Catálogo real de "precios AMORE.xlsx" -- 28 de 30 filas (excluye las 2
// marcadas "adicional": Secado Rápido, Base Ruber). Duración parseada tal
// cual del texto original ("2 horas"->120, "30 mn"->30, etc.), sin inventar
// ni redondear precios.
const SERVICIOS: ServicioSeed[] = [
  { nombre: "Celulas Madres", categoria: "Cabello", precio: 100000, duracionMin: 120, elegibilidad: "otro" },
  { nombre: "Repolarizacion", categoria: "Cabello", precio: 50000, duracionMin: 120, elegibilidad: "otro" },
  { nombre: "Peinado", categoria: "Cabello", precio: 30000, duracionMin: 60, elegibilidad: "otro" },
  { nombre: "Ondas", categoria: "Cabello", precio: 20000, duracionMin: 30, elegibilidad: "otro" },
  { nombre: "Trenzas", categoria: "Cabello", precio: 12000, duracionMin: 20, elegibilidad: "otro" },
  { nombre: "Cejas con Cera", categoria: "Cejas", precio: 15000, duracionMin: 10, elegibilidad: "otro" },
  { nombre: "Cejas con Cuchilla", categoria: "Cejas", precio: 10000, duracionMin: 10, elegibilidad: "otro" },
  { nombre: "Bozo", categoria: "Depilación", precio: 5000, duracionMin: 5, elegibilidad: "otro" },
  { nombre: "Axilas", categoria: "Depilación", precio: 10000, duracionMin: 10, elegibilidad: "otro" },
  { nombre: "Media Pierna", categoria: "Depilación", precio: 25000, duracionMin: 60, elegibilidad: "otro" },
  { nombre: "Nariz", categoria: "Depilación", precio: 8000, duracionMin: 5, elegibilidad: "otro" },
  { nombre: "Barbilla", categoria: "Depilación", precio: 5000, duracionMin: 5, elegibilidad: "otro" },
  { nombre: "Pestañas Punto a Punto", categoria: "Pestañas", precio: 30000, duracionMin: 30, elegibilidad: "otro" },
  { nombre: "Sombreado de Cejas", categoria: "Cejas", precio: 30000, duracionMin: 60, elegibilidad: "otro" },
  { nombre: "Maquillaje Suave", categoria: "Maquillaje", precio: 60000, duracionMin: 60, elegibilidad: "otro" },
  { nombre: "Maquillaje pro", categoria: "Maquillaje", precio: 80000, duracionMin: 60, elegibilidad: "otro" },
  { nombre: "Cambio De Esmalte", categoria: "Uñas", precio: 10000, duracionMin: 20, elegibilidad: "unas" },
  { nombre: "Manos semi y Pies Tradi", categoria: "Uñas", precio: 60000, duracionMin: 180, elegibilidad: "unas" },
  { nombre: "Manos y Pies Semi", categoria: "Uñas", precio: 80000, duracionMin: 120, elegibilidad: "unas" },
  { nombre: "Press On", categoria: "Uñas", precio: 80000, duracionMin: 120, elegibilidad: "unas" },
  { nombre: "Retoques", categoria: "Uñas", precio: 60000, duracionMin: 120, elegibilidad: "unas" },
  { nombre: "Uña", categoria: "Uñas", precio: 8000, duracionMin: 15, elegibilidad: "unas" },
  { nombre: "Retiro Semi", categoria: "Uñas", precio: 5000, duracionMin: 15, elegibilidad: "unas" },
  { nombre: "Retiro Sistemas", categoria: "Uñas", precio: 15000, duracionMin: 15, elegibilidad: "unas" },
  { nombre: "Caballero Manos y Pies", categoria: "Uñas", precio: 30000, duracionMin: 120, elegibilidad: "unas" },
  { nombre: "Caballero Manos Semi y Pies Tradi", categoria: "Uñas", precio: 45000, duracionMin: 120, elegibilidad: "unas" },
  { nombre: "Dipping", categoria: "Uñas", precio: 60000, duracionMin: 120, elegibilidad: "unas" },
  { nombre: "Caballero Manos Semi", categoria: "Uñas", precio: 30000, duracionMin: 60, elegibilidad: "unas" },
];

type ProfesionalSeed = {
  nombre: string;
  servicioLegacy: string;
  numeroWhatsappPlaceholder: string;
  elegible: "unas" | "todos";
  horarioSemana: { horaInicio: string; horaFin: string }; // Lunes-Viernes
  horarioSabado: { horaInicio: string; horaFin: string };
};

const PROFESIONALES: ProfesionalSeed[] = [
  { nombre: "Mary", servicioLegacy: "todos", numeroWhatsappPlaceholder: "0000000001", elegible: "todos", horarioSemana: { horaInicio: "09:00", horaFin: "18:00" }, horarioSabado: { horaInicio: "09:00", horaFin: "20:00" } },
  { nombre: "Cristal", servicioLegacy: "uñas", numeroWhatsappPlaceholder: "0000000002", elegible: "unas", horarioSemana: { horaInicio: "08:00", horaFin: "17:00" }, horarioSabado: { horaInicio: "09:00", horaFin: "20:00" } },
  { nombre: "Nata", servicioLegacy: "uñas", numeroWhatsappPlaceholder: "0000000003", elegible: "unas", horarioSemana: { horaInicio: "13:00", horaFin: "20:00" }, horarioSabado: { horaInicio: "09:00", horaFin: "20:00" } },
  { nombre: "Jessica", servicioLegacy: "todos", numeroWhatsappPlaceholder: "0000000004", elegible: "todos", horarioSemana: { horaInicio: "15:00", horaFin: "20:00" }, horarioSabado: { horaInicio: "09:00", horaFin: "20:00" } },
];

const DIAS_LUNES_A_VIERNES = [1, 2, 3, 4, 5];
const DIA_SABADO = 6;

async function main() {
  console.log(`TENANT_ID (AMORE): ${TENANT_ID}`);
  console.log(`phone_number_id placeholder: ${PHONE_NUMBER_ID_PENDIENTE}`);

  // 1. Identidad del tenant (mismo rol que cumple para Daniela/Solotalento/
  // Soluciones Financieras: nombre_negocio + ancla del id_tenant). Sin
  // WhatsApp real todavía -- placeholder documentado, nunca inventa un
  // phone_number_id de Meta real.
  const { error: cfgErr } = await supabase.from("dulabs_clientes_config").insert({
    id_tenant: TENANT_ID,
    phone_number_id: PHONE_NUMBER_ID_PENDIENTE,
    nombre_negocio: "AMORE",
    // Placeholders -- whatsapp_business_account_id/telefono_negocio son
    // NOT NULL en el esquema real; ninguno es un dato de Meta real, ambos
    // deben reemplazarse al conectar WhatsApp de verdad (ver reporte).
    whatsapp_business_account_id: PHONE_NUMBER_ID_PENDIENTE,
    telefono_negocio: "0000000000",
    meta_permanent_token: null,
    flow_activo: false,
  });
  if (cfgErr) throw new Error(`dulabs_clientes_config: ${cfgErr.message}`);
  console.log("dulabs_clientes_config: OK");

  // 2. Profesionales.
  const especialistaIdPorNombre = new Map<string, number>();
  for (const p of PROFESIONALES) {
    const { data, error } = await supabase
      .from("dulabs_especialistas")
      .insert({
        id_tenant: TENANT_ID,
        phone_number_id: PHONE_NUMBER_ID_PENDIENTE,
        nombre: p.nombre,
        numero_whatsapp: p.numeroWhatsappPlaceholder,
        servicio: p.servicioLegacy,
        duracion_min: 60,
        activo: true,
        bloquea_horario: true,
        es_general: false,
        requiere_aprobacion: false,
      })
      .select("id")
      .single();
    if (error) throw new Error(`dulabs_especialistas (${p.nombre}): ${error.message}`);
    especialistaIdPorNombre.set(p.nombre, data!.id as number);
    console.log(`dulabs_especialistas: ${p.nombre} -> id=${data!.id}`);
  }

  // 3. Horarios por profesional (0=domingo..6=sábado, Date.getDay() -- mismo
  // criterio ya usado en todo el sistema). Domingo: ninguna fila para nadie
  // -> día no laboral automáticamente (ver ventanasLaboralesEspecialista,
  // lib/especialistas.ts). Festivos: mismo criterio, más abajo.
  for (const p of PROFESIONALES) {
    const especialistaId = especialistaIdPorNombre.get(p.nombre)!;
    const filas = [
      ...DIAS_LUNES_A_VIERNES.map((dia) => ({
        id_tenant: TENANT_ID,
        especialista_id: especialistaId,
        dia_semana: dia,
        hora_inicio: p.horarioSemana.horaInicio,
        hora_fin: p.horarioSemana.horaFin,
      })),
      {
        id_tenant: TENANT_ID,
        especialista_id: especialistaId,
        dia_semana: DIA_SABADO,
        hora_inicio: p.horarioSabado.horaInicio,
        hora_fin: p.horarioSabado.horaFin,
      },
    ];
    const { error } = await supabase.from("dulabs_horario_especialista").insert(filas);
    if (error) throw new Error(`dulabs_horario_especialista (${p.nombre}): ${error.message}`);
    console.log(`dulabs_horario_especialista: ${p.nombre} -> ${filas.length} filas`);
  }

  // 4. Catálogo de servicios.
  const servicioIdPorNombre = new Map<string, string>();
  for (const s of SERVICIOS) {
    const { data, error } = await supabase
      .from("dulabs_servicios")
      .insert({
        id_tenant: TENANT_ID,
        categoria: s.categoria,
        nombre: s.nombre,
        precio: s.precio,
        duracion_min: s.duracionMin,
        activo: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(`dulabs_servicios (${s.nombre}): ${error.message}`);
    servicioIdPorNombre.set(s.nombre, data!.id as string);
  }
  console.log(`dulabs_servicios: ${SERVICIOS.length} servicios cargados`);

  // 5. Elegibilidad servicio <-> profesional (dulabs_servicio_especialista).
  // "unas" -> Cristal, Mary, Nata, Jessica (todas). "otro" -> Mary, Jessica
  // (las únicas marcadas como "todos" los servicios).
  let filasElegibilidad = 0;
  for (const s of SERVICIOS) {
    const servicioId = servicioIdPorNombre.get(s.nombre)!;
    const elegibles = PROFESIONALES.filter((p) => s.elegibilidad === "unas" || p.elegible === "todos");
    const filas = elegibles.map((p) => ({
      id_tenant: TENANT_ID,
      servicio_id: servicioId,
      especialista_id: especialistaIdPorNombre.get(p.nombre)!,
    }));
    const { error } = await supabase.from("dulabs_servicio_especialista").insert(filas);
    if (error) throw new Error(`dulabs_servicio_especialista (${s.nombre}): ${error.message}`);
    filasElegibilidad += filas.length;
  }
  console.log(`dulabs_servicio_especialista: ${filasElegibilidad} filas de elegibilidad`);

  console.log("\n=== RESUMEN ===");
  console.log(JSON.stringify({ tenantId: TENANT_ID, phoneNumberIdPlaceholder: PHONE_NUMBER_ID_PENDIENTE }, null, 2));
}

main().catch((err) => {
  console.error("ERROR", err instanceof Error ? err.message : err);
  process.exit(1);
});
