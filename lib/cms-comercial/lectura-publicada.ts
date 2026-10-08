/**
 * CMS comercial — la lectura de lo PUBLICADO que comparte una misma página.
 *
 * El inicio de la tienda necesita lo publicado en tres lugares: la vitrina, los datos de los combos y los precios efectivos de los productos. Con `cache` de React se lee
 * UNA sola vez por render del servidor y las tres usan la misma foto (menos viajes a la base de datos y toda la página sale del mismo contenido).
 *
 * Fuera de un render del servidor (rutas de la API, motor de pedidos, ARIA, pruebas) `cache` NO memoiza: quien cobra o confirma un pedido siempre lee lo vigente en ese
 * momento. La instantánea es de solo lectura: nadie la modifica (las funciones que la usan son puras).
 */
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearLectorSupabase } from "@/lib/cms-comercial/lector";
import type { InstantaneaCms } from "@/lib/cms-comercial/publicado";

export const leerPublicado = cache((supabase: SupabaseClient, tenantId: string): Promise<InstantaneaCms | null> => crearLectorSupabase(supabase).cargar(tenantId));
