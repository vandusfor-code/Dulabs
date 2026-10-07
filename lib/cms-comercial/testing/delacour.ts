/**
 * CMS comercial — un DELACOUR SINTÉTICO para pruebas con Postgres embebido: su tienda publicada, su catálogo habilitado y los scripts de aprovisionamiento reales
 * de supabase/provisioning/delacour. Datos sintéticos (ids de prueba); nunca toca una base real. Solo para pruebas.
 */
import { readFileSync } from "node:fs";
import { TENANT_A, TENANT_B } from "@/lib/cms-comercial/testing/fixtures";
import { crearBaseCms, sqlSinMetacomandos, type BaseCms } from "@/lib/cms-comercial/testing/pglite";

const leer = (archivo: string) => sqlSinMetacomandos(readFileSync(`supabase/provisioning/delacour/${archivo}`, "utf8"));
export const scriptVerificar = () => leer("01_verificar_cms_comercial_solo_lectura.sql");
export const scriptHabilitar = () => leer("02_habilitar_cms_comercial.sql");
export const scriptSembrar = () => leer("03_sembrar_vitrina_actual.sql");
export const scriptReversaSembrar = () => leer("03_sembrar_vitrina_actual.reversa.sql");

export interface OpcionesDelacour {
  migracion?: boolean;
  catalogo?: boolean;
  tiendas?: number;
  /** false = no correr el script 02 (módulo apagado). Por defecto, encendido. */
  modulo?: boolean;
}

/** Un Delacour sintético: tienda publicada con slug «delacour» (negocio TENANT_A), catálogo habilitado y, por defecto, el módulo del CMS ya encendido con el script 02. */
export async function crearDelacourSintetico(opciones: OpcionesDelacour = {}): Promise<BaseCms> {
  const b = await crearBaseCms({ aplicarMigracion: opciones.migracion !== false });
  await b.aplicarSql("create table public.dulabs_catalogo_publicacion (id_tenant uuid not null, slug text not null, nombre_publico text not null default 'x', publicado boolean not null default true)");
  for (let i = 0; i < (opciones.tiendas ?? 1); i++) await b.aplicarSql(`insert into public.dulabs_catalogo_publicacion (id_tenant, slug) values ('${i === 0 ? TENANT_A : TENANT_B}', 'delacour')`);
  if (opciones.catalogo !== false) await b.aplicarSql(`insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado) values ('${TENANT_A}', 'catalogo', true)`);
  if (opciones.modulo !== false && opciones.migracion !== false && opciones.catalogo !== false && (opciones.tiendas ?? 1) === 1) await b.aplicarSql(scriptHabilitar());
  return b;
}
