/**
 * CMS comercial — cableado REAL (solo servidor) de la tienda pública con el CMS: el negocio de la publicación, el lector de lo publicado y la lectura de Storage.
 * Lo usan la carga de la vitrina (página de inicio) y la ruta de las imágenes; ambos reciben estas dependencias inyectadas y se prueban sin red.
 *
 * Perezoso a propósito: el cliente de base de datos se crea al primer uso, DENTRO de quien llama, para que cualquier falla (por ejemplo, una variable de
 * entorno ausente) caiga en su manejo de errores (la tienda usa su vitrina de siempre; la imagen responde 502) y no rompa la página al construir las dependencias.
 */
import { createSupabaseCatalogRepository } from "@/lib/catalogo/repository";
import { createPublicCatalogService } from "@/lib/catalogo/service";
import { crearLectorSupabase } from "@/lib/cms-comercial/lector";
import { supabaseAdmin } from "@/lib/supabase";

function construir() {
  const supabase = supabaseAdmin();
  const repo = createSupabaseCatalogRepository(supabase);
  return { repo, servicio: createPublicCatalogService({ repo }), lector: crearLectorSupabase(supabase) };
}

export function crearDepsPublicasCms() {
  let base: ReturnType<typeof construir> | null = null;
  const dep = () => (base ??= construir());
  return {
    tenantDe: (slug: string) => dep().servicio.tenantOf(slug),
    cargar: (tenantId: string) => dep().lector.cargar(tenantId),
    abrir: (path: string) => dep().repo.openImage(path),
    ahora: () => Date.now(),
  };
}
