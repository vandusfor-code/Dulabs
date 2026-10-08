/**
 * CMS comercial — MIGRACIÓN de los textos comerciales de ARIA (hoy dentro del prompt: `negocio.conocimiento`) al CMS. PURO: genera los scripts SQL y no toca ninguna base.
 *
 * Decisión del dueño (Bloque 29, decisión 5): el CMS publicado pasa a ser la ÚNICA fuente de verdad de lo comercial, pero los textos NO se quitan del prompt de golpe.
 * Se migran por etapas, cada una reversible y con guardas que se niegan a correr fuera de orden:
 *
 *   04  los textos se copian como BORRADORES del CMS (nunca publicados; el mínimo mayorista escrito a mano pasa a la variable {{minimo_mayorista}});
 *       la administradora los revisa y los publica uno a uno desde «Administración de tienda»;
 *   05  se habilitan las herramientas comerciales de ARIA SOLO PARA UN PILOTO de números (negocio.comercial_piloto: el resto de los clientes no cambia; los textos siguen también en
 *       el prompt, para verificar que ARIA responde bien con ambos);
 *   05b se abren a TODOS los clientes (termina el piloto), cuando ya se probó;
 *   06  tema por tema, cuando ya está verificado, se retira el texto del prompt (solo si ese tema está publicado en el CMS y las herramientas están abiertas a todos);
 *   07  una consulta de SOLO LECTURA muestra, tema por tema, dónde está cada texto, cuántas herramientas hay y si siguen en piloto.
 *
 * Los textos reales NO están en el repositorio (público): los scripts los leen de la base en el momento de correr. Aquí solo vive la tabla de correspondencia
 * (nombre del tema → clave, tema, audiencia y orden del CMS). Un tema del prompt que no esté en la tabla no se toca nunca.
 *
 * Una prueba regenera cada script y lo compara con el archivo de supabase/provisioning (no se editan a mano), y los ejecuta de verdad en Postgres embebido.
 */
import { AUDIENCIAS, TEMAS_CONTENIDO, type Audiencia, type TemaContenido } from "@/lib/cms-comercial/contrato";
import { HERRAMIENTAS_COMERCIALES } from "@/lib/agente/nombres-herramientas";

export interface TextoMigrable {
  /** Nombre del tema TAL COMO está en el prompt (`negocio.conocimiento[].tema`); se compara sin mayúsculas, tildes ni espacios de más. */
  legado: string;
  /** Código público estable del contenido en el CMS (minúsculas, números y guiones). */
  clave: string;
  tema: TemaContenido;
  audiencia: Audiencia;
  orden: number;
}

/**
 * Los 22 temas que se migran. Quedan en el prompt, porque son del perfil y no información comercial editable: «Despedida» y «Datos del pedido».
 * Audiencia: lo mayorista nace como «mayorista» (nunca se le muestra a un cliente detal por un descuido); la administradora lo abre a «todos» al revisarlo si el
 * texto solo explica cómo funciona y el mínimo (la regla del negocio: al detal solo información general y el mínimo; jamás precios, ofertas, combos ni enlaces
 * mayoristas). Hoy un cliente detal que menciona lo mayorista pasa a una asesora antes de llegar al modelo, así que esto no cambia lo que ARIA hace.
 */
export const TEXTOS_MIGRABLES: readonly TextoMigrable[] = [
  { legado: "Quiénes somos", clave: "quienes-somos", tema: "general", audiencia: "todos", orden: 10 },
  { legado: "Ubicación", clave: "ubicacion", tema: "ubicacion", audiencia: "todos", orden: 20 },
  { legado: "Horario", clave: "horario", tema: "horarios", audiencia: "todos", orden: 30 },
  { legado: "Líneas y materiales", clave: "lineas-y-materiales", tema: "materiales", audiencia: "todos", orden: 40 },
  { legado: "Dorado y plateado", clave: "dorado-y-plateado", tema: "materiales", audiencia: "todos", orden: 50 },
  { legado: "Colección Vida Eterna", clave: "coleccion-vida-eterna", tema: "general", audiencia: "todos", orden: 60 },
  { legado: "Servicios", clave: "servicios", tema: "general", audiencia: "todos", orden: 70 },
  { legado: "Catálogo", clave: "catalogo", tema: "general", audiencia: "todos", orden: 80 },
  { legado: "Precios y disponibilidad", clave: "precios-y-disponibilidad", tema: "general", audiencia: "todos", orden: 90 },
  { legado: "Regalos", clave: "regalos", tema: "general", audiencia: "todos", orden: 100 },
  { legado: "Hombre y mujer", clave: "hombre-y-mujer", tema: "general", audiencia: "todos", orden: 110 },
  { legado: "Venta al detal", clave: "venta-al-detal", tema: "general", audiencia: "detal", orden: 120 },
  { legado: "Venta al por mayor", clave: "venta-al-por-mayor", tema: "mayoristas", audiencia: "mayorista", orden: 130 },
  { legado: "Emprendimiento", clave: "emprendimiento", tema: "mayoristas", audiencia: "mayorista", orden: 140 },
  { legado: "Separar mercancía", clave: "separar-mercancia", tema: "general", audiencia: "todos", orden: 150 },
  { legado: "Envíos", clave: "envios", tema: "envios", audiencia: "todos", orden: 160 },
  { legado: "Medios de pago", clave: "medios-de-pago", tema: "pagos", audiencia: "todos", orden: 170 },
  { legado: "Pago no identificado", clave: "pago-no-identificado", tema: "pagos", audiencia: "todos", orden: 180 },
  { legado: "Garantías", clave: "garantias", tema: "garantias", audiencia: "todos", orden: 190 },
  { legado: "Cambios y devoluciones", clave: "cambios-y-devoluciones", tema: "cambios", audiencia: "todos", orden: 200 },
  { legado: "Promociones", clave: "promociones", tema: "promociones", audiencia: "todos", orden: 210 },
  { legado: "Reclamos", clave: "reclamos", tema: "general", audiencia: "todos", orden: 220 },
];

/** Del prompt de ARIA, estos dos NO se migran: son de la conversación (cierre y datos que se piden), no información comercial. */
export const TEMAS_QUE_SE_QUEDAN_EN_EL_PERFIL = ["Despedida", "Datos del pedido"] as const;

/**
 * Los temas de los que ARIA responde cifras y condiciones que el cliente puede reclamar (promociones, mayoristas, envíos, pagos, garantías, cambios, horario y
 * ubicación). Mientras alguno exista en el CMS sin publicar, no se habilitan las herramientas: la guarda de ARIA solo cree lo que devuelve una herramienta.
 */
export const CLAVES_CRITICAS = ["promociones", "venta-al-por-mayor", "envios", "medios-de-pago", "garantias", "cambios-y-devoluciones", "horario", "ubicacion"] as const;

export const ETIQUETA_MIGRACION = "Migración del conocimiento de ARIA (DuLabs)";

/** Un número de piloto es un wa_id: solo dígitos, con el indicativo del país y sin cero inicial (57XXXXXXXXXX). Coincide con el esquema de la configuración (negocio.comercial_piloto). */
export const REGEX_PILOTO = "^[1-9][0-9]{7,14}$";
export const MAX_PILOTOS = 20;

const ACENTOS: Readonly<Record<string, string>> = { Á: "A", É: "E", Í: "I", Ó: "O", Ú: "U", Ü: "U", Ñ: "N", á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n" };

/** El nombre de un tema para comparar: sin tildes ni eñes, en minúsculas y con los espacios colapsados. Hace EXACTAMENTE lo mismo que la expresión SQL. */
export function normalizarTema(nombre: string): string {
  return nombre
    .replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, (c) => ACENTOS[c])
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** La expresión SQL equivalente a normalizarTema. */
const norm = (expr: string) => `lower(btrim(regexp_replace(translate(${expr}, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\\s+', ' ', 'g')))`;

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

function titulo(slug: string): string {
  if (slug === "" || !/^[a-z0-9-]+$/.test(slug)) throw new Error("Slug no válido para el script SQL.");
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

const MAPA_SQL = (columnas: "completo" | "legado_clave") =>
  TEXTOS_MIGRABLES.map((t) =>
    columnas === "completo" ? `      (${q(t.legado)}, ${q(t.clave)}, ${q(t.tema)}, ${q(t.audiencia)}, ${t.orden})` : `      (${q(t.legado)}, ${q(t.clave)})`,
  ).join(",\n");

const LISTA_CRITICAS_SQL = CLAVES_CRITICAS.map(q).join(", ");
const LISTA_HERRAMIENTAS_SQL = HERRAMIENTAS_COMERCIALES.map(q).join(", ");
const ARREGLO_HERRAMIENTAS_SQL = `array[${LISTA_HERRAMIENTAS_SQL}]::text[]`;

/** Guardas comunes: migración aplicada, UNA tienda con ese slug, módulo habilitado y UNA configuración de ARIA (deja v_tenant y v_cfg listos). */
const guardas = (slug: string, t: string, opciones: { requiereModulo?: boolean } = {}) => `  -- La migración del CMS y la configuración de ARIA deben existir.
  if to_regclass('public.dulabs_cms_entidades') is null or to_regprocedure('public.dulabs_cms_crear(uuid, text, text, jsonb, uuid, text)') is null then
    raise exception '${t}: falta aplicar la migración 20261210000000_dulabs_cms_comercial.sql';
  end if;
  if to_regclass('public.dulabs_agente_runtime_config') is null then
    raise exception '${t}: no existe la configuración de ARIA (dulabs_agente_runtime_config)';
  end if;

  -- Identidad: UNA sola tienda con ese slug (el negocio sale de la publicación, nunca de un id escrito a mano).
  select count(*) into v_tienda from public.dulabs_catalogo_publicacion where slug = '${slug}';
  if v_tienda <> 1 then
    raise exception '${t}: se esperaba exactamente UNA publicación con slug «${slug}», hay %', v_tienda;
  end if;
  select id_tenant into v_tenant from public.dulabs_catalogo_publicacion where slug = '${slug}';
${
  opciones.requiereModulo === false
    ? ""
    : `
  -- El módulo debe estar habilitado (script 02).
  if not exists (select 1 from public.dulabs_tenant_modulos where id_tenant = v_tenant and modulo = 'cms_comercial' and habilitado) then
    raise exception '${t}: el módulo cms_comercial no está habilitado; corre primero 02_habilitar_cms_comercial.sql';
  end if;
`
}
  -- ARIA: UNA sola configuración del negocio.
  select count(*) into v_filas from public.dulabs_agente_runtime_config where id_tenant = v_tenant and tipo = 'catalog_sales';
  if v_filas <> 1 then
    raise exception '${t}: se esperaba exactamente UNA configuración de ARIA del negocio, hay %', v_filas;
  end if;
  select * into v_cfg from public.dulabs_agente_runtime_config where id_tenant = v_tenant and tipo = 'catalog_sales';`;

const DECLARE_BASE = `  v_tienda integer;
  v_tenant uuid;
  v_filas integer;
  v_cfg record;`;

// ---------------------------------------------------------------------------
// 04 — copiar los textos como borradores
// ---------------------------------------------------------------------------

export function sqlMigrarTextos(slug: string): string {
  const t = titulo(slug);
  return `-- CMS COMERCIAL (Bloque 29) — MIGRAR los textos comerciales de ARIA (${t}) al CMS, como BORRADORES.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico): si cualquier guarda falla, no queda nada.
--
-- ORDEN: DESPUÉS de 02_habilitar_cms_comercial.sql (el módulo debe estar habilitado). Antes, este script se niega.
--
-- QUÉ HACE: lee los textos de ARIA que hoy viven en su prompt (negocio.conocimiento) y crea, por cada uno de los ${TEXTOS_MIGRABLES.length} temas comerciales, un BORRADOR en el CMS
--   (con su tema, audiencia y orden; el mínimo mayorista escrito a mano pasa a la variable {{minimo_mayorista}}). Los borradores NO se publican: la administradora los
--   revisa uno a uno en «Administración de tienda» (Contenido) y publica los que estén bien. «Despedida» y «Datos del pedido» se quedan en el prompt (son de la conversación).
-- QUÉ NO HACE: no publica nada, no toca el prompt ni la configuración de ARIA (ni sus herramientas), no toca productos, precios, pedidos ni otros negocios. Un tema que no esté
--   en la tabla de este script no se migra nunca. NO pisa: si un borrador (o contenido) con esa clave ya existe —lo editó o publicó la administradora—, se salta.
--   Hasta que se habiliten las herramientas (script 05), ARIA sigue respondiendo con el prompt de siempre: nada cambia para los clientes.
-- Se puede repetir sin efectos nuevos.
--
-- GENERADO por el código (lib/cms-comercial/migracion-textos.ts): una prueba lo regenera y lo compara con este archivo. No se edita a mano.
--
-- REVERSA: supabase/provisioning/${slug}/04_migrar_textos_a_borradores.reversa.sql (archiva los borradores que nadie ha tocado).

do $$
declare
${DECLARE_BASE}
  v_conocimiento jsonb;
  v_minimo bigint;
  v_patron text;
  v_m record;
  v_item jsonb;
  v_texto text;
  v_r jsonb;
  v_creados integer := 0;
  v_existentes integer := 0;
  v_ausentes text := '';
  v_quedan text;
begin
${guardas(slug, t)}
  v_conocimiento := v_cfg.negocio->'conocimiento';
  if v_conocimiento is null or jsonb_typeof(v_conocimiento) <> 'array' or jsonb_array_length(v_conocimiento) = 0 then
    raise notice '${t}: el prompt de ARIA no tiene textos de conocimiento; no hay nada que migrar';
    return;
  end if;

  -- El mínimo mayorista configurado: si un texto lo trae escrito a mano ($750.000 o 750000), se reemplaza por la variable (el CMS no deja publicar un monto a mano).
  v_minimo := case when jsonb_typeof(v_cfg.negocio->'pedido'->'minimo_mayorista') = 'number' and (v_cfg.negocio->'pedido'->>'minimo_mayorista') ~ '^[0-9]+$' then (v_cfg.negocio->'pedido'->>'minimo_mayorista')::bigint end;
  if v_minimo is not null and v_minimo > 0 then
    v_patron := '(?:\\$\\s?)?(?<![\\d.,])(?:' || replace(to_char(v_minimo, 'FM999,999,999,999,999'), ',', '\\.') || '|' || v_minimo::text || ')(?!\\d|[.,]\\d)';
  end if;

  for v_m in
    select * from (values
${MAPA_SQL("completo")}
    ) as m(legado, clave, tema, audiencia, orden)
    order by m.orden
  loop
    select t.k into v_item
      from jsonb_array_elements(v_conocimiento) as t(k)
     where ${norm("t.k->>'tema'")} = ${norm("v_m.legado")}
     limit 1;
    if v_item is null then
      v_ausentes := v_ausentes || ' · ' || v_m.legado;
      continue;
    end if;

    v_texto := v_item->>'info';
    if v_texto is null or btrim(v_texto) = '' then
      v_ausentes := v_ausentes || ' · ' || v_m.legado || ' (vacío)';
      continue;
    end if;
    if v_patron is not null then
      v_texto := regexp_replace(v_texto, v_patron, '{{minimo_mayorista}}', 'g');
    end if;

    v_r := public.dulabs_cms_crear(
      v_tenant, 'contenido', v_m.clave,
      jsonb_build_object('tema', v_m.tema, 'audiencia', v_m.audiencia, 'titulo', regexp_replace(btrim(v_item->>'tema'), '\\s+', ' ', 'g'), 'texto', v_texto, 'palabras_clave', '[]'::jsonb, 'orden', v_m.orden),
      null, ${q(ETIQUETA_MIGRACION)});
    if v_r->>'resultado' = 'ok' then
      v_creados := v_creados + 1;
    elsif v_r->>'resultado' = 'clave_existente' then
      v_existentes := v_existentes + 1;
    else
      raise exception '${t}: no se pudo crear el borrador «%» (%)', v_m.clave, v_r->>'resultado';
    end if;
  end loop;

  select string_agg(btrim(t.k->>'tema'), ' · ') into v_quedan
    from jsonb_array_elements(v_conocimiento) as t(k)
   where not exists (select 1 from (values
${MAPA_SQL("legado_clave")}
    ) as m(legado, clave) where ${norm("m.legado")} = ${norm("t.k->>'tema'")});

  raise notice '${t}: % borradores creados, % ya existían', v_creados, v_existentes;
  if v_ausentes <> '' then raise notice '${t}: temas de la tabla que no están en el prompt (o están vacíos):%', v_ausentes; end if;
  if v_quedan is not null then raise notice '${t}: temas que se quedan en el prompt (no se migran): %', v_quedan; end if;
end $$;
`;
}

export function sqlReversaMigrarTextos(slug: string): string {
  const t = titulo(slug);
  return `-- CMS COMERCIAL (Bloque 29) — REVERSA de 04_migrar_textos_a_borradores.sql para ${t}.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico).
--
-- QUÉ HACE: ARCHIVA los borradores que creó la migración y que NADIE ha tocado (siguen en su primera revisión, sin publicar y sin usuario). El prompt de ARIA no se
--   modificó nunca, así que no hay nada más que deshacer. Archivar no borra: el historial queda y, desde «Administración de tienda», se puede desarchivar.
-- NO TOCA: lo que la administradora ya editó, publicó o pausó (se deja tal cual y se avisa), ni nada de otros negocios.
-- Se puede repetir sin efectos nuevos.

do $$
declare
  v_tenant uuid;
  v_e record;
  v_m record;
  v_r jsonb;
  v_archivados integer := 0;
  v_respetados text := '';
begin
  if to_regclass('public.dulabs_cms_entidades') is null then
    raise exception '${t}: el CMS comercial no está instalado; no hay nada que revertir';
  end if;
  select id_tenant into v_tenant from public.dulabs_catalogo_publicacion where slug = '${slug}';
  if v_tenant is null then
    raise exception '${t}: no existe una publicación con slug «${slug}»';
  end if;

  for v_m in
    select * from (values
${MAPA_SQL("legado_clave")}
    ) as m(legado, clave)
  loop
    select * into v_e from public.dulabs_cms_entidades where id_tenant = v_tenant and tipo = 'contenido' and clave = v_m.clave;
    if v_e.id is null or v_e.archivada_at is not null then continue; end if;
    if v_e.estado = 'borrador' and v_e.rev = 1 and v_e.created_by is null then
      v_r := public.dulabs_cms_archivar(v_tenant, v_e.id, null, 'Reversa de la migración del conocimiento de ARIA (DuLabs)');
      if v_r->>'resultado' is distinct from 'ok' then
        raise exception '${t}: no se pudo archivar «%» (%)', v_m.clave, v_r->>'resultado';
      end if;
      v_archivados := v_archivados + 1;
    else
      v_respetados := v_respetados || ' · ' || v_m.clave;
    end if;
  end loop;

  raise notice '${t}: % borradores archivados', v_archivados;
  if v_respetados <> '' then raise notice '${t}: no se tocan (ya los editó, publicó o pausó la administradora):%', v_respetados; end if;
end $$;
`;
}

// ---------------------------------------------------------------------------
// 05 — habilitar las herramientas comerciales de ARIA
// ---------------------------------------------------------------------------

export function sqlHabilitarHerramientas(slug: string): string {
  const t = titulo(slug);
  return `-- CMS COMERCIAL (Bloque 29) — HABILITAR las herramientas comerciales de ARIA (${t}) SOLO PARA UN PILOTO de números.
-- Corre en el SQL Editor de Supabase en DOS pasos de la misma sesión: primero indicas tu número de piloto, luego el bloque DO (atómico: si cualquier guarda falla, no queda nada).
--
--       set dulabs.piloto_comercial = '57XXXXXXXXXX';      -- uno o varios números, separados por coma: SOLO dígitos con el indicativo del país (57 + el celular)
--       <este script>
--
-- ORDEN: DESPUÉS de fusionar y DESPLEGAR el código del piloto (PR 6, piloto por número): el código anterior no conoce el piloto y, si corres este script antes, la configuración de ARIA quedaría
--   inválida para él (ARIA dejaría de responder hasta que corras la reversa). También DESPUÉS de 04_migrar_textos_a_borradores.sql y de que la administradora PUBLIQUE los textos (sin eso, este script se niega).
--
-- QUÉ HACE: agrega a la lista de herramientas de ARIA las cuatro de lectura del CMS (${HERRAMIENTAS_COMERCIALES.join(", ")}) y guarda el PILOTO en negocio.comercial_piloto:
--   SOLO los números indicados reciben las herramientas, la guarda anti-invención y la sección «información comercial» del prompt; TODOS los demás clientes siguen conversando
--   EXACTAMENTE como hoy (sin herramientas, sin guarda y con el prompt de siempre). Los textos siguen también en el prompt hasta que los retires con 06.
--   Con las herramientas, ARIA consulta lo publicado (ofertas, combos, campañas y textos del negocio) y la guarda deja de dejar pasar una promoción, un descuento, una vigencia,
--   un combo o una política que el sistema no respalde (una corrección y, si insiste, una asesora).
-- PARA ABRIRLAS A TODOS los clientes, DESPUÉS de probar con tu número: 05b_abrir_herramientas_comerciales_a_todos.sql. Para CAMBIAR los números del piloto: corre este script otra vez con los números nuevos.
--   Si ya las abriste a todos y quieres VOLVER al piloto: primero la reversa (05_habilitar_herramientas_comerciales.reversa.sql, que protege los temas ya retirados del prompt) y luego este script.
-- QUÉ NO HACE: no abre al público por sí solo (sin números de piloto, se niega); no cambia el prompt, el modelo, el checkout ni las demás herramientas; no toca otros negocios.
-- GUARDAS (se niega si no se cumplen): el módulo está habilitado; las herramientas no están ya abiertas a todos los clientes; cada número es válido (solo dígitos con el indicativo; hasta ${MAX_PILOTOS}); hay al menos UN texto comercial publicado
--   y vigente; ninguno de los temas críticos (${CLAVES_CRITICAS.join(", ")}) está en el CMS sin publicar. Si un tema crítico quedó a propósito sin publicar, confírmalo en
--   la misma sesión:
--       set dulabs.permitir_temas_sin_publicar = 'si';
--   (ARIA no podrá afirmar nada de ese tema: pasará a una asesora.)
-- Se puede repetir sin efectos nuevos.
--
-- GENERADO por el código (lib/cms-comercial/migracion-textos.ts): una prueba lo regenera y lo compara con este archivo. No se edita a mano.
--
-- REVERSA: supabase/provisioning/${slug}/05_habilitar_herramientas_comerciales.reversa.sql

do $$
declare
${DECLARE_BASE}
  v_publicados integer;
  v_sin_publicar text;
  v_nuevas text[];
  v_piloto_txt text;
  v_numeros text[];
  v_n text;
begin
${guardas(slug, t)}

  -- Ya abiertas a todos (herramientas sin piloto): volver a un piloto se hace desde la reversa, que protege los temas que ya se retiraron del prompt (si no, los demás clientes se quedarían sin ellos).
  if v_cfg.herramientas @> ${ARREGLO_HERRAMIENTAS_SQL} and (v_cfg.negocio->'comercial_piloto') is null then
    raise exception '${t}: las herramientas comerciales ya están ABIERTAS a todos los clientes; este script solo las deja en piloto. Para volver a un piloto, primero corre 05_habilitar_herramientas_comerciales.reversa.sql (que protege los temas ya retirados del prompt) y luego este script con tu número';
  end if;

  -- Piloto: SIN números no se habilita nada (este script nunca abre al público por sí solo).
  v_piloto_txt := regexp_replace(coalesce(current_setting('dulabs.piloto_comercial', true), ''), '[\\s+()-]', '', 'g');
  if v_piloto_txt = '' then
    raise exception '${t}: indica el número (o los números) de piloto en la misma sesión, por ejemplo: set dulabs.piloto_comercial = ''57XXXXXXXXXX''; (las herramientas solo se habilitan para esos números; para abrirlas a todos, después de probar, está el script 05b)';
  end if;
  v_numeros := string_to_array(v_piloto_txt, ',');
  foreach v_n in array v_numeros loop
    if v_n ~ '^3[0-9]{9}$' then
      raise exception '${t}: «%» parece un celular colombiano SIN el indicativo del país: escribe 57 + el número (por ejemplo 57XXXXXXXXXX)', v_n;
    end if;
    if v_n !~ '${REGEX_PILOTO}' then
      raise exception '${t}: «%» no es un número válido: solo dígitos con el indicativo del país, sin ceros iniciales ni signos (por ejemplo 57XXXXXXXXXX)', v_n;
    end if;
  end loop;
  select array_agg(distinct u.n order by u.n) into v_numeros from unnest(v_numeros) as u(n);
  if cardinality(v_numeros) > ${MAX_PILOTOS} then
    raise exception '${t}: el piloto admite hasta ${MAX_PILOTOS} números';
  end if;

  select count(*) into v_publicados
    from public.dulabs_cms_entidades
   where id_tenant = v_tenant and tipo = 'contenido' and estado = 'publicada' and archivada_at is null;
  if v_publicados = 0 then
    raise exception '${t}: todavía no hay ningún texto comercial publicado en el CMS; publica los textos (Administración de tienda → Contenido) antes de habilitar las herramientas';
  end if;

  select string_agg(e.clave, ' · ' order by e.clave) into v_sin_publicar
    from public.dulabs_cms_entidades e
   where e.id_tenant = v_tenant and e.tipo = 'contenido' and e.archivada_at is null and e.estado <> 'publicada' and e.clave in (${LISTA_CRITICAS_SQL});
  if v_sin_publicar is not null and coalesce(current_setting('dulabs.permitir_temas_sin_publicar', true), '') <> 'si' then
    raise exception '${t}: estos temas críticos siguen sin publicar: %. Publícalos (o archívalos) antes de habilitar las herramientas; para seguir sin ellos: set dulabs.permitir_temas_sin_publicar = ''si'';', v_sin_publicar;
  end if;

  -- Solo se agregan las que faltan, al final y en su orden (las demás herramientas no se tocan).
  select array_agg(h order by o) into v_nuevas
    from unnest(${ARREGLO_HERRAMIENTAS_SQL}) with ordinality as x(h, o)
   where not (h = any (v_cfg.herramientas));
  if v_nuevas is null and (v_cfg.negocio->'comercial_piloto') is not distinct from to_jsonb(v_numeros) then
    raise notice '${t}: las herramientas comerciales ya estaban habilitadas para ese piloto';
    return;
  end if;
  if v_nuevas is not null and cardinality(v_cfg.herramientas) + cardinality(v_nuevas) > 30 then
    raise exception '${t}: la lista de herramientas superaría el máximo permitido (30)';
  end if;

  update public.dulabs_agente_runtime_config
     set herramientas = case when v_nuevas is null then herramientas else herramientas || v_nuevas end,
         negocio = jsonb_set(negocio, '{comercial_piloto}', to_jsonb(v_numeros), true),
         updated_at = now()
   where id = v_cfg.id;

  raise notice '${t}: herramientas comerciales habilitadas SOLO para el piloto (% número(s)); los demás clientes no cambian', cardinality(v_numeros);
end $$;
`;
}

export function sqlAbrirHerramientasATodos(slug: string): string {
  const t = titulo(slug);
  return `-- CMS COMERCIAL (Bloque 29) — ABRIR a TODOS los clientes las herramientas comerciales de ARIA (${t}): termina el piloto.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico: si cualquier guarda falla, no queda nada).
--
-- ORDEN: DESPUÉS de 05_habilitar_herramientas_comerciales.sql y de PROBAR con tu número de piloto que ARIA responde bien. Antes, este script se niega.
--
-- QUÉ HACE: quita negocio.comercial_piloto. Desde ese momento TODOS los clientes del número reciben las herramientas comerciales, la guarda anti-invención y la sección
--   «información comercial» del prompt (hasta hoy, solo los números del piloto).
-- GUARDAS (se niega si no se cumplen): las herramientas no están habilitadas (primero el 05); no hay ningún texto comercial publicado; algún tema crítico
--   (${CLAVES_CRITICAS.join(", ")}) está en el CMS sin publicar (se puede confirmar con: set dulabs.permitir_temas_sin_publicar = 'si';). Si ya están abiertas a todos, no hace nada.
-- QUÉ NO HACE: no cambia el prompt, las herramientas, el modelo ni otros negocios.
--
-- GENERADO por el código (lib/cms-comercial/migracion-textos.ts): una prueba lo regenera y lo compara con este archivo. No se edita a mano.
--
-- REVERSA (volver al piloto): corre 05_habilitar_herramientas_comerciales.reversa.sql (quita las herramientas y el piloto; se niega si ya retiraste temas críticos del prompt) y luego 05_habilitar_herramientas_comerciales.sql con tu número.

do $$
declare
${DECLARE_BASE}
  v_publicados integer;
  v_sin_publicar text;
begin
${guardas(slug, t)}

  if not (v_cfg.herramientas @> ${ARREGLO_HERRAMIENTAS_SQL}) then
    raise exception '${t}: las herramientas comerciales de ARIA no están habilitadas; corre primero 05_habilitar_herramientas_comerciales.sql (piloto)';
  end if;
  if (v_cfg.negocio->'comercial_piloto') is null then
    raise notice '${t}: las herramientas comerciales ya están abiertas a todos los clientes; no hay nada que hacer';
    return;
  end if;

  select count(*) into v_publicados
    from public.dulabs_cms_entidades
   where id_tenant = v_tenant and tipo = 'contenido' and estado = 'publicada' and archivada_at is null;
  if v_publicados = 0 then
    raise exception '${t}: no hay ningún texto comercial publicado en el CMS; no se abren las herramientas a todos los clientes';
  end if;

  select string_agg(e.clave, ' · ' order by e.clave) into v_sin_publicar
    from public.dulabs_cms_entidades e
   where e.id_tenant = v_tenant and e.tipo = 'contenido' and e.archivada_at is null and e.estado <> 'publicada' and e.clave in (${LISTA_CRITICAS_SQL});
  if v_sin_publicar is not null and coalesce(current_setting('dulabs.permitir_temas_sin_publicar', true), '') <> 'si' then
    raise exception '${t}: estos temas críticos siguen sin publicar: %. Publícalos (o archívalos) antes de abrir las herramientas a todos; para seguir sin ellos: set dulabs.permitir_temas_sin_publicar = ''si'';', v_sin_publicar;
  end if;

  update public.dulabs_agente_runtime_config
     set negocio = negocio - 'comercial_piloto', updated_at = now()
   where id = v_cfg.id;

  raise notice '${t}: herramientas comerciales ABIERTAS a todos los clientes (ya no hay piloto)';
end $$;
`;
}

export function sqlReversaHabilitarHerramientas(slug: string): string {
  const t = titulo(slug);
  return `-- CMS COMERCIAL (Bloque 29) — REVERSA de 05_habilitar_herramientas_comerciales.sql para ${t}.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico).
--
-- QUÉ HACE: quita de la lista de herramientas de ARIA las cuatro del CMS y el piloto (negocio.comercial_piloto): ARIA y su guarda vuelven a ser exactamente los de antes del script 05
--   para TODOS los clientes. Lo publicado en el CMS queda guardado y sin efecto sobre ARIA.
-- SE NIEGA si algún tema crítico (${CLAVES_CRITICAS.join(", ")}) ya se RETIRÓ del prompt (está publicado en el CMS pero ya no en el prompt): sin las herramientas, ARIA quedaría sin esa
--   información. Primero restaura esos temas con 06_retirar_textos_del_prompt.reversa.sql; para apagar de todos modos, confirma en la misma sesión:
--       set dulabs.confirmar_reversa_herramientas = 'si';
-- Se puede repetir sin efectos nuevos.

do $$
declare
${DECLARE_BASE}
  v_retirados text;
begin
${guardas(slug, t, { requiereModulo: false })}

  select string_agg(m.clave, ' · ' order by m.clave) into v_retirados
    from (values
${MAPA_SQL("legado_clave")}
    ) as m(legado, clave)
    join public.dulabs_cms_entidades e on e.id_tenant = v_tenant and e.tipo = 'contenido' and e.clave = m.clave and e.estado = 'publicada' and e.archivada_at is null
   where m.clave in (${LISTA_CRITICAS_SQL})
     and not exists (select 1 from jsonb_array_elements(coalesce(v_cfg.negocio->'conocimiento', '[]'::jsonb)) as t(k) where ${norm("t.k->>'tema'")} = ${norm("m.legado")});
  if v_retirados is not null and coalesce(current_setting('dulabs.confirmar_reversa_herramientas', true), '') <> 'si' then
    raise exception '${t}: estos temas ya no están en el prompt y solo viven en el CMS: %. Sin las herramientas, ARIA no los sabría. Restáuralos con 06_retirar_textos_del_prompt.reversa.sql o confirma con: set dulabs.confirmar_reversa_herramientas = ''si'';', v_retirados;
  end if;

  update public.dulabs_agente_runtime_config
     set herramientas = array(select h from unnest(herramientas) with ordinality as x(h, o) where not (h = any (${ARREGLO_HERRAMIENTAS_SQL})) order by o),
         negocio = negocio - 'comercial_piloto',
         updated_at = now()
   where id = v_cfg.id and (herramientas && ${ARREGLO_HERRAMIENTAS_SQL} or (negocio->'comercial_piloto') is not null);

  raise notice '${t}: herramientas comerciales (y piloto) retiradas de ARIA';
end $$;
`;
}

// ---------------------------------------------------------------------------
// 06 — retirar los textos del prompt, tema por tema
// ---------------------------------------------------------------------------

export function sqlRetirarDelPrompt(slug: string): string {
  const t = titulo(slug);
  return `-- CMS COMERCIAL (Bloque 29) — RETIRAR del prompt de ARIA (${t}) los textos que ya viven publicados en el CMS, TEMA POR TEMA.
-- Corre en el SQL Editor de Supabase en DOS pasos de la misma sesión: primero indicas los temas, luego el bloque DO (atómico).
--
--       set dulabs.retirar_temas = 'promociones,envios';      -- las claves a retirar, separadas por coma (la lista completa está abajo)
--       <este script>
--
-- ORDEN: DESPUÉS de 05_habilitar_herramientas_comerciales.sql, de VERIFICAR con conversaciones reales que ARIA responde bien con las herramientas y de ABRIRLAS a todos los clientes
--   con 05b_abrir_herramientas_comerciales_a_todos.sql (mientras estén en piloto este script se niega). Se retira de a pocos temas.
--
-- QUÉ HACE: quita del prompt de ARIA (negocio.conocimiento) los textos de los temas indicados. Desde ese momento la ÚNICA fuente de esos textos es el CMS publicado.
-- GUARDAS (se niega si no se cumplen): sin temas indicados; una clave que no está en la tabla; las cuatro herramientas comerciales no están habilitadas o siguen en piloto; el tema no está PUBLICADO en
--   el CMS (publicado y no archivado). No toca nada más del prompt (personalidad, tono, políticas, «Despedida», «Datos del pedido»…), ni la configuración, ni otros negocios.
-- Se puede repetir sin efectos nuevos (un tema que ya no está, se salta).
-- Claves: ${TEXTOS_MIGRABLES.map((x) => x.clave).join(", ")}.
--
-- GENERADO por el código (lib/cms-comercial/migracion-textos.ts): una prueba lo regenera y lo compara con este archivo. No se edita a mano.
--
-- REVERSA: supabase/provisioning/${slug}/06_retirar_textos_del_prompt.reversa.sql (devuelve al prompt el texto PUBLICADO hoy en el CMS).

do $$
declare
${DECLARE_BASE}
  v_lista text;
  v_claves text[];
  v_clave text;
  v_legado text;
  v_ent record;
  v_conocimiento jsonb;
  v_nuevo jsonb;
  v_retirados integer := 0;
begin
${guardas(slug, t)}

  -- Las herramientas comerciales deben estar habilitadas: si no, quitar el texto del prompt dejaría a ARIA sin esa información.
  if not (v_cfg.herramientas @> ${ARREGLO_HERRAMIENTAS_SQL}) then
    raise exception '${t}: las herramientas comerciales de ARIA no están habilitadas; corre primero 05_habilitar_herramientas_comerciales.sql';
  end if;
  -- Con el piloto solo algunos clientes tienen las herramientas: retirar los textos del prompt dejaría a los demás sin esa información.
  if (v_cfg.negocio->'comercial_piloto') is not null then
    raise exception '${t}: las herramientas comerciales están en PILOTO (solo algunos números): los demás clientes se quedarían sin esa información; ábrelas a todos con 05b_abrir_herramientas_comerciales_a_todos.sql antes de retirar textos del prompt';
  end if;

  v_lista := btrim(coalesce(current_setting('dulabs.retirar_temas', true), ''));
  if v_lista = '' then
    raise exception '${t}: indica los temas a retirar en la misma sesión, por ejemplo: set dulabs.retirar_temas = ''promociones,envios'';';
  end if;
  v_claves := string_to_array(regexp_replace(v_lista, '\\s+', '', 'g'), ',');

  v_conocimiento := coalesce(v_cfg.negocio->'conocimiento', '[]'::jsonb);
  if jsonb_typeof(v_conocimiento) <> 'array' then
    raise exception '${t}: el conocimiento de ARIA no tiene el formato esperado';
  end if;

  foreach v_clave in array v_claves loop
    if v_clave = '' then continue; end if;
    select m.legado into v_legado from (values
${MAPA_SQL("legado_clave")}
    ) as m(legado, clave) where m.clave = v_clave;
    if v_legado is null then
      raise exception '${t}: «%» no es un tema de la tabla de migración', v_clave;
    end if;

    select * into v_ent from public.dulabs_cms_entidades where id_tenant = v_tenant and tipo = 'contenido' and clave = v_clave;
    if v_ent.id is null or v_ent.estado <> 'publicada' or v_ent.archivada_at is not null then
      raise exception '${t}: el tema «%» no está publicado en el CMS; publícalo antes de retirarlo del prompt', v_clave;
    end if;

    select coalesce(jsonb_agg(t.k order by t.o), '[]'::jsonb) into v_nuevo
      from jsonb_array_elements(v_conocimiento) with ordinality as t(k, o)
     where ${norm("t.k->>'tema'")} is distinct from ${norm("v_legado")};
    if jsonb_array_length(v_nuevo) < jsonb_array_length(v_conocimiento) then
      v_retirados := v_retirados + 1;
    end if;
    v_conocimiento := v_nuevo;
  end loop;

  update public.dulabs_agente_runtime_config
     set negocio = jsonb_set(negocio, '{conocimiento}', v_conocimiento, true), updated_at = now()
   where id = v_cfg.id;

  raise notice '${t}: % temas retirados del prompt; quedan % textos en el prompt', v_retirados, jsonb_array_length(v_conocimiento);
end $$;
`;
}

export function sqlReversaRetirarDelPrompt(slug: string): string {
  const t = titulo(slug);
  return `-- CMS COMERCIAL (Bloque 29) — REVERSA de 06_retirar_textos_del_prompt.sql para ${t}.
-- Corre en el SQL Editor de Supabase en DOS pasos de la misma sesión: primero indicas los temas, luego el bloque DO (atómico).
--
--       set dulabs.restaurar_temas = 'promociones,envios';
--       <este script>
--
-- QUÉ HACE: devuelve al prompt de ARIA (negocio.conocimiento) el texto PUBLICADO HOY en el CMS de cada tema indicado, con sus variables ya reemplazadas ({{minimo_mayorista}} →
--   «$750.000», etc.), con el nombre de tema de siempre y al final de la lista. Un tema que ya está en el prompt se salta.
-- SE NIEGA si el tema no está publicado, si una variable no tiene valor configurado, si el texto supera los 800 caracteres que admite el prompt, o si el prompt pasaría de 40 temas.
-- Se puede repetir sin efectos nuevos.

do $$
declare
${DECLARE_BASE}
  v_lista text;
  v_claves text[];
  v_clave text;
  v_legado text;
  v_ent record;
  v_conocimiento jsonb;
  v_texto text;
  v_minimo text;
  v_restaurados integer := 0;
begin
${guardas(slug, t, { requiereModulo: false })}

  v_lista := btrim(coalesce(current_setting('dulabs.restaurar_temas', true), ''));
  if v_lista = '' then
    raise exception '${t}: indica los temas a restaurar en la misma sesión, por ejemplo: set dulabs.restaurar_temas = ''promociones,envios'';';
  end if;
  v_claves := string_to_array(regexp_replace(v_lista, '\\s+', '', 'g'), ',');

  v_conocimiento := coalesce(v_cfg.negocio->'conocimiento', '[]'::jsonb);
  if jsonb_typeof(v_conocimiento) <> 'array' then
    raise exception '${t}: el conocimiento de ARIA no tiene el formato esperado';
  end if;
  v_minimo := case when jsonb_typeof(v_cfg.negocio->'pedido'->'minimo_mayorista') = 'number' and (v_cfg.negocio->'pedido'->>'minimo_mayorista') ~ '^[0-9]+$'
                   then '$' || replace(to_char((v_cfg.negocio->'pedido'->>'minimo_mayorista')::bigint, 'FM999,999,999,999,999'), ',', '.') end;

  foreach v_clave in array v_claves loop
    if v_clave = '' then continue; end if;
    select m.legado into v_legado from (values
${MAPA_SQL("legado_clave")}
    ) as m(legado, clave) where m.clave = v_clave;
    if v_legado is null then
      raise exception '${t}: «%» no es un tema de la tabla de migración', v_clave;
    end if;
    if exists (select 1 from jsonb_array_elements(v_conocimiento) as t(k) where ${norm("t.k->>'tema'")} = ${norm("v_legado")}) then
      continue;
    end if;

    select * into v_ent from public.dulabs_cms_entidades where id_tenant = v_tenant and tipo = 'contenido' and clave = v_clave;
    if v_ent.id is null or v_ent.estado <> 'publicada' or v_ent.archivada_at is not null then
      raise exception '${t}: el tema «%» no está publicado en el CMS; no hay texto que restaurar', v_clave;
    end if;
    v_texto := public.dulabs_cms_contenido_activo(v_tenant, v_ent.id)->>'texto';

    -- Variables (lista cerrada): si alguna no tiene valor, el texto no se restaura a medias.
    if v_texto like '%{{minimo_mayorista}}%' then
      if v_minimo is null then raise exception '${t}: «%» usa {{minimo_mayorista}} y el mínimo no está configurado', v_clave; end if;
      v_texto := replace(v_texto, '{{minimo_mayorista}}', v_minimo);
    end if;
    if v_texto like '%{{direccion_tienda}}%' then
      if coalesce(btrim(v_cfg.negocio->'pedido'->>'direccion_tienda'), '') = '' then raise exception '${t}: «%» usa {{direccion_tienda}} y la dirección no está configurada', v_clave; end if;
      v_texto := replace(v_texto, '{{direccion_tienda}}', btrim(v_cfg.negocio->'pedido'->>'direccion_tienda'));
    end if;
    if v_texto like '%{{nombre_negocio}}%' then
      if coalesce(btrim(v_cfg.negocio->>'nombre_negocio'), '') = '' then raise exception '${t}: «%» usa {{nombre_negocio}} y el nombre no está configurado', v_clave; end if;
      v_texto := replace(v_texto, '{{nombre_negocio}}', btrim(v_cfg.negocio->>'nombre_negocio'));
    end if;
    if v_texto ~ '\\{\\{' then
      raise exception '${t}: «%» tiene una variable desconocida; no se restaura', v_clave;
    end if;
    if char_length(v_texto) > 800 then
      raise exception '${t}: el texto de «%» tiene % caracteres y el prompt admite hasta 800; no se restaura', v_clave, char_length(v_texto);
    end if;
    if jsonb_array_length(v_conocimiento) >= 40 then
      raise exception '${t}: el prompt de ARIA ya tiene 40 temas (el máximo)';
    end if;

    v_conocimiento := v_conocimiento || jsonb_build_array(jsonb_build_object('tema', v_legado, 'info', v_texto));
    v_restaurados := v_restaurados + 1;
  end loop;

  update public.dulabs_agente_runtime_config
     set negocio = jsonb_set(negocio, '{conocimiento}', v_conocimiento, true), updated_at = now()
   where id = v_cfg.id;

  raise notice '${t}: % temas restaurados en el prompt', v_restaurados;
end $$;
`;
}

// ---------------------------------------------------------------------------
// 07 — estado de la migración (solo lectura)
// ---------------------------------------------------------------------------

export function sqlEstadoMigracion(slug: string): string {
  const t = titulo(slug);
  return `-- CMS COMERCIAL (Bloque 29) — ESTADO de la migración de los textos de ARIA (${t}), SOLO LECTURA. No cambia nada.
-- Corre en el SQL Editor de Supabase (una sentencia). Sirve ANTES y DESPUÉS de cada paso (04, 05, 06).
--
-- Una fila por tema de la tabla de migración (más las del perfil y una de herramientas):
--   en_el_prompt  si el texto sigue dentro del prompt de ARIA (negocio.conocimiento)
--   en_el_cms     no migrado · borrador · publicada · pausada · archivada   (publicada = ARIA lo consulta con las herramientas)
--   version       versión publicada (si hay)
--   fuente        prompt (solo en el prompt) · prompt+cms (en ambos: la etapa de verificación) · cms (solo en el CMS publicado) · sin texto
-- Las dos últimas filas dicen cuántas de las 4 herramientas comerciales están habilitadas para ARIA y si siguen en PILOTO (solo ciertos números, con sus últimos 4 dígitos) o ya están
--   abiertas a TODOS los clientes.
-- Si el CMS no está instalado, esta consulta falla con «relation does not exist»: es la respuesta.
--
-- GENERADO por el código (lib/cms-comercial/migracion-textos.ts): una prueba lo regenera y lo compara con este archivo. No se edita a mano.

with tienda as (
  select id_tenant from public.dulabs_catalogo_publicacion where slug = '${slug}'
),
aria as (
  select negocio, herramientas from public.dulabs_agente_runtime_config
   where id_tenant = (select id_tenant from tienda limit 1) and tipo = 'catalog_sales'
),
en_prompt as (
  select ${norm("t.k->>'tema'")} as n
    from aria, jsonb_array_elements(case when jsonb_typeof(aria.negocio->'conocimiento') = 'array' then aria.negocio->'conocimiento' else '[]'::jsonb end) as t(k)
),
cms as (
  select clave, estado, version_activa, archivada_at from public.dulabs_cms_entidades
   where id_tenant = (select id_tenant from tienda limit 1) and tipo = 'contenido'
),
mapa as (
  select * from (values
${TEXTOS_MIGRABLES.map((x) => `    (${q(x.legado)}, ${q(x.clave)}, ${x.orden})`).join(",\n")}
  ) as m(legado, clave, orden)
),
perfil as (
  select * from (values
${TEMAS_QUE_SE_QUEDAN_EN_EL_PERFIL.map((x, i) => `    (${q(x)}, ${1000 + i})`).join(",\n")}
  ) as p(legado, orden)
)
select m.orden, m.legado as tema, m.clave,
       exists (select 1 from en_prompt p where p.n = ${norm("m.legado")}) as en_el_prompt,
       case when c.clave is null then 'no migrado' when c.archivada_at is not null then 'archivada' else c.estado end as en_el_cms,
       c.version_activa as version,
       case
         when exists (select 1 from en_prompt p where p.n = ${norm("m.legado")}) and c.estado = 'publicada' and c.archivada_at is null then 'prompt+cms'
         when exists (select 1 from en_prompt p where p.n = ${norm("m.legado")}) then 'prompt'
         when c.estado = 'publicada' and c.archivada_at is null then 'cms'
         else 'sin texto'
       end as fuente
  from mapa m left join cms c on c.clave = m.clave
union all
select p.orden, p.legado, null, exists (select 1 from en_prompt e where e.n = ${norm("p.legado")}), 'se queda en el perfil', null, 'prompt'
  from perfil p
union all
select 2000, 'herramientas comerciales', null, null,
       (select count(*) from unnest(${ARREGLO_HERRAMIENTAS_SQL}) as h where h = any (coalesce((select herramientas from aria), array[]::text[])))::text || ' de ${HERRAMIENTAS_COMERCIALES.length} habilitadas', null, null
union all
select 2001, 'piloto de las herramientas', null, null,
       case
         when not coalesce((select herramientas @> ${ARREGLO_HERRAMIENTAS_SQL} from aria), false) then 'no aplica (sin herramientas)'
         when (select negocio->'comercial_piloto' from aria) is null then 'abiertas a TODOS los clientes'
         else 'solo ' || (select jsonb_array_length(negocio->'comercial_piloto') from aria)::text || ' número(s): ' || (select string_agg('…' || right(n, 4), ', ') from aria, jsonb_array_elements_text(aria.negocio->'comercial_piloto') as n)
       end, null, null
order by 1;
`;
}

/** Los archivos que genera este módulo, por nombre (supabase/provisioning/<slug>/). Una prueba verifica que cada uno es EXACTAMENTE su salida. */
export function archivosMigracionTextos(slug: string): Readonly<Record<string, string>> {
  return {
    "04_migrar_textos_a_borradores.sql": sqlMigrarTextos(slug),
    "04_migrar_textos_a_borradores.reversa.sql": sqlReversaMigrarTextos(slug),
    "05_habilitar_herramientas_comerciales.sql": sqlHabilitarHerramientas(slug),
    "05_habilitar_herramientas_comerciales.reversa.sql": sqlReversaHabilitarHerramientas(slug),
    "05b_abrir_herramientas_comerciales_a_todos.sql": sqlAbrirHerramientasATodos(slug),
    "06_retirar_textos_del_prompt.sql": sqlRetirarDelPrompt(slug),
    "06_retirar_textos_del_prompt.reversa.sql": sqlReversaRetirarDelPrompt(slug),
    "07_estado_migracion_textos_solo_lectura.sql": sqlEstadoMigracion(slug),
  };
}

// Verificaciones en el momento de cargar el módulo: la tabla de correspondencia siempre es válida (si no, ningún script se genera).
for (const x of TEXTOS_MIGRABLES) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(x.clave)) throw new Error(`Clave no válida en la migración de textos: ${x.clave}`);
  if (!(TEMAS_CONTENIDO as readonly string[]).includes(x.tema) || !(AUDIENCIAS as readonly string[]).includes(x.audiencia)) throw new Error(`Tema o audiencia no válidos: ${x.clave}`);
  if (x.legado.length < 3 || x.legado.length > 60) throw new Error(`Nombre de tema no válido: ${x.legado}`);
}
