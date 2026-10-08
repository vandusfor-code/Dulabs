/**
 * CMS comercial — un DELACOUR SINTÉTICO para pruebas con Postgres embebido: su tienda publicada, su catálogo habilitado y los scripts de aprovisionamiento reales
 * de supabase/provisioning/delacour. Datos sintéticos (ids de prueba); nunca toca una base real. Solo para pruebas.
 */
import { readFileSync } from "node:fs";
import { AGENT_TOOL_NAMES, esHerramientaComercial } from "@/lib/agente/nombres-herramientas";
import { TENANT_A, TENANT_B } from "@/lib/cms-comercial/testing/fixtures";
import { crearBaseCms, sqlSinMetacomandos, type BaseCms } from "@/lib/cms-comercial/testing/pglite";

const leer = (archivo: string) => sqlSinMetacomandos(readFileSync(`supabase/provisioning/delacour/${archivo}`, "utf8"));
export const scriptVerificar = () => leer("01_verificar_cms_comercial_solo_lectura.sql");
export const scriptHabilitar = () => leer("02_habilitar_cms_comercial.sql");
export const scriptSembrar = () => leer("03_sembrar_vitrina_actual.sql");
export const scriptReversaSembrar = () => leer("03_sembrar_vitrina_actual.reversa.sql");
export const scriptMigrarTextos = () => leer("04_migrar_textos_a_borradores.sql");
export const scriptReversaMigrarTextos = () => leer("04_migrar_textos_a_borradores.reversa.sql");
export const scriptHabilitarHerramientas = () => leer("05_habilitar_herramientas_comerciales.sql");
export const scriptReversaHabilitarHerramientas = () => leer("05_habilitar_herramientas_comerciales.reversa.sql");
export const scriptAbrirHerramientasATodos = () => leer("05b_abrir_herramientas_comerciales_a_todos.sql");
export const scriptRetirarDelPrompt = () => leer("06_retirar_textos_del_prompt.sql");
export const scriptReversaRetirarDelPrompt = () => leer("06_retirar_textos_del_prompt.reversa.sql");
export const scriptEstadoMigracion = () => leer("07_estado_migracion_textos_solo_lectura.sql");

/** Los 24 temas del prompt de ARIA con textos SINTÉTICOS (los reales no están en el repositorio). Dos de ellos traen el mínimo mayorista escrito a mano. */
export const CONOCIMIENTO_SINTETICO: ReadonlyArray<{ tema: string; info: string }> = [
  { tema: "Quiénes somos", info: "Somos una joyería ficticia de prueba con diseños propios." },
  { tema: "Ubicación", info: "Estamos en el Centro Comercial Ficticio, local 12, de lunes a sábado." },
  { tema: "Líneas y materiales", info: "Manejamos acero inoxidable, plata ley 925 y baños en oro." },
  { tema: "Dorado y plateado", info: "Hay piezas en acabado dorado y en acabado plateado." },
  { tema: "Venta al detal", info: "Puedes comprar desde una unidad, sin mínimo." },
  { tema: "Venta al por mayor", info: "La compra inicial mayorista parte desde $750.000 en productos surtidos." },
  { tema: "Emprendimiento", info: "Si vas a emprender, tu primera compra mayorista es de 750000 pesos y te asesoramos." },
  { tema: "Regalos", info: "Preparamos tus regalos con empaque especial." },
  { tema: "Hombre y mujer", info: "Tenemos líneas para hombre y para mujer." },
  { tema: "Catálogo", info: "El catálogo completo está en la tienda en línea." },
  { tema: "Precios y disponibilidad", info: "Los precios y la disponibilidad se confirman en el catálogo." },
  { tema: "Envíos", info: "Enviamos por transportadora a todo el país; el costo lo confirma una asesora." },
  { tema: "Medios de pago", info: "Aceptamos transferencia y pago contra entrega." },
  { tema: "Horario", info: "Atendemos de lunes a sábado de 9 a. m. a 6 p. m." },
  { tema: "Garantías", info: "Las piezas tienen 30 días de garantía contra defectos de fábrica." },
  { tema: "Cambios y devoluciones", info: "Puedes cambiar una pieza sin uso dentro de los 8 días siguientes a la entrega." },
  { tema: "Separar mercancía", info: "Separamos tu pedido por 24 horas." },
  { tema: "Promociones", info: "Las promociones vigentes las confirma una asesora." },
  { tema: "Servicios", info: "Hacemos grabados y arreglos sencillos." },
  { tema: "Colección Vida Eterna", info: "Una línea de piezas pensadas para durar toda la vida." },
  { tema: "Reclamos", info: "Si algo llegó mal, escríbenos y lo resolvemos." },
  { tema: "Pago no identificado", info: "Si hiciste un pago que no aparece, envía el comprobante." },
  { tema: "Despedida", info: "Gracias por escribirnos, que tengas un lindo día." },
  { tema: "Datos del pedido", info: "Para el pedido necesitamos tu nombre, ciudad y dirección." },
];

/** Las herramientas de ARIA «de hoy» en Delacour: las de siempre, sin el motor de envíos y sin las comerciales del CMS. */
export const HERRAMIENTAS_ARIA_HOY: readonly string[] = AGENT_TOOL_NAMES.filter((t) => t !== "consultar_envio" && !esHerramientaComercial(t));

export interface OpcionesAria {
  /** Textos de `negocio.conocimiento`. Por defecto, los 24 sintéticos. */
  conocimiento?: ReadonlyArray<{ tema: string; info: string }>;
  herramientas?: readonly string[];
  /** Se mezcla sobre el `negocio` base (nombre, personalidad, pedido con el mínimo mayorista y la dirección de la tienda). */
  negocio?: Record<string, unknown>;
  /** Cuántas configuraciones de ARIA tiene el negocio (por defecto 1). */
  filas?: number;
}

export interface OpcionesDelacour {
  migracion?: boolean;
  catalogo?: boolean;
  tiendas?: number;
  /** false = no correr el script 02 (módulo apagado). Por defecto, encendido. */
  modulo?: boolean;
  /** La configuración de ARIA del negocio (tabla real dulabs_agente_runtime_config). Sin esta opción, la tabla no existe. */
  aria?: OpcionesAria;
}

const literalTexto = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Un Delacour sintético: tienda publicada con slug «delacour» (negocio TENANT_A), catálogo habilitado y, por defecto, el módulo del CMS ya encendido con el script 02. */
export async function crearDelacourSintetico(opciones: OpcionesDelacour = {}): Promise<BaseCms> {
  const b = await crearBaseCms({ aplicarMigracion: opciones.migracion !== false });
  await b.aplicarSql("create table public.dulabs_catalogo_publicacion (id_tenant uuid not null, slug text not null, nombre_publico text not null default 'x', publicado boolean not null default true)");
  for (let i = 0; i < (opciones.tiendas ?? 1); i++) await b.aplicarSql(`insert into public.dulabs_catalogo_publicacion (id_tenant, slug) values ('${i === 0 ? TENANT_A : TENANT_B}', 'delacour')`);
  if (opciones.catalogo !== false) await b.aplicarSql(`insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado) values ('${TENANT_A}', 'catalogo', true)`);
  if (opciones.modulo !== false && opciones.migracion !== false && opciones.catalogo !== false && (opciones.tiendas ?? 1) === 1) await b.aplicarSql(scriptHabilitar());
  if (opciones.aria) await sembrarAria(b, opciones.aria);
  return b;
}

/** La tabla REAL de la configuración de ARIA (migraciones del repositorio) y su fila sintética. */
async function sembrarAria(b: BaseCms, aria: OpcionesAria): Promise<void> {
  for (const m of ["20261109000000_dulabs_agente_runtime.sql", "20261201000000_dulabs_agente_negocio_64kb.sql"]) await b.aplicarSql(readFileSync(`supabase/migrations/${m}`, "utf8"));
  const negocio = {
    nombre_agente: "Aria",
    nombre_negocio: "Joyería Ficticia",
    personalidad: "Cercana y breve.",
    pedido: { minimo_mayorista: 750_000, direccion_tienda: "Centro Comercial Ficticio, local 12" },
    conocimiento: aria.conocimiento ?? CONOCIMIENTO_SINTETICO,
    ...aria.negocio,
  };
  const herramientas = `array[${(aria.herramientas ?? HERRAMIENTAS_ARIA_HOY).map(literalTexto).join(", ")}]::text[]`;
  for (let i = 0; i < (aria.filas ?? 1); i++) {
    await b.sql(
      `insert into public.dulabs_agente_runtime_config (id_tenant, phone_number_id, tipo, habilitado, proveedor, modelo, credencial_ref, nivel_razonamiento, herramientas, canal, negocio)
       values ($1, $2, 'catalog_sales', true, 'gemini', 'gemini-3.6-flash', 'env:GEMINI_KEY_PRUEBA', 'low', ${herramientas}, 'retail', $3::jsonb)`,
      [TENANT_A, `10000000000000${i + 1}`, JSON.stringify(negocio)],
    );
  }
}
