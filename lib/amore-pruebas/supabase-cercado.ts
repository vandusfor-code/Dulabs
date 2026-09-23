/**
 * Cliente de Supabase para el endpoint de pruebas: el MISMO cliente real, salvo que las escrituras sobre citas
 * (crear, reprogramar, cancelar) y las RPC de reserva se bloquean mientras la reserva real no esté permitida. Es la
 * segunda barrera, independiente de la de Nylas (lib/nylas/nylas-client.ts): cualquier camino del bot que reciba este
 * cliente no puede dejar una cita escrita en la base, aunque no pase por el calendario.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { BloqueadoPorCercoDePruebas, type CercoPruebas } from "@/lib/amore-pruebas/cerco";

export const TABLAS_DE_CITAS = new Set(["dulabs_citas_especialista", "dulabs_cita_servicios", "dulabs_agenda_v2_citas_nylas", "dulabs_marketplace_citas"]);
export const RPC_DE_RESERVA = new Set(["dulabs_reservar_cita", "dulabs_reagendar_cita"]);
const ESCRITURAS = new Set(["insert", "update", "upsert", "delete"]);

export function supabaseCercado(real: SupabaseClient, cerco: Pick<CercoPruebas, "registrar">, permitirEscrituraCitas: boolean): SupabaseClient {
  if (permitirEscrituraCitas) return real;
  return new Proxy(real, {
    get(objetivo, prop) {
      if (prop === "from") {
        return (tabla: string) => {
          const builder = objetivo.from(tabla);
          if (!TABLAS_DE_CITAS.has(tabla)) return builder;
          return new Proxy(builder, {
            get(b, p) {
              const valor = Reflect.get(b, p);
              if (typeof p === "string" && ESCRITURAS.has(p)) {
                return () => {
                  cerco.registrar({ tipo: "escritura_db_bloqueada", tabla, operacion: p });
                  throw new BloqueadoPorCercoDePruebas(`${p} en ${tabla} deshabilitado en pruebas`);
                };
              }
              return typeof valor === "function" ? valor.bind(b) : valor;
            },
          });
        };
      }
      if (prop === "rpc") {
        return (nombre: string, ...resto: unknown[]) => {
          if (RPC_DE_RESERVA.has(nombre)) {
            cerco.registrar({ tipo: "escritura_db_bloqueada", tabla: `rpc:${nombre}`, operacion: "rpc" });
            throw new BloqueadoPorCercoDePruebas(`rpc ${nombre} deshabilitada en pruebas`);
          }
          return (objetivo.rpc as (...a: unknown[]) => unknown).call(objetivo, nombre, ...resto);
        };
      }
      const valor = Reflect.get(objetivo, prop);
      return typeof valor === "function" ? valor.bind(objetivo) : valor;
    },
  }) as SupabaseClient;
}
