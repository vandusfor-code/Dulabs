/**
 * CMS comercial — POSTGRES REAL EMBEBIDO para pruebas (PGlite: Postgres compilado a WASM, en memoria). Sin red, sin Docker y sin tocar ninguna base de datos real.
 *
 * Ejecuta la migración REAL de supabase/migrations (todas las veces que se pida: es idempotente) y expone un cliente mínimo con `.rpc()` que llama a las
 * funciones SQL reales con argumentos con nombre, como PostgREST. Así el repositorio de Supabase se prueba contra el SQL de verdad: restricciones, candados,
 * triggers de inmutabilidad, permisos y aislamiento por negocio.
 *
 * Solo para pruebas: nunca se importa desde código de producción.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MIGRACION_CMS = "20261210000000_dulabs_cms_comercial.sql";
export const ROLLBACK_CMS = "20261210000000_dulabs_cms_comercial.down.sql";
export const PRUEBA_SQL_CMS = "20261210000000_dulabs_cms_comercial.test.sql";

const raiz = () => process.cwd();
export const rutaMigracion = (archivo = MIGRACION_CMS) => path.join(raiz(), "supabase", "migrations", archivo);
export const rutaRollback = (archivo = ROLLBACK_CMS) => path.join(raiz(), "supabase", "rollbacks", archivo);
export const rutaPruebaSql = (archivo = PRUEBA_SQL_CMS) => path.join(raiz(), "supabase", "tests", archivo);

/** Quita los comandos de psql (`\set`, `\i`…) que PGlite no entiende: los archivos de supabase/tests están escritos para psql. */
export function sqlSinMetacomandos(sql: string): string {
  return sql
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith("\\"))
    .join("\n");
}

/** Estado previo mínimo que la migración espera encontrar (en Supabase ya existe). */
const PREPARACION = `
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  create table public.dulabs_tenant_modulos (
    id_tenant uuid not null,
    modulo text not null check (modulo ~ '^[a-z][a-z0-9_]{1,39}$'),
    habilitado boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (id_tenant, modulo)
  );
  alter table public.dulabs_tenant_modulos enable row level security;
`;

interface FirmaFuncion {
  nombres: string[];
  tipos: string[];
  conDefault: number;
}

export interface BaseCms {
  db: PGlite;
  /** Cliente con `.rpc()` real sobre las funciones SQL. Cualquier otra operación del cliente de Supabase no existe a propósito. */
  supabase: SupabaseClient;
  habilitarModulo(tenantId: string, habilitado?: boolean): Promise<void>;
  sql<T = Record<string, unknown>>(texto: string, params?: unknown[]): Promise<T[]>;
  aplicarSql(texto: string): Promise<void>;
  cerrar(): Promise<void>;
}

export async function crearBaseCms(opciones: { aplicarMigracion?: boolean; veces?: number } = {}): Promise<BaseCms> {
  const db = new PGlite();
  await db.exec(PREPARACION);
  const migracion = readFileSync(rutaMigracion(), "utf8");
  if (opciones.aplicarMigracion !== false) for (let i = 0; i < (opciones.veces ?? 1); i++) await db.exec(migracion);

  const firmas = new Map<string, FirmaFuncion | null>();
  async function firmaDe(nombre: string): Promise<FirmaFuncion | null> {
    if (firmas.has(nombre)) return firmas.get(nombre) ?? null;
    const r = await db.query<{ nombres: string[] | null; tipos: string[]; defaults: number }>(
      `select p.proargnames as nombres,
              array(select format_type(t, null) from unnest(p.proargtypes::oid[]) with ordinality as x(t, n) order by n) as tipos,
              p.pronargdefaults as defaults
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`,
      [nombre],
    );
    const fila = r.rows[0];
    const firma = fila ? { nombres: fila.nombres ?? [], tipos: fila.tipos, conDefault: fila.defaults } : null;
    firmas.set(nombre, firma);
    return firma;
  }

  async function llamar(nombre: string, args: Record<string, unknown>) {
    const firma = await firmaDe(nombre);
    const noExiste = (detalle: string) => ({ data: null, error: { code: "PGRST202", message: `Could not find the function public.${nombre}`, details: detalle, hint: null } });
    if (!firma) return noExiste("sin firma");
    const pasados = Object.keys(args).filter((k) => args[k] !== undefined);
    const desconocidos = pasados.filter((k) => !firma.nombres.includes(k));
    // PostgREST exige que los argumentos pasados existan y que estén todos los que no tienen valor por defecto.
    const obligatorios = firma.nombres.slice(0, firma.nombres.length - firma.conDefault);
    if (desconocidos.length > 0 || obligatorios.some((k) => !pasados.includes(k))) return noExiste(`argumentos: ${pasados.join(", ")}`);
    const partes = pasados.map((k, i) => `${k} => $${i + 1}::${firma.tipos[firma.nombres.indexOf(k)]}`);
    const params = pasados.map((k) => {
      const tipo = firma.tipos[firma.nombres.indexOf(k)];
      const v = args[k];
      return tipo === "jsonb" && v !== null ? JSON.stringify(v) : v;
    });
    try {
      const r = await db.query<{ r: unknown }>(`select public.${nombre}(${partes.join(", ")}) as r`, params);
      return { data: r.rows[0]?.r ?? null, error: null };
    } catch (e) {
      const err = e as { code?: string; message?: string; detail?: string };
      return { data: null, error: { code: err.code ?? "XX000", message: err.message ?? "error", details: err.detail ?? null, hint: null } };
    }
  }

  const supabase = { rpc: (nombre: string, args: Record<string, unknown> = {}) => llamar(nombre, args) } as unknown as SupabaseClient;

  return {
    db,
    supabase,
    async habilitarModulo(tenantId, habilitado = true) {
      await db.query(`insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado) values ($1, 'cms_comercial', $2) on conflict (id_tenant, modulo) do update set habilitado = excluded.habilitado`, [tenantId, habilitado]);
    },
    async sql<T>(texto: string, params?: unknown[]) {
      return (await db.query<T>(texto, params)).rows;
    },
    async aplicarSql(texto) {
      await db.exec(texto);
    },
    async cerrar() {
      await db.close();
    },
  };
}
