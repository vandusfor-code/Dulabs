/**
 * Catálogo — PRECIO EFECTIVO (puerto). PURO: solo tipos y una función; sin I/O ni dependencia del CMS.
 *
 * El precio de LISTA es el del producto (`CatalogProduct.pricing`). El precio EFECTIVO es el que se MUESTRA y se COBRA: el de lista o, si hay una oferta
 * vigente que le aplica, el de esa oferta (una sola por producto: lib/cms-comercial/evaluacion.ts). Tienda, carrito, cotización firmada, pedido, motor
 * de pedidos y ARIA leen el precio por este puerto: así lo mostrado y lo cobrado no pueden diferir.
 *
 * Sin puerto (módulo del CMS apagado, sin migración, sin ofertas publicadas) rige EXACTAMENTE el precio de lista: `precioDeLista` es idéntico a `priceFor`.
 * Quien compone el servicio decide si hay puerto (`conPrecios` en repository.ts); las pruebas con repositorios en memoria no lo tienen.
 */
import { priceFor, type CatalogProduct, type PriceContext } from "@/lib/catalogo/domain";

/** La oferta que bajó el precio, lista para mostrar al cliente (sin ids internos). */
export interface OfertaDePrecio {
  clave: string;
  nombre: string;
  version: number;
  /** «20% de descuento», «$5.000 de descuento», «precio especial de $60.000» (la redacta el backend). */
  beneficio: string;
  /** Etiqueta corta para la tarjeta: «-20%», «-$5.000», «Precio especial». */
  etiqueta: string;
  /** Cuánto ahorra el cliente por unidad (pesos). */
  ahorro: number;
  /** «hasta el 31 de octubre de 2026», o null si no hay fecha de fin que contar. */
  vigencia: string | null;
  condiciones: string | null;
}

export interface PrecioEfectivo {
  /** Lo que se muestra y se cobra. null = «a consultar» (nunca un 0 inventado). */
  precio: number | null;
  /** El precio de lista del canal (antes de la oferta). */
  precioLista: number | null;
  /** La oferta aplicada; null = rige el precio de lista. */
  oferta: OfertaDePrecio | null;
}

/** Los precios efectivos de UN negocio en un instante: se carga lo vigente una vez y se evalúan todos los productos que haga falta. */
export interface EvaluadorPrecios {
  de(producto: CatalogProduct, canal: PriceContext): PrecioEfectivo;
}

export interface PuertoPrecios {
  /**
   * Lo vigente del negocio. null = el negocio no usa ofertas (módulo apagado o sin migración): rige el precio de lista.
   * Lanza si NO se pudo verificar (error de base de datos): quien llama decide (la tienda muestra lista; el pedido NO se prepara).
   */
  paraNegocio(tenantId: string): Promise<EvaluadorPrecios | null>;
}

/** El precio de lista como precio efectivo (sin oferta). */
export function precioDeLista(producto: Pick<CatalogProduct, "pricing">, canal: PriceContext): PrecioEfectivo {
  const precio = priceFor(producto, canal);
  return { precio, precioLista: precio, oferta: null };
}

/**
 * La decisión ÚNICA de qué precio rige para un producto: el de la oferta SOLO si deja un precio entero, positivo y MENOR que el de lista del mismo
 * producto y canal; en cualquier otro caso (sin evaluador, sin oferta, una oferta incoherente) el precio de lista. La vitrina, el carrito, la cotización,
 * el pedido y el motor de pedidos usan esta misma función: nadie más decide el precio.
 */
export function precioQueRige(producto: Pick<CatalogProduct, "pricing">, canal: PriceContext, efectivo: PrecioEfectivo | null | undefined): PrecioEfectivo {
  const lista = priceFor(producto, canal);
  const oferta = efectivo?.oferta ?? null;
  if (efectivo && oferta !== null && efectivo.precioLista === lista && efectivo.precio !== null && lista !== null && Number.isInteger(efectivo.precio) && efectivo.precio >= 1 && efectivo.precio < lista) {
    return { precio: efectivo.precio, precioLista: lista, oferta };
  }
  return { precio: lista, precioLista: lista, oferta: null };
}

/** No se pudo verificar el precio efectivo de un negocio que usa ofertas: nada que cobre dinero debe seguir con un precio sin verificar. */
export class PreciosNoDisponibles extends Error {
  constructor(causa?: unknown) {
    super(`No se pudo verificar el precio vigente${causa instanceof Error ? `: ${causa.message}` : ""}`);
    this.name = "PreciosNoDisponibles";
  }
}
