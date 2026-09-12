import type { SupabaseClient } from "@supabase/supabase-js";

// Busca el nombre conocido de esta clienta, si alguna vez lo dio de verdad
// al agendar (no el nombre de perfil de WhatsApp, que no es confiable).
export async function nombreConocido(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoCliente: string
): Promise<string | null> {
  const { data } = await supabase
    .from("dulabs_clientes_conocidos")
    .select("nombre")
    .eq("phone_number_id", phoneNumberId)
    .eq("telefono_cliente", telefonoCliente)
    .maybeSingle();
  return data?.nombre ?? null;
}

// AMORE (Fase 2 -- registro de clientes nuevos, autorizado) — lectura
// completa (nombre + cumpleaños) de una clienta ya conocida, para decidir si
// el registro determinístico debe iniciarse (ver lib/agenda-v2/router.ts::iniciarNuevaSesionAgendaV2)
// y para recuperar los datos ya guardados en los pasos intermedios del
// registro (día/mes) sin volver a pedirlos. Mismo criterio de identificación
// EXACTO que nombreConocido -- (phone_number_id, telefono_cliente).
export async function clienteConocidoCompleto(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoCliente: string
): Promise<{ nombre: string; cumpleDia: number | null; cumpleMes: number | null } | null> {
  const { data } = await supabase
    .from("dulabs_clientes_conocidos")
    .select("nombre, cumple_dia, cumple_mes")
    .eq("phone_number_id", phoneNumberId)
    .eq("telefono_cliente", telefonoCliente)
    .maybeSingle();
  if (!data) return null;
  return { nombre: data.nombre as string, cumpleDia: (data.cumple_dia as number | null) ?? null, cumpleMes: (data.cumple_mes as number | null) ?? null };
}

// Guarda o actualiza el nombre de esta clienta. Nunca lanza: recordar un
// nombre es un extra de cortesía, no puede tumbar el flujo que lo dispara
// (crear una cita, etc.) si falla.
//
// Fase 3 (sistema de reservas de Daniela) — `correo` es opcional y aditivo
// (ver dulabs_clientes_conocidos.correo, 20260904030000_daniela_reservas_modelo_v1.sql).
// Ningún caller LEGACY lo pasa -- al omitirlo, el upsert ni siquiera incluye
// esa columna en el UPDATE, así que un correo ya guardado antes NUNCA se
// borra por reservar sin él. No es CRM: solo se conserva si el canal que
// crea la reserva de verdad lo tiene (ej. portal, Fase 4).
//
// AMORE (Fase 3 del portal, autorizado) — `cumpleDia`/`cumpleMes` (SOLO día
// y mes, nunca año; ver dulabs_clientes_conocidos.cumple_dia/cumple_mes,
// 20260904210000_clientes_conocidos_cumpleanos.sql) siguen EXACTAMENTE el
// mismo criterio aditivo que `correo`: ningún caller existente (LEGACY,
// portal de Daniela) los manda, así que su ausencia nunca borra un dato ya
// guardado ni cambia el comportamiento de nadie que no los use. Preparado
// para una fase futura de cumpleaños/fidelización -- este archivo NO
// implementa ningún automatismo con el dato, solo lo guarda.
export async function recordarNombreCliente(
  supabase: SupabaseClient,
  params: {
    idTenant: string;
    phoneNumberId: string;
    telefonoCliente: string;
    nombre: string;
    correo?: string | null;
    cumpleDia?: number | null;
    cumpleMes?: number | null;
  }
): Promise<void> {
  const nombre = params.nombre.trim();
  if (!nombre) return;
  try {
    const correo = params.correo?.trim();
    const cumpleDia = params.cumpleDia && params.cumpleDia >= 1 && params.cumpleDia <= 31 ? params.cumpleDia : undefined;
    const cumpleMes = params.cumpleMes && params.cumpleMes >= 1 && params.cumpleMes <= 12 ? params.cumpleMes : undefined;
    await supabase.from("dulabs_clientes_conocidos").upsert(
      {
        id_tenant: params.idTenant,
        phone_number_id: params.phoneNumberId,
        telefono_cliente: params.telefonoCliente,
        nombre,
        ...(correo ? { correo } : {}),
        ...(cumpleDia !== undefined ? { cumple_dia: cumpleDia } : {}),
        ...(cumpleMes !== undefined ? { cumple_mes: cumpleMes } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "phone_number_id,telefono_cliente" }
    );
  } catch (err) {
    console.error("[clientes-conocidos] error guardando nombre:", err instanceof Error ? err.message : err);
  }
}

// FASE F7 (Contacts + Variables + Tags, autorizado) — resuelve el contacto
// real (phone_number_id, telefono_cliente) al iniciar una ejecución del Flow
// Engine, o lo crea si es la primera vez que se ve este par. Nunca lanza:
// igual que recordarNombreCliente, resolver/crear el contacto es un paso de
// enriquecimiento -- un error acá NUNCA debe impedir que la ejecución del
// Flow se cree (se degrada a customFields:{}).
//
// Concurrencia: `nombre` es NOT NULL en la tabla real, así que la creación
// usa telefonoCliente como placeholder seguro (nunca vacío; se sobrescribe
// solo si algo llama recordarNombreCliente con un nombre real después,
// exactamente igual que hoy). La seguridad real contra duplicados bajo
// carrera NO vive acá: la viola el unique (phone_number_id, telefono_cliente)
// ya existente (20260825250000_clientes_conocidos.sql) -- si dos invocaciones
// concurrentes intentan crear el mismo contacto, Postgres rechaza la
// perdedora con 23505 y esta función simplemente vuelve a leer la fila
// (ya creada por la ganadora) en vez de tratarlo como un error.
export async function resolverOCrearContacto(
  supabase: SupabaseClient,
  params: { idTenant: string; phoneNumberId: string; telefonoCliente: string }
): Promise<{ customFields: Record<string, unknown> }> {
  try {
    const { data: existing } = await supabase
      .from("dulabs_clientes_conocidos")
      .select("custom_fields")
      .eq("phone_number_id", params.phoneNumberId)
      .eq("telefono_cliente", params.telefonoCliente)
      .maybeSingle();
    if (existing) {
      return { customFields: (existing.custom_fields as Record<string, unknown> | null) ?? {} };
    }

    const { error } = await supabase.from("dulabs_clientes_conocidos").insert({
      id_tenant: params.idTenant,
      phone_number_id: params.phoneNumberId,
      telefono_cliente: params.telefonoCliente,
      nombre: params.telefonoCliente,
    });
    if (error && error.code !== "23505") {
      console.error("[clientes-conocidos] error creando contacto:", error.message);
      return { customFields: {} };
    }

    // Ganadora de la creación (o perdedora de la carrera, 23505): en ambos
    // casos la fila ya existe -- se relee para devolver custom_fields real
    // (nunca '{}' asumido, por si otra invocación ya la había poblado).
    const { data: fresh } = await supabase
      .from("dulabs_clientes_conocidos")
      .select("custom_fields")
      .eq("phone_number_id", params.phoneNumberId)
      .eq("telefono_cliente", params.telefonoCliente)
      .maybeSingle();
    return { customFields: (fresh?.custom_fields as Record<string, unknown> | null) ?? {} };
  } catch (err) {
    console.error("[clientes-conocidos] error resolviendo contacto:", err instanceof Error ? err.message : err);
    return { customFields: {} };
  }
}

// FASE F7.3 (Contacto + Tags + IA, autorizado) — lectura PURA del contacto
// actual (custom_fields), a diferencia de resolverOCrearContacto: nunca
// inserta una fila. Existe para el tool "get_contact" del nodo AI (una
// acción clasificada READ) -- no tiene sentido que una operación de solo
// lectura tenga como efecto secundario crear un contacto que no existía.
// Nunca lanza: mismo criterio que el resto del archivo, degrada a {} si el
// contacto no existe o si la consulta falla.
export async function leerContactoActual(
  supabase: SupabaseClient,
  params: { phoneNumberId: string; telefonoCliente: string }
): Promise<{ customFields: Record<string, unknown> }> {
  try {
    const { data } = await supabase
      .from("dulabs_clientes_conocidos")
      .select("custom_fields")
      .eq("phone_number_id", params.phoneNumberId)
      .eq("telefono_cliente", params.telefonoCliente)
      .maybeSingle();
    return { customFields: (data?.custom_fields as Record<string, unknown> | null) ?? {} };
  } catch (err) {
    console.error("[clientes-conocidos] error leyendo contacto:", err instanceof Error ? err.message : err);
    return { customFields: {} };
  }
}

// FASE F7 (Contacts + Variables + Tags, autorizado) — persiste en el
// contacto real los campos que save_data(target="custom_field") dejó en
// state.exports.custom_fields (antes un balde muerto, ver flow-engine.ts::
// applySaveDataMappings). MERGE, nunca replace: campos ya guardados en
// turnos anteriores (o por otro canal) que esta ejecución no vuelve a
// mandar NUNCA se borran. Nunca lanza -- mismo criterio que
// recordarNombreCliente/resolverOCrearContacto (persistir un custom_field es
// un enriquecimiento, no puede tumbar el turno del Flow que lo generó).
export async function actualizarCampoPersonalizado(
  supabase: SupabaseClient,
  params: {
    idTenant: string;
    phoneNumberId: string;
    telefonoCliente: string;
    customFields: Record<string, unknown>;
  }
): Promise<void> {
  if (Object.keys(params.customFields).length === 0) return;
  try {
    const { data: existing } = await supabase
      .from("dulabs_clientes_conocidos")
      .select("custom_fields")
      .eq("phone_number_id", params.phoneNumberId)
      .eq("telefono_cliente", params.telefonoCliente)
      .maybeSingle();

    const merged = {
      ...((existing?.custom_fields as Record<string, unknown> | null) ?? {}),
      ...params.customFields,
    };

    if (existing) {
      await supabase
        .from("dulabs_clientes_conocidos")
        .update({ custom_fields: merged, updated_at: new Date().toISOString() })
        .eq("phone_number_id", params.phoneNumberId)
        .eq("telefono_cliente", params.telefonoCliente);
      return;
    }

    // No debería ocurrir en la práctica (la ejecución ya llamó
    // resolverOCrearContacto al iniciar) -- cubierto de todos modos para que
    // esta función nunca dependa de un orden de llamadas implícito.
    await supabase.from("dulabs_clientes_conocidos").upsert(
      {
        id_tenant: params.idTenant,
        phone_number_id: params.phoneNumberId,
        telefono_cliente: params.telefonoCliente,
        nombre: params.telefonoCliente,
        custom_fields: merged,
      },
      { onConflict: "phone_number_id,telefono_cliente" }
    );
  } catch (err) {
    console.error(
      "[clientes-conocidos] error guardando custom_fields:",
      err instanceof Error ? err.message : err
    );
  }
}
