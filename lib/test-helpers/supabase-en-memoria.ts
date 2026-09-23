import type { SupabaseClient } from "@supabase/supabase-js";

// Supabase EN MEMORIA, solo para tests -- permite ejecutar la cadena REAL de
// disponibilidad de Agenda V2 (resolverEspecialistasElegiblesParaServicio ->
// ventanasLaboralesEspecialista -> bloqueosDelDia -> citasOcupadasDelDia ->
// resolverCalendarIdNylasDeEspecialista -> listarHorariosDisponiblesPorServicioConNylas)
// sin tocar la base real (la Supabase de pruebas ES la de producción de AMORE,
// ver scripts/run-test-flow.mjs). Implementa únicamente los operadores de
// lectura que esa cadena usa de verdad; cualquier otro lanza para que un test
// nunca pase "por accidente" con un filtro ignorado.

type Fila = Record<string, unknown>;
export type TablasEnMemoria = Record<string, Fila[]>;

type Filtro = (fila: Fila) => boolean;

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
  private orden: { columna: string; ascendente: boolean } | null = null;
  private limite: number | null = null;

  constructor(private readonly filas: Fila[]) {}

  /** Las columnas se ignoran a propósito: devuelve filas completas (los consumidores reales solo leen campos existentes). */
  select() {
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
  order(columna: string, opciones?: { ascending?: boolean }) {
    this.orden = { columna, ascendente: opciones?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.limite = n;
    return this;
  }

  private ejecutar(): Fila[] {
    let resultado = this.filas.filter((f) => this.filtros.every((filtro) => filtro(f)));
    if (this.orden) {
      const { columna, ascendente } = this.orden;
      resultado = [...resultado].sort((a, b) => {
        const va = a[columna] as string | number;
        const vb = b[columna] as string | number;
        if (va === vb) return 0;
        return (va < vb ? -1 : 1) * (ascendente ? 1 : -1);
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

  then<R1 = { data: unknown; error: null }, R2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve({ data: this.ejecutar() as unknown, error: null as null }).then(onfulfilled, onrejected);
  }
}

/** Cliente de SOLO LECTURA sobre `tablas` (una tabla ausente se comporta como vacía, igual que una consulta real sin filas). */
export function crearSupabaseEnMemoria(tablas: TablasEnMemoria): SupabaseClient {
  return {
    from(tabla: string) {
      return new Consulta(tablas[tabla] ?? []);
    },
  } as unknown as SupabaseClient;
}
