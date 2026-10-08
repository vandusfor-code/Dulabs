/**
 * CMS comercial — cableado REAL (solo servidor) de los precios efectivos: el lector de lo publicado sobre el cliente de Supabase y el reloj del servidor.
 * Lo usan las composiciones del catálogo que cobran o muestran precios (tienda pública, carrito y pedido, motor de pedidos y ARIA); el panel de administración
 * del catálogo NO lo usa: ahí se edita el precio de LISTA.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PuertoPrecios } from "@/lib/catalogo/precios";
import { conPrecios, createSupabaseCatalogRepository, type CatalogRepository } from "@/lib/catalogo/repository";
import { leerPublicado } from "@/lib/cms-comercial/lectura-publicada";
import { crearPuertoPreciosCms } from "@/lib/cms-comercial/precios";

export const crearPuertoPreciosSupabase = (supabase: SupabaseClient): PuertoPrecios => crearPuertoPreciosCms({ cargar: (tenantId) => leerPublicado(supabase, tenantId), ahora: () => Date.now() });

/** El repositorio del catálogo con los precios efectivos: lo que se muestra, se firma y se cobra. */
export const repositorioConPrecios = (supabase: SupabaseClient): CatalogRepository => conPrecios(createSupabaseCatalogRepository(supabase), crearPuertoPreciosSupabase(supabase));
