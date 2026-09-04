import type { SupabaseClient } from "@supabase/supabase-js";

export type Especialista = {
  id: number;
  id_tenant: string;
  phone_number_id: string;
  nombre: string;
  numero_whatsapp: string;
  servicio: string;
  duracion_min: number;
  token: string;
  activo: boolean;
  // Si esta especialidad bloquea horario (una persona, un turno, como
  // pestañas) o es el catálogo general donde varias citas a la misma hora
  // son normales (varias personas atendiendo en paralelo).
  bloquea_horario: boolean;
  // Catálogo de respaldo: cuando un servicio pedido no calza con ninguna
  // especialidad específica de este negocio, cae aquí.
  es_general: boolean;
  // Si una solicitud para esta especialidad necesita que un humano la
  // apruebe (como pestañas -- disponibilidad real que el sistema no conoce)
  // o si puede quedar confirmada sola en cuanto el horario esté libre.
  requiere_aprobacion: boolean;
};

export type CitaEspecialista = {
  id: number;
  especialista_id: number;
  telefono_cliente: string | null;
  nombre_cliente: string;
  servicio: string;
  // Fase 3 (sistema de reservas de Daniela) — referencia estructurada
  // opcional a dulabs_servicios (ver 20260904040000_daniela_citas_servicio_id.sql).
  // Nullable y aditiva: toda cita creada por LEGACY o por el Flow no
  // activado sigue sin llenarla (queda null) -- solo las citas creadas por
  // reservarCitaPorServicio (lib/disponibilidad-servicio.ts) la traen. El
  // texto libre `servicio` se sigue llenando SIEMPRE, para no romper nada
  // que ya lo lea.
  servicio_id: string | null;
  inicio: string;
  fin: string;
  // "completada"/"no_show" agregados en la Fase 1 del sistema de reservas
  // (aditivo, ver 20260904030000_daniela_reservas_modelo_v1.sql) -- ningún
  // código existente los escribe todavía, se habilitan para uso futuro.
  estado: "pendiente" | "confirmada" | "rechazada" | "cancelada" | "propuesta" | "completada" | "no_show";
  motivo_rechazo: string | null;
  origen: string;
};

const COLUMNAS_ESPECIALISTA =
  "id, id_tenant, phone_number_id, nombre, numero_whatsapp, servicio, duracion_min, token, activo, bloquea_horario, es_general, requiere_aprobacion";
const COLUMNAS_CITA =
  "id, especialista_id, telefono_cliente, nombre_cliente, servicio, servicio_id, inicio, fin, estado, motivo_rechazo, origen";

// Código de error de Postgres para una violación de constraint EXCLUDE
// (choque de rango de tiempo) -- distinto del 23505 de un UNIQUE normal.
const CODIGO_SOLAPE = "23P01";

export async function especialistaPorToken(supabase: SupabaseClient, token: string): Promise<Especialista | null> {
  const { data } = await supabase.from("dulabs_especialistas").select(COLUMNAS_ESPECIALISTA).eq("token", token).eq("activo", true).maybeSingle();
  return (data as Especialista) ?? null;
}

// El link real es "nombre-del-spa-{token}": el nombre es puramente
// cosmético (para que el link se vea bien), lo único que de verdad protege
// el acceso es el token corto al final. Se busca por el ÚLTIMO segmento
// después del guion -- así un link sin nombre (solo el token pelado)
// también sigue funcionando, por compatibilidad.
function normalizarSlug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // quita tildes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function construirRutaAgenda(nombreNegocio: string, token: string): string {
  const slug = normalizarSlug(nombreNegocio);
  return slug ? `${slug}-${token}` : token;
}

export async function especialistaPorRuta(supabase: SupabaseClient, ruta: string): Promise<Especialista | null> {
  const token = ruta.split("-").pop() ?? ruta;
  return especialistaPorToken(supabase, token);
}

export async function especialistaPorId(supabase: SupabaseClient, id: number): Promise<Especialista | null> {
  const { data } = await supabase.from("dulabs_especialistas").select(COLUMNAS_ESPECIALISTA).eq("id", id).maybeSingle();
  return (data as Especialista) ?? null;
}

// Si quien escribe es una de las especialistas del negocio (por su número de
// WhatsApp), para tratarla como administradora y no como clienta. Una misma
// persona puede tener más de una fila (ej. Daniela: "pestañas" + "general"),
// así que toma la primera -- solo importa que exista alguna, cualquiera de
// sus filas comparte nombre/id_tenant/phone_number_id.
export async function especialistaPorNumero(
  supabase: SupabaseClient,
  phoneNumberId: string,
  numeroRemitente: string
): Promise<Especialista | null> {
  const { data } = await supabase
    .from("dulabs_especialistas")
    .select(COLUMNAS_ESPECIALISTA)
    .eq("phone_number_id", phoneNumberId)
    .eq("numero_whatsapp", numeroRemitente)
    .eq("activo", true)
    .limit(1);
  return (data?.[0] as Especialista) ?? null;
}

// True si el número tiene al menos una especialista activa configurada.
// El webhook lo usa para decidir si un número entra por el camino con
// herramienta real de agenda o sigue por el camino de siempre (texto libre)
// -- así ningún tenant sin especialistas ve cambiar su comportamiento.
export async function tieneEspecialistasActivas(supabase: SupabaseClient, phoneNumberId: string): Promise<boolean> {
  const { count } = await supabase
    .from("dulabs_especialistas")
    .select("id", { count: "exact", head: true })
    .eq("phone_number_id", phoneNumberId)
    .eq("activo", true);
  return (count ?? 0) > 0;
}

// Busca primero una especialidad específica y EXCLUSIVA (ej. "pestañas" ->
// Nicol). Comparación por contención en ambos sentidos, no igualdad exacta:
// una clienta rara vez pide el servicio pelado, casi siempre viene con el
// tipo específico ("pestañas volumen ruso") -- con igualdad exacta esa
// solicitud no calzaba con la fila "pestañas" y se perdía la protección de
// horario y la aprobación manual (bug real, encontrado en pruebas).
// Se excluyen a propósito las filas de categoría compartida (manos/pies,
// ver categoriaDeServicio) -- esas NO son una especialidad exclusiva, son
// varias personas intercambiables, y se resuelven aparte con
// especialistasPorCategoria.
export async function especialistaPorServicio(
  supabase: SupabaseClient,
  phoneNumberId: string,
  servicio: string
): Promise<Especialista | null> {
  const { data } = await supabase
    .from("dulabs_especialistas")
    .select(COLUMNAS_ESPECIALISTA)
    .eq("phone_number_id", phoneNumberId)
    .eq("es_general", false)
    .eq("activo", true);

  const pedido = servicio.toLowerCase();
  const candidatas = ((data as Especialista[]) ?? []).filter((e) => {
    const propio = e.servicio.toLowerCase();
    if (propio.includes("manos") || propio.includes("pies")) return false; // categoría compartida, no exclusiva
    return pedido.includes(propio) || propio.includes(pedido);
  });
  if (candidatas.length > 0) return candidatas[0];

  const { data: general } = await supabase
    .from("dulabs_especialistas")
    .select(COLUMNAS_ESPECIALISTA)
    .eq("phone_number_id", phoneNumberId)
    .eq("es_general", true)
    .eq("activo", true)
    .maybeSingle();
  return (general as Especialista) ?? null;
}

export type CategoriaServicio = "pies" | "manos";

// Deriva a qué categoría de recurso pertenece un servicio pedido en texto
// libre -- "pies" si menciona pies/pedicure, "manos" para todo lo demás que
// no tenga especialidad propia (incluye cejas, hidralips, forrado, press
// on, acrílicas...). Pestañas NO pasa por aquí -- sigue resolviéndose por
// especialistaPorServicio como siempre (especialidad propia, no categoría
// compartida entre varias personas).
export function categoriaDeServicio(servicio: string): CategoriaServicio {
  return /pies|pedicure/i.test(servicio) ? "pies" : "manos";
}

// Todas las especialistas activas de esta categoría (ej. "manos": Daniela y
// Carla) -- candidatas intercambiables para un mismo tipo de servicio. Cada
// una bloquea SU propio horario; que una esté ocupada no dice nada de las
// demás, por eso se agenda probando una por una (ver crearCitaEnCategoria).
export async function especialistasPorCategoria(
  supabase: SupabaseClient,
  phoneNumberId: string,
  categoria: CategoriaServicio
): Promise<Especialista[]> {
  const { data } = await supabase
    .from("dulabs_especialistas")
    .select(COLUMNAS_ESPECIALISTA)
    .eq("phone_number_id", phoneNumberId)
    .eq("activo", true)
    .ilike("servicio", `%${categoria}%`)
    .order("id", { ascending: true });
  return (data as Especialista[]) ?? [];
}

// Intenta agendar con la primera candidata de la lista que tenga el horario
// libre -- para categorías con varias personas intercambiables. Se prueba
// una por una porque el constraint EXCLUDE es por especialista_id: que una
// esté ocupada no bloquea a las demás.
export async function crearCitaEnCategoria(
  supabase: SupabaseClient,
  candidatas: Especialista[],
  params: {
    telefonoCliente: string | null;
    nombreCliente: string;
    servicio: string;
    inicio: Date;
    duracionMin: number;
    origen?: "manual" | "whatsapp_ia";
  }
): Promise<
  | { ok: true; cita: CitaEspecialista; especialista: Especialista }
  | { ok: false; motivo: "ocupado" | "sin_especialistas" | "error"; detalle?: string }
> {
  if (candidatas.length === 0) return { ok: false, motivo: "sin_especialistas" };
  for (const especialista of candidatas) {
    const resultado = await crearCitaEspecialista(supabase, {
      ...params,
      especialistaId: especialista.id,
      idTenant: especialista.id_tenant,
      phoneNumberId: especialista.phone_number_id,
      bloqueaHorario: especialista.bloquea_horario,
    });
    if (resultado.ok) return { ok: true, cita: resultado.cita, especialista };
    if (resultado.motivo === "error") return resultado;
    // motivo "ocupado": esta candidata no puede, se prueba con la siguiente.
  }
  return { ok: false, motivo: "ocupado" };
}

function horaLocal(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Bogota" });
}

// Todo lo agendado ese día entre las candidatas de una categoría, para que
// el bot pueda proponerle a la clienta un horario libre real ("tengo a las
// 3 o a las 5, ¿cuál te queda mejor?") en vez de solo decir "ocupado".
// Las horas van en formato local de Colombia (no ISO/UTC crudo) -- el resto
// del prompt razona en hora de Colombia, y mandarle UTC aquí confundía al
// modelo al calcular huecos libres (probado: agotaba los reintentos).
export async function citasDelDiaEnCategoria(
  supabase: SupabaseClient,
  candidatas: Especialista[],
  fechaISO: string
): Promise<{ especialista: string; inicio: string; fin: string }[]> {
  if (candidatas.length === 0) return [];
  const desde = new Date(`${fechaISO}T00:00:00-05:00`);
  const hasta = new Date(`${fechaISO}T23:59:59-05:00`);
  if (Number.isNaN(desde.getTime())) return [];
  const ids = candidatas.map((c) => c.id);
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .select("especialista_id, inicio, fin")
    .in("especialista_id", ids)
    .in("estado", ["pendiente", "confirmada", "propuesta"])
    .gte("inicio", desde.toISOString())
    .lte("inicio", hasta.toISOString())
    .order("inicio", { ascending: true });
  const nombrePorId = new Map(candidatas.map((c) => [c.id, c.nombre]));
  return ((data ?? []) as { especialista_id: number; inicio: string; fin: string }[]).map((r) => ({
    especialista: nombrePorId.get(r.especialista_id) ?? "?",
    inicio: horaLocal(r.inicio),
    fin: horaLocal(r.fin),
  }));
}

// Horario de atención de este spa (igual de específico que pestanasDisponible
// en especialista-solicitud-ia.ts): lunes a viernes 9am-7pm, sábado 9am-6pm,
// domingo cerrado. Ver "HORARIO DE ATENCIÓN" en la base de conocimiento.
export function ventanaAtencion(fechaISO: string): { apertura: Date; cierre: Date } | null {
  const diaSemana = new Date(`${fechaISO}T12:00:00-05:00`).getDay(); // mediodía evita cruces de día por huso horario
  if (diaSemana === 0) return null; // domingo cerrado
  const apertura = new Date(`${fechaISO}T09:00:00-05:00`);
  const cierre = new Date(`${fechaISO}T${diaSemana === 6 ? "18:00" : "19:00"}:00-05:00`);
  return { apertura, cierre };
}

// ---------------------------------------------------------------------------
// Fase 2 (sistema de reservas de Daniela) — motor de disponibilidad basado en
// datos. Estas primitivas son la ÚNICA fuente de verdad de "qué ventanas de
// tiempo están realmente libres" -- tanto hayHuecoLibreEseDia (más abajo,
// LEGACY) como listarHorariosDisponiblesEspecialista
// (especialistas-flow-adaptador.ts, Flow no activado) y el nuevo motor por
// servicio (lib/disponibilidad-servicio.ts) las reutilizan. Ninguna reimplementa
// el cálculo por su cuenta.
// ---------------------------------------------------------------------------

export type VentanaHoraria = { apertura: Date; cierre: Date };

// Postgres "time" (dulabs_horario_especialista.hora_inicio/hora_fin) llega
// como "HH:MM:SS" -- se ancla al mismo huso horario fijo que ya usa
// ventanaAtencion (America/Bogota, -05:00, Colombia no tiene horario de
// verano).
function horaEnFecha(fechaISO: string, horaHHMMSS: string): Date {
  return new Date(`${fechaISO}T${horaHHMMSS}-05:00`);
}

// Fase 8A.6 (autorizado) — corrección genérica encontrada al auditar
// disponibilidad por duración completa: si un especialista tuviera dos (o
// más) filas de horario CONTIGUAS el mismo día (ej. 08:00-10:00 seguida de
// 10:00-12:00, sin ningún hueco real entre ellas -- a diferencia de un
// horario partido real como 09-13h/14-18h con almuerzo de por medio), el
// motor las trataba como dos ventanas independientes: un servicio de más
// duración que la más larga de las dos, pero que cabría perfectamente
// cruzando el límite entre ambas (ej. 09:00-11:00 dentro de 08:00-12:00),
// no aparecía como horario válido. Se fusionan acá (antes de llegar a
// restarBloqueos/generarHorariosLibres) cualesquiera ventanas que se tocan
// o se solapan -- nunca dos que tienen un hueco real entre sí (ese hueco se
// respeta tal cual, sea almuerzo o cualquier otro). No afecta a Daniela hoy
// (ningún especialista real tiene todavía filas en
// dulabs_horario_especialista, así que este código sigue respaldando al
// horario general hardcodeado) pero es una corrección real y genérica del
// motor compartido, reutilizable para cualquier tenant futuro.
export function fusionarVentanasContiguas(ventanas: VentanaHoraria[]): VentanaHoraria[] {
  const fusionadas: VentanaHoraria[] = [];
  for (const v of ventanas) {
    const ultima = fusionadas[fusionadas.length - 1];
    if (ultima && v.apertura.getTime() <= ultima.cierre.getTime()) {
      if (v.cierre.getTime() > ultima.cierre.getTime()) ultima.cierre = v.cierre;
    } else {
      fusionadas.push({ ...v });
    }
  }
  return fusionadas;
}

// Ventanas laborales REALES de un especialista ese día, leídas de
// dulabs_horario_especialista (Fase 1) -- puede haber más de una (ej.
// 09-13h y 14-18h, horario partido). Si el especialista todavía NO tiene
// ninguna fila configurada en esta tabla -- el caso de TODOS los
// especialistas reales hoy, recién creada la tabla -- se usa como respaldo
// el horario general hardcodeado del negocio (ventanaAtencion), para que
// ningún especialista existente pierda disponibilidad mientras Daniela no
// configure sus horarios reales uno por uno. Si el especialista SÍ tiene
// horarios configurados pero ninguno cae en este día de la semana, el
// resultado es día no laboral para él (lista vacía) -- un horario real que
// no incluye, por ejemplo, el domingo, significa que no trabaja ese día, no
// que se use el horario general por error. Ventanas contiguas/solapadas se
// fusionan (ver fusionarVentanasContiguas) -- un hueco real entre dos
// ventanas (almuerzo, etc.) se conserva tal cual.
export async function ventanasLaboralesEspecialista(
  supabase: SupabaseClient,
  especialistaId: number,
  idTenant: string,
  fechaISO: string
): Promise<VentanaHoraria[]> {
  const { data } = await supabase
    .from("dulabs_horario_especialista")
    .select("dia_semana, hora_inicio, hora_fin")
    .eq("id_tenant", idTenant)
    .eq("especialista_id", especialistaId)
    .eq("activo", true);
  const filas = (data ?? []) as { dia_semana: number; hora_inicio: string; hora_fin: string }[];

  if (filas.length === 0) {
    const ventana = ventanaAtencion(fechaISO);
    return ventana ? [ventana] : [];
  }

  const diaSemana = new Date(`${fechaISO}T12:00:00-05:00`).getDay();
  const ventanas = filas
    .filter((f) => f.dia_semana === diaSemana)
    .map((f) => ({ apertura: horaEnFecha(fechaISO, f.hora_inicio), cierre: horaEnFecha(fechaISO, f.hora_fin) }))
    .sort((a, b) => a.apertura.getTime() - b.apertura.getTime());
  return fusionarVentanasContiguas(ventanas);
}

// Bloqueos (Fase 1: dulabs_bloqueos) que afectan a este especialista ese día
// -- los suyos propios y los generales del tenant (especialista_id NULL, ej.
// "el spa cierra ese día completo"). Solo bloqueos activos que de verdad se
// solapan con la fecha consultada.
export async function bloqueosDelDia(
  supabase: SupabaseClient,
  especialistaId: number,
  idTenant: string,
  fechaISO: string
): Promise<VentanaHoraria[]> {
  const desde = new Date(`${fechaISO}T00:00:00-05:00`).toISOString();
  const hasta = new Date(`${fechaISO}T23:59:59-05:00`).toISOString();
  const { data } = await supabase
    .from("dulabs_bloqueos")
    .select("inicio, fin")
    .eq("id_tenant", idTenant)
    .eq("activo", true)
    .lt("inicio", hasta)
    .gt("fin", desde)
    .or(`especialista_id.eq.${especialistaId},especialista_id.is.null`);
  return ((data ?? []) as { inicio: string; fin: string }[]).map((b) => ({
    apertura: new Date(b.inicio),
    cierre: new Date(b.fin),
  }));
}

// Resta rangos bloqueados de las ventanas laborales -- puede partir una
// ventana en dos (ej. un almuerzo a la mitad del horario) o eliminarla del
// todo si el bloqueo la cubre completa. Pura, sin I/O: fácil de probar
// exhaustivamente. No modela recurrencia -- los bloqueos de la Fase 1 son
// rangos concretos, tal como se pidió.
export function restarBloqueos(ventanas: VentanaHoraria[], bloqueos: VentanaHoraria[]): VentanaHoraria[] {
  let resultado = ventanas;
  for (const bloqueo of bloqueos) {
    const siguiente: VentanaHoraria[] = [];
    for (const v of resultado) {
      if (bloqueo.cierre <= v.apertura || bloqueo.apertura >= v.cierre) {
        siguiente.push(v); // sin solape con esta ventana
        continue;
      }
      if (bloqueo.apertura > v.apertura) siguiente.push({ apertura: v.apertura, cierre: bloqueo.apertura });
      if (bloqueo.cierre < v.cierre) siguiente.push({ apertura: bloqueo.cierre, cierre: v.cierre });
    }
    resultado = siguiente;
  }
  return resultado;
}

// Cada cuánto se ofrece un horario dentro de una ventana de atención (mismo
// valor que ya usaba especialistas-flow-adaptador.ts antes de la Fase 2,
// centralizado acá para que ambos motores compartan un solo default).
export const GRANULARIDAD_HORARIOS_MIN = 30;

// Candidatos de horario de inicio, cada granularidadMin minutos, que caben
// completos (inicio + duración <= cierre de alguna ventana) y no se solapan
// con ninguna cita ya ocupada -- soporta varias ventanas el mismo día
// (horario partido). Pura, sin I/O: fácil de probar exhaustivamente.
export function generarHorariosLibres(
  ventanas: VentanaHoraria[],
  ocupadas: VentanaHoraria[],
  duracionMin: number,
  granularidadMin: number = GRANULARIDAD_HORARIOS_MIN
): Date[] {
  const necesarioMs = duracionMin * 60_000;
  const pasoMs = granularidadMin * 60_000;
  const horarios: Date[] = [];
  for (const ventana of ventanas) {
    for (let cursorMs = ventana.apertura.getTime(); cursorMs + necesarioMs <= ventana.cierre.getTime(); cursorMs += pasoMs) {
      const inicioSlot = new Date(cursorMs);
      const finSlot = new Date(cursorMs + necesarioMs);
      const solapa = ocupadas.some((o) => inicioSlot < o.cierre && finSlot > o.apertura);
      if (!solapa) horarios.push(inicioSlot);
    }
  }
  return horarios;
}

// Verdadero si hay al menos un hueco continuo de necesarioMs milisegundos
// libre dentro de ESTA ventana puntual -- el mismo algoritmo de barrido que
// hayHuecoLibreEseDia ya usaba antes de la Fase 2 (encuentra cualquier hueco
// suficiente, no solo horarios alineados a la grilla de 30 min), ahora
// factorizado para poder aplicarse a más de una ventana el mismo día.
function hayGapLibreEnVentana(ventana: VentanaHoraria, ocupadas: VentanaHoraria[], necesarioMs: number): boolean {
  let cursor = ventana.apertura.getTime();
  for (const cita of ocupadas) {
    const inicioMs = cita.apertura.getTime();
    const finMs = cita.cierre.getTime();
    if (finMs <= cursor || inicioMs >= ventana.cierre.getTime()) continue; // fuera de esta ventana
    if (inicioMs - cursor >= necesarioMs) return true;
    cursor = Math.max(cursor, finMs);
  }
  return ventana.cierre.getTime() - cursor >= necesarioMs;
}

// Determina si esta especialista tiene AL MENOS un hueco de duracionMin
// minutos libre ese día (no solo a una hora puntual) dentro de su horario
// real -- para reglas de desborde tipo "si Kelly no tiene NINGÚN espacio ese
// día, se le puede dar a Carla" (ver ejecutarHerramienta en
// especialista-solicitud-ia.ts, y la conversación real con la dueña del
// negocio del 2026-08-26 que definió esta regla).
//
// Fase 2: ahora lee horario real (dulabs_horario_especialista) y bloqueos
// (dulabs_bloqueos) en vez del horario general hardcodeado -- pero con
// respaldo automático a ventanaAtencion() mientras el especialista no tenga
// horarios configurados, así que el comportamiento para los especialistas
// reales de hoy (sin filas en la tabla nueva) es idéntico al de antes de
// esta fase.
export async function hayHuecoLibreEseDia(
  supabase: SupabaseClient,
  especialista: Especialista,
  fechaISO: string,
  duracionMin: number
): Promise<boolean> {
  const [ventanasBase, bloqueos] = await Promise.all([
    ventanasLaboralesEspecialista(supabase, especialista.id, especialista.id_tenant, fechaISO),
    bloqueosDelDia(supabase, especialista.id, especialista.id_tenant, fechaISO),
  ]);
  const ventanas = restarBloqueos(ventanasBase, bloqueos);
  if (ventanas.length === 0) return false;

  const desde = ventanas[0]!.apertura.toISOString();
  const hasta = ventanas[ventanas.length - 1]!.cierre.toISOString();
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .select("inicio, fin")
    .eq("especialista_id", especialista.id)
    .in("estado", ["pendiente", "confirmada", "propuesta"])
    .gte("inicio", desde)
    .lt("inicio", hasta)
    .order("inicio", { ascending: true });
  const ocupadas = ((data ?? []) as { inicio: string; fin: string }[]).map((c) => ({
    apertura: new Date(c.inicio),
    cierre: new Date(c.fin),
  }));

  const necesarioMs = duracionMin * 60_000;
  return ventanas.some((v) => hayGapLibreEnVentana(v, ocupadas, necesarioMs));
}

// Todas las especialidades activas que pertenecen a la MISMA persona (mismo
// número de WhatsApp) -- ej. Daniela puede tener "pestañas" y "general" a la
// vez. Sirve para que un solo link de agenda muestre y gestione TODAS sus
// citas, sin que tenga que abrir un link distinto por cada especialidad.
export async function especialistasDelMismaPersona(
  supabase: SupabaseClient,
  phoneNumberId: string,
  numeroWhatsapp: string
): Promise<Especialista[]> {
  const { data } = await supabase
    .from("dulabs_especialistas")
    .select(COLUMNAS_ESPECIALISTA)
    .eq("phone_number_id", phoneNumberId)
    .eq("numero_whatsapp", numeroWhatsapp)
    .eq("activo", true);
  return (data as Especialista[]) ?? [];
}

export async function citasDeEspecialista(
  supabase: SupabaseClient,
  especialistaId: number,
  opts?: { desde?: string; estados?: string[] }
): Promise<CitaEspecialista[]> {
  let query = supabase
    .from("dulabs_citas_especialista")
    .select(COLUMNAS_CITA)
    .eq("especialista_id", especialistaId)
    .order("inicio", { ascending: true });
  if (opts?.desde) query = query.gte("inicio", opts.desde);
  if (opts?.estados) query = query.in("estado", opts.estados);
  const { data } = await query;
  return (data as CitaEspecialista[]) ?? [];
}

// Crea una solicitud de cita. Nunca hace un "check antes, insert después":
// intenta insertar directo y deja que el constraint EXCLUDE de Postgres sea
// el único árbitro real de si hay choque -- así es imposible que dos
// solicitudes casi simultáneas para el mismo horario pasen ambas.
export async function crearCitaEspecialista(
  supabase: SupabaseClient,
  params: {
    especialistaId: number;
    idTenant: string;
    phoneNumberId: string;
    telefonoCliente: string | null;
    nombreCliente: string;
    servicio: string;
    // Fase 3 — referencia estructurada opcional a dulabs_servicios. Ningún
    // caller LEGACY ni del Flow no activado la pasa (queda undefined ->
    // null en la fila, comportamiento idéntico al de antes de esta fase).
    // Solo reservarCitaPorServicio (lib/disponibilidad-servicio.ts) la pasa.
    servicioId?: string | null;
    inicio: Date;
    duracionMin: number;
    // Si esta cita en particular participa en el candado de choque de
    // horario -- normalmente se copia directo de especialista.bloquea_horario
    // (ver lib/especialistas.ts Especialista.bloquea_horario).
    bloqueaHorario: boolean;
    origen?: "manual" | "whatsapp_ia";
  }
): Promise<{ ok: true; cita: CitaEspecialista } | { ok: false; motivo: "ocupado" | "error"; detalle?: string }> {
  const fin = new Date(params.inicio.getTime() + params.duracionMin * 60_000);
  const { data, error } = await supabase
    .from("dulabs_citas_especialista")
    .insert({
      especialista_id: params.especialistaId,
      id_tenant: params.idTenant,
      phone_number_id: params.phoneNumberId,
      telefono_cliente: params.telefonoCliente,
      nombre_cliente: params.nombreCliente,
      servicio: params.servicio,
      servicio_id: params.servicioId ?? null,
      bloquea_horario: params.bloqueaHorario,
      inicio: params.inicio.toISOString(),
      fin: fin.toISOString(),
      origen: params.origen ?? "manual",
    })
    .select(COLUMNAS_CITA)
    .single();

  if (error) {
    if (error.code === CODIGO_SOLAPE) return { ok: false, motivo: "ocupado" };
    return { ok: false, motivo: "error", detalle: error.message };
  }
  return { ok: true, cita: data as CitaEspecialista };
}

export async function confirmarCita(supabase: SupabaseClient, citaId: number): Promise<CitaEspecialista | null> {
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .update({ estado: "confirmada", updated_at: new Date().toISOString() })
    .eq("id", citaId)
    .eq("estado", "pendiente") // solo desde pendiente -- evita reprocesar una ya resuelta
    .select(COLUMNAS_CITA)
    .maybeSingle();
  return (data as CitaEspecialista) ?? null;
}

export async function rechazarCita(supabase: SupabaseClient, citaId: number, motivo?: string): Promise<CitaEspecialista | null> {
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .update({ estado: "rechazada", motivo_rechazo: motivo ?? null, updated_at: new Date().toISOString() })
    .eq("id", citaId)
    .eq("estado", "pendiente")
    .select(COLUMNAS_CITA)
    .maybeSingle();
  return (data as CitaEspecialista) ?? null;
}

// La especialista propone un horario distinto al pedido. Actualiza la MISMA
// fila (no crea una nueva) para que el constraint EXCLUDE retenga el nuevo
// horario mientras la clienta decide -- otra persona no puede tomarlo
// mientras tanto. Si el horario propuesto choca con otra cita, Postgres lo
// rechaza igual que en crearCitaEspecialista.
export async function proponerReagendamiento(
  supabase: SupabaseClient,
  citaId: number,
  nuevoInicio: Date,
  duracionMin: number
): Promise<{ ok: true; cita: CitaEspecialista } | { ok: false; motivo: "ocupado" | "no_encontrada" | "error"; detalle?: string }> {
  const nuevoFin = new Date(nuevoInicio.getTime() + duracionMin * 60_000);
  const { data, error } = await supabase
    .from("dulabs_citas_especialista")
    .update({ inicio: nuevoInicio.toISOString(), fin: nuevoFin.toISOString(), estado: "propuesta", updated_at: new Date().toISOString() })
    .eq("id", citaId)
    .eq("estado", "pendiente") // solo se propone sobre una solicitud aún sin resolver
    .select(COLUMNAS_CITA)
    .maybeSingle();

  if (error) {
    if (error.code === CODIGO_SOLAPE) return { ok: false, motivo: "ocupado" };
    return { ok: false, motivo: "error", detalle: error.message };
  }
  if (!data) return { ok: false, motivo: "no_encontrada" };
  return { ok: true, cita: data as CitaEspecialista };
}

// La clienta acepta el horario propuesto -- ya estaba retenido, solo se
// confirma. No hace falta re-chequear disponibilidad: nadie más pudo
// haberlo tomado mientras estaba en 'propuesta'.
export async function aceptarPropuesta(supabase: SupabaseClient, citaId: number): Promise<CitaEspecialista | null> {
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .update({ estado: "confirmada", updated_at: new Date().toISOString() })
    .eq("id", citaId)
    .eq("estado", "propuesta")
    .select(COLUMNAS_CITA)
    .maybeSingle();
  return (data as CitaEspecialista) ?? null;
}

// La clienta no acepta el horario propuesto: se libera de inmediato (deja de
// bloquear el constraint) para que alguien más pueda tomarlo.
export async function rechazarPropuesta(supabase: SupabaseClient, citaId: number): Promise<CitaEspecialista | null> {
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .update({ estado: "rechazada", motivo_rechazo: "La clienta no aceptó el horario propuesto", updated_at: new Date().toISOString() })
    .eq("id", citaId)
    .eq("estado", "propuesta")
    .select(COLUMNAS_CITA)
    .maybeSingle();
  return (data as CitaEspecialista) ?? null;
}

// Edita una cita que YA está confirmada (cambio de horario, duración o
// servicio decidido por la especialista, no una propuesta que la clienta
// deba aceptar). Sigue el mismo camino atómico: el constraint EXCLUDE
// decide si el nuevo horario choca con otra cita.
export async function editarCitaConfirmada(
  supabase: SupabaseClient,
  citaId: number,
  cambios: { nuevoInicio?: Date; duracionMin?: number; servicio?: string; especialistaId?: number }
): Promise<{ ok: true; cita: CitaEspecialista } | { ok: false; motivo: "ocupado" | "no_encontrada" | "error"; detalle?: string }> {
  const { data: actual } = await supabase
    .from("dulabs_citas_especialista")
    .select(COLUMNAS_CITA)
    .eq("id", citaId)
    .eq("estado", "confirmada")
    .maybeSingle();
  if (!actual) return { ok: false, motivo: "no_encontrada" };
  const cita = actual as CitaEspecialista;

  const inicio = cambios.nuevoInicio ?? new Date(cita.inicio);
  const duracionMin = cambios.duracionMin ?? (new Date(cita.fin).getTime() - new Date(cita.inicio).getTime()) / 60_000;
  const fin = new Date(inicio.getTime() + duracionMin * 60_000);

  const { data, error } = await supabase
    .from("dulabs_citas_especialista")
    .update({
      inicio: inicio.toISOString(),
      fin: fin.toISOString(),
      servicio: cambios.servicio?.trim() || cita.servicio,
      // Reasignar a otra persona del equipo pasa por la MISMA columna que
      // usa el constraint EXCLUDE -- si la persona elegida ya tiene algo a
      // esa hora, Postgres rechaza el UPDATE completo (CODIGO_SOLAPE) igual
      // que rechazaría un choque de horario normal, nunca queda a medias.
      especialista_id: cambios.especialistaId ?? cita.especialista_id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", citaId)
    .eq("estado", "confirmada")
    .select(COLUMNAS_CITA)
    .maybeSingle();

  if (error) {
    if (error.code === CODIGO_SOLAPE) return { ok: false, motivo: "ocupado" };
    return { ok: false, motivo: "error", detalle: error.message };
  }
  if (!data) return { ok: false, motivo: "no_encontrada" };
  return { ok: true, cita: data as CitaEspecialista };
}

// Cancela una cita, sea que aún esté pendiente de confirmación o ya
// confirmada. 'cancelada' no está en el WHERE del constraint EXCLUDE, así
// que el horario queda libre de inmediato para que alguien más lo tome.
export async function cancelarCita(supabase: SupabaseClient, citaId: number, motivo?: string): Promise<CitaEspecialista | null> {
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .update({ estado: "cancelada", motivo_rechazo: motivo ?? null, updated_at: new Date().toISOString() })
    .eq("id", citaId)
    .in("estado", ["pendiente", "confirmada"])
    .select(COLUMNAS_CITA)
    .maybeSingle();
  return (data as CitaEspecialista) ?? null;
}

// Fase 5 (panel administrativo de Daniela) — cierre real de una cita que ya
// pasó: la especialista marca si la clienta asistió o no. Mismo patrón
// exacto que confirmarCita/rechazarCita (UPDATE con guarda de estado, nunca
// "check antes, update después"). Solo desde 'confirmada' -- una cita que
// nunca se confirmó no tiene sentido marcarla completada/no_show.
export async function marcarCitaCompletada(supabase: SupabaseClient, citaId: number): Promise<CitaEspecialista | null> {
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .update({ estado: "completada", updated_at: new Date().toISOString() })
    .eq("id", citaId)
    .eq("estado", "confirmada")
    .select(COLUMNAS_CITA)
    .maybeSingle();
  return (data as CitaEspecialista) ?? null;
}

export async function marcarCitaNoShow(supabase: SupabaseClient, citaId: number): Promise<CitaEspecialista | null> {
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .update({ estado: "no_show", updated_at: new Date().toISOString() })
    .eq("id", citaId)
    .eq("estado", "confirmada")
    .select(COLUMNAS_CITA)
    .maybeSingle();
  return (data as CitaEspecialista) ?? null;
}

// Busca la cita activa (pendiente o confirmada) más próxima de esta clienta
// con esta especialidad/negocio, para que el bot sepa a cuál se refiere
// cuando pide cambiar la hora o cancelar, sin que ella tenga que repetir
// fecha y servicio.
export async function citaActivaPara(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoCliente: string
): Promise<CitaEspecialista | null> {
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .select(COLUMNAS_CITA)
    .eq("phone_number_id", phoneNumberId)
    .eq("telefono_cliente", telefonoCliente)
    .in("estado", ["pendiente", "confirmada"])
    .gte("inicio", new Date().toISOString())
    .order("inicio", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as CitaEspecialista) ?? null;
}

// Busca si esta clienta tiene una propuesta de horario esperando respuesta,
// para que el bot sepa que su próximo mensaje probablemente es un sí/no a
// eso, y no una solicitud nueva.
export async function propuestaPendientePara(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoCliente: string
): Promise<CitaEspecialista | null> {
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .select(COLUMNAS_CITA)
    .eq("phone_number_id", phoneNumberId)
    .eq("telefono_cliente", telefonoCliente)
    .eq("estado", "propuesta")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as CitaEspecialista) ?? null;
}
