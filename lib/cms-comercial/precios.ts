/**
 * CMS comercial — PRECIOS EFECTIVOS para el catálogo (implementa el puerto lib/catalogo/precios.ts). Las dependencias llegan inyectadas (se prueba sin red).
 *
 * Lo único que hace es PREGUNTAR a evaluacion.ts —el único lugar donde se decide qué oferta aplica y a qué precio— con lo PUBLICADO del negocio y el reloj
 * inyectado. No repite ninguna regla: una oferta por producto (mayor prioridad; empate: mejor precio para el cliente; luego la más antigua; luego el código),
 * modalidad y vigencia vienen de allí. El canal (detal/mayorista) lo decide quien llama (la ruta autorizada o el canal del cliente), nunca el contenido.
 *
 *   - módulo apagado, sin migración o sin nada publicado => null: rige el precio de lista, EXACTAMENTE como antes de existir el CMS;
 *   - un error al leer lo publicado se PROPAGA (lanza): quien cobra no puede seguir con un precio sin verificar; la tienda decide mostrar el de lista.
 */
import { priceFor, type CatalogProduct, type PriceContext } from "@/lib/catalogo/domain";
import type { EvaluadorPrecios, OfertaDePrecio, PuertoPrecios } from "@/lib/catalogo/precios";
import type { Beneficio } from "@/lib/cms-comercial/esquemas";
import { ofertasActivas, precioEfectivo, type OfertaAplicada } from "@/lib/cms-comercial/evaluacion";
import type { InstantaneaCms } from "@/lib/cms-comercial/publicado";
import { describirVigencia } from "@/lib/cms-comercial/tiempo";
import { formatearPesos } from "@/lib/cms-comercial/variables";

export interface DepsPreciosCms {
  /** Lo publicado del negocio (el lector del CMS). null = el CMS no existe para ese negocio. Lanza ante un error inesperado. */
  cargar(tenantId: string): Promise<InstantaneaCms | null>;
  /** Reloj inyectado (milisegundos). */
  ahora(): number;
}

/** «-20%», «-$5.000», «Precio especial»: la etiqueta corta de una tarjeta de producto. La redacta el backend. */
export function etiquetaDeOferta(beneficio: Beneficio, ahorro: number): string {
  if (beneficio.tipo === "porcentaje") return `-${beneficio.valor}%`;
  if (beneficio.tipo === "monto_fijo") return `-${formatearPesos(ahorro)}`;
  return "Precio especial";
}

function ofertaDePrecio(o: OfertaAplicada): OfertaDePrecio {
  return {
    clave: o.clave,
    nombre: o.nombre,
    version: o.version,
    beneficio: o.textoBeneficio,
    etiqueta: etiquetaDeOferta(o.beneficio, o.ahorro),
    ahorro: o.ahorro,
    vigencia: o.vigencia.hasta ? describirVigencia({ hasta: o.vigencia.hasta }) : null,
    condiciones: o.condiciones,
  };
}

/** El evaluador de un negocio en UN instante: el filtrado de ofertas activas se hace una vez por canal y se reutiliza para todos los productos. */
export function crearEvaluadorPrecios(snap: InstantaneaCms, ahora: number): EvaluadorPrecios {
  const activas = {
    retail: ofertasActivas({ snap, canal: "retail", ahora }),
    wholesale: ofertasActivas({ snap, canal: "wholesale", ahora }),
  } satisfies Record<PriceContext, ReturnType<typeof ofertasActivas>>;
  return {
    de(producto: CatalogProduct, canal: PriceContext) {
      const lista = priceFor(producto, canal);
      const r = precioEfectivo({ snap, canal, ahora }, { referencia: producto.reference, categoriaId: producto.categoryId, precioLista: lista }, activas[canal]);
      if (!r.oferta) return { precio: lista, precioLista: lista, oferta: null };
      return { precio: r.precioFinal, precioLista: r.precioLista, oferta: ofertaDePrecio(r.oferta) };
    },
  };
}

export function crearPuertoPreciosCms(deps: DepsPreciosCms): PuertoPrecios {
  return {
    async paraNegocio(tenantId) {
      const snap = await deps.cargar(tenantId);
      // Con el módulo encendido SIEMPRE hay evaluador (aunque no haya ofertas): así la tienda sabe que sus precios pueden cambiar al publicar y no los deja en cachés.
      return snap ? crearEvaluadorPrecios(snap, deps.ahora()) : null;
    },
  };
}
