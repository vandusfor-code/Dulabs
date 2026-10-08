/**
 * FASE 3B.9A — APROVISIONAMIENTO DE UN NEGOCIO SIN ACTIVARLO (Aquí Sí Lo Compras).
 *
 * Qué hace este módulo (puro, sin red ni base de datos):
 *   1. Guarda SOLO lo que el negocio ya aprobó (DATOS_APROBADOS_ASLC): nunca un valor inventado, copiado de otro negocio o "de prueba".
 *   2. Arma la fila BASE del agente: DESHABILITADA, checkout y audio apagados, vocabulario neutral, credencial propia, solo contra entrega.
 *      Esa fila sola ya protege al número: con ella el webhook entrega TODO mensaje al agente (que está deshabilitado y calla) antes de
 *      llegar al Flow, al Business Agent o al bot legacy; sin ella (kind "none") el número cae a esos caminos.
 *   3. Evalúa una configuración COMPLETA candidata y devuelve exactamente lo que falta (`pendientes`), usando el MISMO esquema que el
 *      runtime: un campo obligatorio sin valor aprobado queda pendiente, jamás se rellena con un texto o dato inventado.
 *   4. Genera el SQL de aprovisionamiento (transaccional, idempotente, con guardas) que el dueño revisa y corre; este código no se conecta
 *      a ninguna base.
 *
 * Qué NO hace: no activa la IA, no pone el cierre con aceptación humana, no crea personas, no carga catálogo, no escribe textos comerciales.
 */
import { AGENT_TOOL_NAMES, esHerramientaComercial, type AgentToolName } from "@/lib/agente/nombres-herramientas";
import { checkoutOpcionesSchema, type CheckoutOpciones } from "@/lib/agente/perfil-negocio";
import type { PaymentMethod } from "@/lib/catalogo/pedidos/contrato";

// ---------------------------------------------------------------------------
// Lo que el negocio ya aprobó
// ---------------------------------------------------------------------------

/**
 * Datos de Aquí Sí Lo Compras entregados por el dueño. Todo lo demás (textos, responsable, cobertura, decisiones D1–D18) está PENDIENTE hasta
 * que el negocio lo entregue. Los identificadores del negocio en producción viven en IDENTIDAD_ASLC_PRODUCCION (verificados con una lectura real).
 */
export const DATOS_APROBADOS_ASLC = Object.freeze({
  nombreNegocio: "Aquí Sí Lo Compras",
  /** Últimos dígitos del WhatsApp que informó el negocio. El número completo y el correo NO se guardan aquí: el repositorio es público. */
  whatsappTerminaEn: "5088",
  /** Pago: ÚNICAMENTE contra entrega (sin anticipos, Nequi, Daviplata ni transferencias). */
  pagos: ["contra_entrega"] as readonly PaymentMethod[],
  /** Envío GRATIS (regla del negocio). */
  envioGratis: true,
  /** Transportadora más frecuente (información, no una promesa por ciudad). Escrita como la escribe el negocio. */
  transportadoraHabitual: "Interrapidísimo",
  /** Otras ciudades: normalmente 2 a 3 días hábiles. */
  diasHabiles: Object.freeze({ min: 2, max: 3 }),
  /** Bogotá: antes de las 11:30 a. m. puede tener entrega el mismo día (hora de Colombia). */
  corteBogota: Object.freeze({ hora_limite: "11:30", zona_horaria: "America/Bogota" as const }),
  /** Sin certeza (ciudad, cobertura o tiempo): una persona. */
  sinCerteza: "handoff" as const,
});

/**
 * Identidad de ASLC en producción, VERIFICADA con una lectura de solo lectura el 2026-10-03: UNA sola fila de dulabs_clientes_config con ese
 * nombre; el tenant y el phone_number_id coinciden con los que el dueño aplicó en la Fase 3A. El SQL actúa SOLO si los tres coinciden.
 * El teléfono de WhatsApp informado por el negocio (DATOS_APROBADOS_ASLC.whatsappTerminaEn) NO es parte de la identidad: el teléfono registrado en la
 * base para ese número de Meta es otro (distinto del informado), discrepancia que debe resolver el dueño; por eso nunca se usa para encontrar la fila.
 */
export const IDENTIDAD_ASLC_PRODUCCION = Object.freeze({
  idTenant: "320121d7-2bc5-472d-944b-5191cc228e1f",
  phoneNumberId: "1317599831437793",
  /** Patrón (sin distinguir mayúsculas ni tildes) del nombre registrado: "Aqui Si Lo Compras". */
  patronNombre: "lo compras",
});

/** Variable de entorno de la credencial de Gemini PROPIA de ASLC (nunca la de otro negocio). El secreto no vive aquí ni en la base. */
export const CREDENCIAL_GEMINI_ASLC = "env:GEMINI_KEY_ASLC";

// ---------------------------------------------------------------------------
// Fila base del agente (DESHABILITADA)
// ---------------------------------------------------------------------------

/**
 * Herramientas de ASLC: todas menos confirm_order (la aceptación del pedido es SIEMPRE de una persona; el modelo no confirma) y menos las de información comercial
 * del CMS (Bloque 29: ASLC no usa el CMS; agregar una herramienta nueva al universo cerrado NO debe cambiar lo que ASLC ya tiene aprovisionado).
 */
export const HERRAMIENTAS_ASLC: readonly AgentToolName[] = Object.freeze(AGENT_TOOL_NAMES.filter((t) => t !== "confirm_order" && !esHerramientaComercial(t)));

/** Opciones del checkout que ya se pueden fijar: solo domicilio y solo los pagos aprobados. Lo demás espera al negocio. */
export function opcionesBaseAslc(): CheckoutOpciones {
  // activacion_pendiente: CANDADO (la configuración es inválida y el agente calla aunque alguien habilite la fila antes de tiempo).
  const r = checkoutOpcionesSchema.safeParse({ entregas: ["domicilio"], pagos: DATOS_APROBADOS_ASLC.pagos.map((metodo) => ({ metodo })), activacion_pendiente: true });
  if (!r.success) throw new Error("opciones base de ASLC inválidas");
  return r.data;
}

/** La fila (sin id_tenant ni phone_number_id: el SQL los descubre por el teléfono del negocio). habilitado = false SIEMPRE. */
export function filaBaseAslc() {
  return Object.freeze({
    tipo: "catalog_sales" as const,
    habilitado: false as const,
    proveedor: "gemini" as const,
    modelo: "gemini-3.6-flash",
    credencial_ref: CREDENCIAL_GEMINI_ASLC,
    nivel_razonamiento: null,
    herramientas: HERRAMIENTAS_ASLC,
    canal: "retail" as const,
    negocio: Object.freeze({ nombre_negocio: DATOS_APROBADOS_ASLC.nombreNegocio }),
    clasificacion_cliente: false as const,
    checkout_conversacional: false as const,
    vocabulario: null,
    checkout_opciones: opcionesBaseAslc(),
    meta_token_plataforma: false as const,
    transcripcion_audio: false as const,
  });
}

// ---------------------------------------------------------------------------
// Qué falta para una configuración completa
// ---------------------------------------------------------------------------

export type CategoriaPendiente = "PATRICIA_REAL_PENDIENTE" | "TEXTO_PENDIENTE" | "COBERTURA_PENDIENTE" | "BLOQUE_PENDIENTE" | "DECISION_PENDIENTE";
export interface Pendiente {
  categoria: CategoriaPendiente;
  /** Ruta dentro de checkout_opciones (p. ej. "cierre.textos.aceptado"). */
  campo: string;
}

/** Bloques que una configuración COMPLETA de ASLC debe traer (cada uno con sus decisiones del negocio). */
const BLOQUES_OBLIGATORIOS = ["campos", "oficina", "cierre", "envios"] as const;

function categoriaDe(ruta: readonly PropertyKey[]): CategoriaPendiente {
  const [a, b, c] = ruta.map(String);
  if (a === "cierre" && b === "responsable") return "PATRICIA_REAL_PENDIENTE";
  if (a === "envios" && b === "cobertura") return "COBERTURA_PENDIENTE";
  if (a === "envios" && b === "tiempos") return "TEXTO_PENDIENTE";
  const ultimo = String(ruta[ruta.length - 1] ?? "");
  if ((a === "cierre" && b === "textos") || (a === "envios" && (b === "textos" || ultimo.startsWith("texto"))) || (a === "handoff" && b === "texto") || (a === "textos" && !!c) || ultimo === "texto" || ultimo.startsWith("texto_")) return "TEXTO_PENDIENTE";
  return "DECISION_PENDIENTE";
}

/**
 * Evalúa una configuración candidata de checkout_opciones: `lista` solo si es válida Y trae los bloques obligatorios; si no, TODO lo que
 * falta, con el mismo esquema del runtime. Los bloques ausentes se evalúan como vacíos para listar cada campo obligatorio que contienen.
 */
export function evaluarConfigCompleta(candidato: Record<string, unknown>): { lista: boolean; opciones: CheckoutOpciones | null; pendientes: Pendiente[] } {
  const pendientes: Pendiente[] = [];
  // El candado de activación debe haberse quitado: una configuración con candado no es una configuración lista.
  if (candidato.activacion_pendiente !== undefined) pendientes.push({ categoria: "DECISION_PENDIENTE", campo: "activacion_pendiente" });
  const ausentes = BLOQUES_OBLIGATORIOS.filter((b) => candidato[b] === undefined);
  for (const b of ausentes) pendientes.push({ categoria: "BLOQUE_PENDIENTE", campo: b });
  // Los bloques que faltan se evalúan vacíos para enumerar sus campos obligatorios (sin inventar ningún valor).
  const entregas = Array.isArray(candidato.entregas) ? (candidato.entregas as string[]) : [];
  const exploracion = {
    ...candidato,
    entregas: entregas.includes("oficina_transportadora") ? entregas : [...entregas, "oficina_transportadora"],
    campos: candidato.campos ?? {},
    oficina: candidato.oficina ?? {},
    cierre: candidato.cierre ?? { modo: "aceptacion_humana" },
    envios: candidato.envios ?? {},
  };
  const r = checkoutOpcionesSchema.safeParse(exploracion);
  if (!r.success) {
    const vistos = new Set<string>(pendientes.map((p) => p.campo));
    for (const issue of r.error.issues) {
      const campo = issue.path.map(String).join(".") || "(raíz)";
      if (vistos.has(campo)) continue;
      vistos.add(campo);
      pendientes.push({ categoria: categoriaDe(issue.path), campo });
    }
  }
  const directa = checkoutOpcionesSchema.safeParse(candidato);
  const lista = ausentes.length === 0 && candidato.activacion_pendiente === undefined && directa.success;
  return { lista, opciones: lista && directa.success ? directa.data : null, pendientes };
}

/**
 * Lo que HOY se puede decir de la configuración completa de ASLC: la base aprobada + las reglas de envío que el negocio ya dio. Lo demás
 * (textos, responsable, cobertura, oficina, decisiones) falta y queda en `pendientes`.
 */
export function candidatoConLoAprobado(): Record<string, unknown> {
  const { activacion_pendiente: _candado, ...base } = opcionesBaseAslc();
  void _candado;
  return {
    ...base,
    envios: {
      sin_certeza: DATOS_APROBADOS_ASLC.sinCerteza,
      ciudad_desconocida_en_checkout: "handoff",
      envio_gratis: DATOS_APROBADOS_ASLC.envioGratis,
      transportadora_habitual: DATOS_APROBADOS_ASLC.transportadoraHabitual,
    },
  };
}

export const pendientesActualesAslc = (): Pendiente[] => evaluarConfigCompleta(candidatoConLoAprobado()).pendientes;

// ---------------------------------------------------------------------------
// SQL de aprovisionamiento (se genera; el dueño lo revisa y lo corre: este código nunca toca una base)
// ---------------------------------------------------------------------------

const sqlTexto = (s: string) => `'${s.replace(/'/g, "''")}'`;
const sqlJson = (v: unknown) => `${sqlTexto(JSON.stringify(v))}::jsonb`;
const sqlArreglo = (xs: readonly string[]) => `array[${xs.map(sqlTexto).join(", ")}]::text[]`;
/**
 * Módulos de ASLC: `catalogo` (panel, API, importación y publicación del catálogo: sin él no se pueden cargar los productos), `pedidos` y
 * `pedidos_por_aceptar` (aceptación humana, 3B.7). NO se habilita `notificaciones_pedidos` (textos sin aprobar; activaría las plantillas de otro negocio).
 */
const MODULOS_ASLC = ["catalogo", "pedidos", "pedidos_por_aceptar"] as const;

export function generarSqlAprovisionamiento(): string {
  const f = filaBaseAslc();
  const whatsappTermina = DATOS_APROBADOS_ASLC.whatsappTerminaEn;
  const { idTenant, phoneNumberId, patronNombre } = IDENTIDAD_ASLC_PRODUCCION;
  // Los tres a la vez (comparados como texto: sin depender del tipo de la columna). NO se usa telefono_negocio (ver IDENTIDAD_ASLC_PRODUCCION).
  const identidad = `id_tenant::text = '${idTenant}' and phone_number_id::text = '${phoneNumberId}' and nombre_negocio ~* '${patronNombre}'`;
  return `-- FASE 3B.9A — APROVISIONAMIENTO DE AQUÍ SÍ LO COMPRAS, SIN ACTIVAR.
-- GENERADO por lib/agente/aprovisionamiento.ts (generarSqlAprovisionamiento): no se edita a mano; una prueba verifica que este archivo es EXACTAMENTE su salida.
--
-- QUÉ HACE (todo en UNA transacción; si cualquier guarda falla, no queda nada):
--   1. Identifica al negocio por su tenant (${idTenant}), su phone_number_id (${phoneNumberId}) Y su nombre: exactamente UNA fila de dulabs_clientes_config.
--      El teléfono que informó el negocio (termina en ${whatsappTermina}) NO se usa para encontrarlo: en la base, el número conectado a Meta figura con otro teléfono.
--   2. Exige que la IA siga PAUSADA (ia_pausada = true). No cambia ia_pausada ni ia_restringida_a.
--   3. Crea la fila del agente DESHABILITADA (habilitado = false): checkout y audio apagados, vocabulario neutral (null), credencial PROPIA
--      (${f.credencial_ref}), solo contra entrega, sin la herramienta confirm_order. Con esta fila el webhook entrega todo mensaje al agente
--      (deshabilitado: silencio) antes de llegar al Flow, al Business Agent o al bot legacy. Si ya existe una fila para ese número, ABORTA (no sobrescribe).
--   4. Habilita los módulos ${MODULOS_ASLC.join(", ")} (solo esos; no toca notificaciones_pedidos).
-- QUÉ NO HACE: no activa la IA, no pone el cierre con aceptación humana, no crea personas, no carga productos, no escribe textos comerciales,
--   no toca ningún otro negocio, no envía nada.
--
-- ANTES: correr 01_verificar_estado_solo_lectura.sql y guardar el resultado (incluye una huella de los módulos de TODOS los negocios).
-- DESPUÉS: correr OTRA VEZ 01_verificar_estado_solo_lectura.sql y comparar: solo debe cambiar la huella de ASLC.
-- Reversa: 04_revertir_aprovisionamiento.sql.

begin;

do $$
declare
  v_tenant uuid;
  v_phone text;
  v_filas integer;
begin
  -- 1) Identidad: UNA sola fila con ese tenant, ese phone_number_id y ese nombre.
  select count(*) into v_filas from public.dulabs_clientes_config where ${identidad};
  if v_filas <> 1 then
    raise exception 'ASLC: se esperaba exactamente UNA fila de dulabs_clientes_config (tenant, phone_number_id y nombre), hay %', v_filas;
  end if;
  select id_tenant, phone_number_id into v_tenant, v_phone from public.dulabs_clientes_config where ${identidad};

  -- 2) Estado seguro: la IA sigue pausada.
  if not exists (select 1 from public.dulabs_clientes_config where phone_number_id = v_phone and ia_pausada is true) then
    raise exception 'ASLC no está pausado (ia_pausada <> true): abortando sin cambios';
  end if;

  -- 3) Credencial propia: ninguna otra fila de agente usa esta variable.
  if exists (select 1 from public.dulabs_agente_runtime_config where credencial_ref = ${sqlTexto(f.credencial_ref)} and phone_number_id <> v_phone) then
    raise exception 'la credencial ${f.credencial_ref} ya la usa OTRO número: abortando';
  end if;

  -- 4) Fila del agente DESHABILITADA. Si ya hay una para este número, no se sobrescribe.
  if exists (select 1 from public.dulabs_agente_runtime_config where phone_number_id = v_phone) then
    raise exception 'ASLC ya tiene una fila en dulabs_agente_runtime_config: revisarla con 01_verificar_estado_solo_lectura.sql (este script no la sobrescribe)';
  end if;
  insert into public.dulabs_agente_runtime_config
    (id_tenant, phone_number_id, tipo, habilitado, proveedor, modelo, credencial_ref, nivel_razonamiento, herramientas, canal, negocio,
     clasificacion_cliente, checkout_conversacional, vocabulario, checkout_opciones, meta_token_plataforma, transcripcion_audio)
  values
    (v_tenant, v_phone, ${sqlTexto(f.tipo)}, false, ${sqlTexto(f.proveedor)}, ${sqlTexto(f.modelo)}, ${sqlTexto(f.credencial_ref)}, null,
     ${sqlArreglo(f.herramientas)}, ${sqlTexto(f.canal)}, ${sqlJson(f.negocio)},
     false, false, null, ${sqlJson(f.checkout_opciones)}, false, false);

  -- 5) Módulos (solo los de la lista: catálogo, pedidos y pedidos por aceptar).
  insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado)
  values ${MODULOS_ASLC.map((m) => `(v_tenant, ${sqlTexto(m)}, true)`).join(", ")}
  on conflict (id_tenant, modulo) do update set habilitado = true, updated_at = now();

  -- 6) Comprobación final dentro de la misma transacción.
  if exists (
    select 1 from public.dulabs_agente_runtime_config
     where phone_number_id = v_phone
       and (habilitado is distinct from false or checkout_conversacional is distinct from false or transcripcion_audio is distinct from false or meta_token_plataforma is distinct from false)
  ) then
    raise exception 'la fila del agente de ASLC no quedó deshabilitada: abortando';
  end if;
  if not exists (select 1 from public.dulabs_clientes_config where phone_number_id = v_phone and ia_pausada is true) then
    raise exception 'ASLC dejó de estar pausado: abortando';
  end if;
end $$;

commit;
`;
}
