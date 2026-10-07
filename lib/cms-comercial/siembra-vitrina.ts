/**
 * CMS comercial — SIEMBRA de la vitrina actual: la portada y el banner que una tienda YA muestra hoy (su registro en código) como contenido del CMS.
 * PURO: genera la página principal equivalente y el SQL que la crea y la publica. Se corre a mano en el SQL Editor de Supabase (supabase/provisioning).
 *
 * Por qué se siembra: cuando la administradora abre «Administración de tienda» la primera vez, debe encontrar SU tienda tal como está (no una página vacía), para
 * editarla en vez de reconstruirla. Y como el CMS es la única fuente de la portada una vez publicada, el contenido sembrado tiene que ver EXACTAMENTE igual
 * (una prueba compara el HTML de la tienda leída del CMS con el de la tienda de hoy).
 *
 * El SQL generado: resuelve el negocio por el slug de la publicación (nunca un id escrito a mano), exige el módulo habilitado, se niega a repetirse si ya hay una
 * página principal (no pisa el trabajo de la administradora), usa las mismas funciones que la aplicación (crear + publicar, con el checksum del contenido
 * canónico), firma como «Siembra inicial» (sin usuario) y deja todo en el historial. Una prueba regenera el SQL y lo compara con el archivo del repositorio.
 */
import { checksumDe, jsonCanonico } from "@/lib/cms-comercial/checksum";
import { SECCIONES_HOME } from "@/lib/cms-comercial/contrato";
import { homeSchema, type Home, type Imagen } from "@/lib/cms-comercial/esquemas";
import { heroOf, type CatalogStorefrontConfig, type StorefrontImage } from "@/lib/catalogo/vitrina";

export const ETIQUETA_SIEMBRA = "Siembra inicial (DuLabs)";
export const NOTA_SIEMBRA = "Siembra inicial: la portada y el banner que la tienda ya mostraba";

const estatica = (imagen: StorefrontImage & { focus?: string }): Imagen => ({
  origen: "estatico",
  src: imagen.src,
  ancho: imagen.width,
  alto: imagen.height,
  alt: imagen.alt,
  ...(imagen.focus ? { foco: imagen.focus } : {}),
});

/**
 * La página principal del CMS equivalente a la vitrina clásica de un negocio hoy. null si no tiene una portada completa (imagen y título): no hay nada que
 * sembrar. Falla (lanza) si lo que resulta no cumple el esquema del CMS: el SQL que se genera siempre lleva contenido válido.
 */
export function homeDesdeVitrina(config: CatalogStorefrontConfig): Home | null {
  const hero = heroOf(config);
  if (!hero) return null;
  const banner = config.bannerImage;
  // Las secciones que la tienda dibuja hoy, en su orden de siempre; las demás (ofertas, combos, campaña) quedan apagadas para que la administradora las encienda.
  const visibles = new Set<string>(["portada", "categorias", "destacados", ...(banner ? ["banner"] : [])]);
  const orden: string[] = ["portada", "categorias", "destacados", "banner", ...SECCIONES_HOME.filter((s) => !["portada", "categorias", "destacados", "banner"].includes(s))];
  const home: Home = {
    portada: {
      visible: true,
      imagen: estatica(hero.image),
      ...(hero.eyebrow ? { etiqueta: hero.eyebrow } : {}),
      titulo: hero.title,
      ...(hero.description ? { subtitulo: hero.description } : {}),
      ...(hero.cta !== "" ? { boton: { texto: hero.cta, destino: { tipo: "catalogo" as const } } } : {}),
    },
    ...(banner ? { banner: { visible: true, imagen: estatica(banner) } } : {}),
    secciones: orden.map((tipo) => ({ tipo: tipo as Home["secciones"][number]["tipo"], visible: visibles.has(tipo) })),
    categorias_destacadas: [],
    productos_destacados: [],
  };
  return homeSchema.parse(home);
}

/** Marca de una sola línea alrededor del JSON: no puede aparecer dentro del contenido (el esquema no admite «$»-etiquetas, y esto lo verifica). */
const DELIMITADOR = "$cms_json$";

/** El script SQL (un solo bloque DO, atómico) que siembra la página principal de la tienda con ese slug. */
export function sqlSembrarVitrina(slug: string, home: Home): string {
  homeSchema.parse(home);
  const json = jsonCanonico(home);
  if (json.includes(DELIMITADOR)) throw new Error("El contenido contiene el delimitador del script SQL.");
  const nombre = slug.replace(/[^a-z0-9-]/g, "");
  if (nombre !== slug || slug === "") throw new Error("Slug no válido para el script SQL.");
  const titulo = slug.charAt(0).toUpperCase() + slug.slice(1);
  return `-- CMS COMERCIAL (Bloque 29) — SEMBRAR la vitrina actual de ${titulo} como contenido del CMS.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico): si cualquier guarda falla, no queda nada.
--
-- ORDEN: correr SOLO DESPUÉS del 02_habilitar_cms_comercial.sql (el módulo debe estar habilitado). Antes, este script se niega.
--
-- QUÉ HACE: crea y PUBLICA la página principal de la tienda «${slug}» con la portada y el banner que la tienda ya muestra hoy (misma imagen, mismos textos, mismo
--   botón al catálogo), para que la administradora abra «Administración de tienda» y encuentre SU tienda, lista para editar. El resultado se ve IDÉNTICO al de hoy
--   (una prueba automática compara el HTML de la tienda leída del CMS con el de la tienda actual). Las secciones de ofertas, combos y campaña quedan apagadas.
--   Firma como «Siembra inicial» (sin usuario) y queda en el historial como la versión 1.
-- QUÉ NO HACE: no toca productos, precios, pedidos, ARIA ni otros negocios. No pisa nada: si la página principal ya existe en el CMS, se niega a repetirse.
--
-- GENERADO por el código (lib/cms-comercial/siembra-vitrina.ts): una prueba lo regenera y lo compara con este archivo. No se edita a mano.
--
-- REVERSA: supabase/provisioning/${slug}/03_sembrar_vitrina_actual.reversa.sql (despublica la página: la tienda vuelve a mostrar su portada de siempre;
--   el contenido y su historial se conservan como borrador).

do $$
declare
  v_tienda integer;
  v_tenant uuid;
  v_r jsonb;
  v_id uuid;
begin
  -- La migración debe estar aplicada.
  if to_regclass('public.dulabs_cms_entidades') is null or to_regprocedure('public.dulabs_cms_crear(uuid, text, text, jsonb, uuid, text)') is null then
    raise exception '${titulo}: falta aplicar la migración 20261210000000_dulabs_cms_comercial.sql antes de sembrar la vitrina';
  end if;

  -- Identidad: UNA sola tienda con ese slug (el negocio sale de la publicación, nunca de un id escrito a mano).
  select count(*) into v_tienda from public.dulabs_catalogo_publicacion where slug = '${slug}';
  if v_tienda <> 1 then
    raise exception '${titulo}: se esperaba exactamente UNA publicación con slug «${slug}», hay %', v_tienda;
  end if;
  select id_tenant into v_tenant from public.dulabs_catalogo_publicacion where slug = '${slug}';

  -- El módulo debe estar habilitado (script 02).
  if not exists (select 1 from public.dulabs_tenant_modulos where id_tenant = v_tenant and modulo = 'cms_comercial' and habilitado) then
    raise exception '${titulo}: el módulo cms_comercial no está habilitado; corre primero 02_habilitar_cms_comercial.sql';
  end if;

  -- No se pisa nada: si ya hay una página principal (sembrada antes o creada por la administradora), no se toca.
  if exists (select 1 from public.dulabs_cms_entidades where id_tenant = v_tenant and tipo = 'home') then
    raise notice '${titulo}: la página principal ya existe en el CMS; no se siembra nada';
    return;
  end if;

  v_r := public.dulabs_cms_crear(v_tenant, 'home', 'home', ${DELIMITADOR}${json}${DELIMITADOR}::jsonb, null, '${ETIQUETA_SIEMBRA}');
  if v_r->>'resultado' is distinct from 'ok' then
    raise exception '${titulo}: no se pudo crear la página principal (%)', v_r->>'resultado';
  end if;
  v_id := (v_r->'entidad'->>'id')::uuid;

  -- Se publica con el checksum del contenido canónico (lo mismo que calcula la aplicación al publicar y que verifica al leer).
  v_r := public.dulabs_cms_publicar(v_tenant, v_id, (v_r->'entidad'->>'rev')::integer, 0, '${checksumDe(home)}', '${NOTA_SIEMBRA}', null, '${ETIQUETA_SIEMBRA}');
  if v_r->>'resultado' is distinct from 'ok' then
    raise exception '${titulo}: no se pudo publicar la página principal (%)', v_r->>'resultado';
  end if;

  raise notice '${titulo}: página principal sembrada y publicada (versión 1)';
end $$;
`;
}

/** El script que deshace la siembra: despublica la página principal (vuelve a borrador; nada se borra y el historial queda). Se niega si la administradora ya publicó cambios. */
export function sqlReversaSembrarVitrina(slug: string): string {
  const nombre = slug.replace(/[^a-z0-9-]/g, "");
  if (nombre !== slug || slug === "") throw new Error("Slug no válido para el script SQL.");
  const titulo = slug.charAt(0).toUpperCase() + slug.slice(1);
  return `-- CMS COMERCIAL (Bloque 29) — REVERSA de 03_sembrar_vitrina_actual.sql para ${titulo}.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico).
--
-- QUÉ HACE: DESPUBLICA la página principal de la tienda «${slug}»: la tienda vuelve a mostrar la portada y el banner de siempre (los del código). El contenido y su
--   historial NO se borran: la página queda como borrador (se puede volver a publicar desde «Administración de tienda»).
-- SE NIEGA si la administradora ya publicó cambios (versión 2 o más) o si la página ya no está publicada: perdería su trabajo en vivo. Para despublicarla a propósito
--   (la tienda volvería a la portada del código), confirma explícitamente en la misma sesión:
--       set dulabs.confirmar_reversa_siembra = 'si';
-- No toca productos, precios, pedidos, ARIA ni otros negocios.

do $$
declare
  v_tenant uuid;
  v_e public.dulabs_cms_entidades;
  v_r jsonb;
begin
  if to_regclass('public.dulabs_cms_entidades') is null then
    raise exception '${titulo}: el CMS comercial no está instalado; no hay nada que revertir';
  end if;

  select id_tenant into v_tenant from public.dulabs_catalogo_publicacion where slug = '${slug}';
  if v_tenant is null then
    raise exception '${titulo}: no existe una publicación con slug «${slug}»';
  end if;

  select * into v_e from public.dulabs_cms_entidades where id_tenant = v_tenant and tipo = 'home';
  if v_e.id is null then
    raise notice '${titulo}: no hay página principal en el CMS; nada que revertir';
    return;
  end if;
  if v_e.estado not in ('publicada', 'pausada') then
    raise notice '${titulo}: la página principal ya no está publicada (estado %); nada que revertir', v_e.estado;
    return;
  end if;
  if coalesce(v_e.version_activa, 0) > 1 and coalesce(current_setting('dulabs.confirmar_reversa_siembra', true), '') <> 'si' then
    raise exception '${titulo}: la administradora ya publicó la versión %; despublicar la página perdería su trabajo en vivo. Confirma con: set dulabs.confirmar_reversa_siembra = ''si'';', v_e.version_activa;
  end if;

  v_r := public.dulabs_cms_despublicar(v_tenant, v_e.id, null, 'Reversa de la siembra inicial (DuLabs)');
  if v_r->>'resultado' is distinct from 'ok' then
    raise exception '${titulo}: no se pudo despublicar la página principal (%)', v_r->>'resultado';
  end if;

  raise notice '${titulo}: página principal despublicada; la tienda vuelve a su portada de siempre';
end $$;
`;
}
