import type { SupabaseClient } from "@supabase/supabase-js";

// Supabase EN MEMORIA, solo para tests -- permite ejecutar código REAL de la plataforma (cadena de disponibilidad de
// Agenda V2, almacenes de sesión/estado, catálogo) sin tocar la base real (la Supabase de pruebas ES la de producción de
// AMORE, ver scripts/run-test-flow.mjs). Implementa únicamente los operadores que ese código usa de verdad; cualquier
// otro lanza para que un test nunca pase "por accidente" con un filtro ignorado.
//
// Escrituras (insert/update/upsert/delete) opcionales: con `defaults` por tabla (los mismos DEFAULT de las migraciones)
// y `id` autoincremental, los almacenes reales (crearSesionAgendaV2, crearEntradaAmore, …) corren tal cual.

type Fila = Record<string, unknown>;
export type TablasEnMemoria = Record<string, Fila[]>;
export interface OpcionesSupabaseEnMemoria {
  /** Valores por defecto por tabla, aplicados en cada insert (equivalen a los DEFAULT de las migraciones). */
  defaults?: Record<string, Fila | (() => Fila)>;
}

type Filtro = (fila: Fila) => boolean;
type Operacion = { tipo: "select" } | { tipo: "insert"; filas: Fila[] } | { tipo: "update"; cambios: Fila } | { tipo: "upsert"; filas: Fila[]; conflicto: string[] } | { tipo: "delete" };

function comparable(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}

function igual(a: unknown, b: unknown): boolean {
  const ca = comparable(a);
  const cb = comparable(b);
  if (ca === null || cb === null) return ca === cb;
  return String(ca) === String(cb);
}

/** Soporta el subconjunto real usado en el repo: "col.eq.valor,col.is.null". */
function parsearOr(expresion: string): Filtro {
  const condiciones = expresion.split(",").map((parte) => {
    const [columna, operador, ...resto] = parte.split(".");
    const valor = resto.join(".");
    if (operador === "eq") return (f: Fila) => igual(f[columna!], valor);
    if (operador === "is" && valor === "null") return (f: Fila) => f[columna!] === null || f[columna!] === undefined;
    throw new Error(`[supabase-en-memoria] operador .or() no soportado: ${parte}`);
  });
  return (f) => condiciones.some((c) => c(f));
}

class Consulta implements PromiseLike<{ data: unknown; error: null }> {
  private filtros: Filtro[] = [];
  /** Varias llamadas a order() se aplican en secuencia (ORDER BY a, b), igual que PostgREST. */
  private ordenes: { columna: string; ascendente: boolean; nulosPrimero: boolean }[] = [];
  private limite: number | null = null;
  private operacion: Operacion = { tipo: "select" };
  private devolverFilas = false;

  constructor(
    private readonly filas: Fila[],
    private readonly nuevaFila: (fila: Fila) => Fila,
  ) {}

  /** Las columnas se ignoran a propósito: devuelve filas completas (los consumidores reales solo leen campos existentes). */
  select() {
    if (this.operacion.tipo !== "select") this.devolverFilas = true;
    return this;
  }
  insert(filas: Fila | Fila[]) {
    this.operacion = { tipo: "insert", filas: Array.isArray(filas) ? filas : [filas] };
    return this;
  }
  update(cambios: Fila) {
    this.operacion = { tipo: "update", cambios };
    return this;
  }
  upsert(filas: Fila | Fila[], opciones?: { onConflict?: string }) {
    this.operacion = { tipo: "upsert", filas: Array.isArray(filas) ? filas : [filas], conflicto: (opciones?.onConflict ?? "id").split(",").map((c) => c.trim()) };
    return this;
  }
  delete() {
    this.operacion = { tipo: "delete" };
    return this;
  }
  eq(columna: string, valor: unknown) {
    this.filtros.push((f) => igual(f[columna], valor));
    return this;
  }
  in(columna: string, valores: unknown[]) {
    this.filtros.push((f) => valores.some((v) => igual(f[columna], v)));
    return this;
  }
  gte(columna: string, valor: string | number) {
    this.filtros.push((f) => (f[columna] as string | number) >= valor);
    return this;
  }
  gt(columna: string, valor: string | number) {
    this.filtros.push((f) => (f[columna] as string | number) > valor);
    return this;
  }
  lte(columna: string, valor: string | number) {
    this.filtros.push((f) => (f[columna] as string | number) <= valor);
    return this;
  }
  lt(columna: string, valor: string | number) {
    this.filtros.push((f) => (f[columna] as string | number) < valor);
    return this;
  }
  is(columna: string, valor: null) {
    this.filtros.push((f) => (valor === null ? f[columna] === null || f[columna] === undefined : f[columna] === valor));
    return this;
  }
  or(expresion: string) {
    this.filtros.push(parsearOr(expresion));
    return this;
  }
  order(columna: string, opciones?: { ascending?: boolean; nullsFirst?: boolean }) {
    const ascendente = opciones?.ascending !== false;
    // Default de Postgres: NULLS LAST en ascendente, NULLS FIRST en descendente.
    this.ordenes.push({ columna, ascendente, nulosPrimero: opciones?.nullsFirst ?? !ascendente });
    return this;
  }
  limit(n: number) {
    this.limite = n;
    return this;
  }

  private filtradas(): Fila[] {
    return this.filas.filter((f) => this.filtros.every((filtro) => filtro(f)));
  }

  private ejecutar(): Fila[] {
    const op = this.operacion;
    if (op.tipo === "insert") {
      const nuevas = op.filas.map((f) => this.nuevaFila(f));
      this.filas.push(...nuevas);
      return nuevas.map((f) => ({ ...f }));
    }
    if (op.tipo === "upsert") {
      const resultado: Fila[] = [];
      for (const fila of op.filas) {
        const existente = this.filas.find((f) => op.conflicto.every((c) => igual(f[c], fila[c])));
        if (existente) Object.assign(existente, fila);
        else this.filas.push(this.nuevaFila(fila));
        resultado.push({ ...(existente ?? this.filas[this.filas.length - 1]!) });
      }
      return resultado;
    }
    if (op.tipo === "update") {
      const afectadas = this.filtradas();
      for (const f of afectadas) Object.assign(f, op.cambios);
      return afectadas.map((f) => ({ ...f }));
    }
    if (op.tipo === "delete") {
      const borrar = new Set(this.filtradas());
      const quedan = this.filas.filter((f) => !borrar.has(f));
      this.filas.splice(0, this.filas.length, ...quedan);
      return [...borrar].map((f) => ({ ...f }));
    }

    let resultado = this.filtradas();
    if (this.ordenes.length > 0) {
      resultado = [...resultado].sort((a, b) => {
        for (const { columna, ascendente, nulosPrimero } of this.ordenes) {
          const va = a[columna] as string | number | null | undefined;
          const vb = b[columna] as string | number | null | undefined;
          const anulo = va === null || va === undefined;
          const bnulo = vb === null || vb === undefined;
          if (anulo || bnulo) {
            if (anulo && bnulo) continue;
            return (anulo ? -1 : 1) * (nulosPrimero ? 1 : -1);
          }
          if (va === vb) continue;
          return (va! < vb! ? -1 : 1) * (ascendente ? 1 : -1);
        }
        return 0;
      });
    }
    if (this.limite !== null) resultado = resultado.slice(0, this.limite);
    return resultado.map((f) => ({ ...f }));
  }

  async maybeSingle() {
    const filas = this.ejecutar();
    if (filas.length > 1) throw new Error("[supabase-en-memoria] maybeSingle() con más de una fila");
    return { data: filas[0] ?? null, error: null };
  }

  async single() {
    const filas = this.ejecutar();
    if (filas.length !== 1) return { data: null, error: { message: `single() con ${filas.length} filas`, code: "PGRST116" } };
    return { data: filas[0]!, error: null };
  }

  then<R1 = { data: unknown; error: null }, R2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    const filas = this.ejecutar();
    const data = this.operacion.tipo === "select" || this.devolverFilas ? filas : null;
    return Promise.resolve({ data: data as unknown, error: null as null }).then(onfulfilled, onrejected);
  }
}

/** Cliente sobre `tablas` (una tabla ausente se comporta como vacía, igual que una consulta real sin filas). */
export function crearSupabaseEnMemoria(tablas: TablasEnMemoria, opciones: OpcionesSupabaseEnMemoria = {}): SupabaseClient {
  let siguienteId = 1_000;
  return {
    from(tabla: string) {
      const filas = (tablas[tabla] ??= []);
      const nuevaFila = (fila: Fila): Fila => {
        const d = opciones.defaults?.[tabla];
        const base = typeof d === "function" ? d() : (d ?? {});
        const ahora = new Date().toISOString();
        return { id: siguienteId++, created_at: ahora, updated_at: ahora, ...base, ...fila };
      };
      return new Consulta(filas, nuevaFila);
    },
  } as unknown as SupabaseClient;
}
