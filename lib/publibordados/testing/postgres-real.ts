/**
 * Publi Bordados — puente de PRUEBAS hacia un PostgreSQL LOCAL EFÍMERO real.
 *
 * Las RPC del módulo Clientes/Solicitudes se ejecutan en Postgres de verdad (migración real,
 * triggers, constraints, funciones), vía `psql`. Se usa junto con lib/testing/supabase-rest-memoria
 * (sesión, equipo, módulos) para probar rutas → servicio → repositorio → SQL sin simular la BD.
 *
 * Activación: PB_TEST_PSQL="psql -h /var/tmp/pgpb -p 55433 -U postgres" (sin esa variable, las
 * pruebas que lo usan se saltan). NUNCA apuntar a producción: crea y borra su propia base.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const PSQL = process.env.PB_TEST_PSQL?.trim() || "";
export const HAY_POSTGRES = PSQL.length > 0;

/** Funciones que devuelven un conjunto de filas (PostgREST devuelve un arreglo). */
const DEVUELVEN_FILAS = new Set(["dulabs_pb_registrar_solicitud"]);

function literal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return `'${s.replace(/'/g, "''")}'`;
}

export interface BasePrueba {
  nombre: string;
  sql(consulta: string): string;
  rpc(fn: string, args: Record<string, unknown>): { data?: unknown; error?: { code: string; message: string } };
  borrar(): void;
}

function ejecutar(base: string | null, consulta: string): string {
  const [bin, ...args] = PSQL.split(/\s+/);
  return execFileSync(bin!, [...args, ...(base ? ["-d", base] : []), "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-qAtX", "-c", consulta], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Crea una base nueva con el preludio y la migración REAL de solicitudes aplicados. */
export function crearBasePrueba(): BasePrueba {
  const nombre = `pb_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  ejecutar(null, `create database ${nombre}`);
  const raiz = join(__dirname, "..", "..", "..");
  const [bin, ...args] = PSQL.split(/\s+/);
  for (const archivo of [
    "supabase/tests/20261120000000_dulabs_pb_solicitudes.prelude.sql",
    "supabase/migrations/20261120000000_dulabs_pb_solicitudes.sql",
  ]) {
    execFileSync(bin!, [...args, "-d", nombre, "-v", "ON_ERROR_STOP=1", "-qX", "-f", join(raiz, archivo)], { stdio: ["ignore", "ignore", "pipe"] });
  }
  return {
    nombre,
    sql: (consulta) => ejecutar(nombre, consulta),
    rpc(fn, argsRpc) {
      const lista = Object.entries(argsRpc)
        .map(([k, v]) => `${k} => ${literal(v)}`)
        .join(", ");
      try {
        const salida = ejecutar(nombre, `select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.${fn}(${lista}) x`);
        const filas = JSON.parse(salida || "[]") as unknown[];
        return { data: DEVUELVEN_FILAS.has(fn) ? filas : (filas[0] ?? null) };
      } catch (err) {
        const texto = String((err as { stderr?: string }).stderr ?? err);
        const m = /ERROR:\s+([0-9A-Z]{5}):\s+([^\n]*)/.exec(texto);
        return { error: { code: m?.[1] ?? "XX000", message: m?.[2]?.trim() ?? texto } };
      }
    },
    borrar() {
      try {
        ejecutar(null, `drop database if exists ${nombre} with (force)`);
      } catch {
        // best-effort: la base es efímera
      }
    },
  };
}
