/**
 * GET /api/dashboard/tienda/contexto — lo que el editor necesita para armar sus formularios: las categorías del catálogo, las variables disponibles con su valor
 * (para «insertar variable» y para la vista previa), la zona horaria con la que se interpretan las fechas y la ruta pública de la tienda (para «Ver mi tienda»).
 * Solo lectura. Admin, agente y lectura.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { joyeriaOf, storefrontConfigFor, temaDe } from "@/lib/catalogo/vitrina";
import { withCms } from "@/lib/cms-comercial/http";
import { textosDeSiempre } from "@/lib/cms-comercial/mayoristas-textos";
import { videosDeSiempre } from "@/lib/cms-comercial/multimedia-tienda";
import { ZONA_NEGOCIO } from "@/lib/cms-comercial/tiempo";
import { ETIQUETAS_VARIABLE, VARIABLES } from "@/lib/cms-comercial/variables";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withCms(request, "read", async ({ catalogo, variables, actor }) => {
    // La ruta de la tienda es una comodidad: si no se puede resolver, el editor simplemente no muestra el enlace.
    const [vars, categorias, rutaTienda, publicada] = await Promise.all([
      variables.valores(actor.tenantId),
      catalogo.listarCategorias(actor.tenantId),
      Promise.resolve(catalogo.rutaPublica?.(actor.tenantId)).then((r) => r ?? null, () => null),
      Promise.resolve(catalogo.tiendaPublica?.(actor.tenantId)).then((s) => s ?? null, () => null),
    ]);
    // Qué tienda es: del tema depende si el pie y las preguntas se dibujan (el panel solo los ofrece donde se ven) y con qué empieza el pie de la administradora.
    const config = publicada ? storefrontConfigFor(publicada.slug) : null;
    const joyeria = config ? joyeriaOf(config) : null;
    const pagina = joyeria?.mayoristas?.pagina;
    const tienda =
      publicada && config
        ? {
            slug: publicada.slug,
            nombre: config.brand?.name ?? publicada.nombre,
            tema: temaDe(config),
            mayoristas: Boolean(joyeria?.mayoristas),
            // Cómo arma la tienda su página de mayoristas (solo CÓDIGOS de contenidos del CMS: la introducción, lo que no se muestra y lo que se suma al final).
            paginaMayoristas: pagina ? { intro: pagina.intro ?? null, omitir: [...(pagina.omitir ?? [])], tambien: [...(pagina.tambien ?? [])] } : null,
            descripcion: joyeria?.descripcion ?? null,
            // Los videos con los que se ve la tienda hoy en cada espacio (solo los espacios que tiene): el panel los muestra como «el de siempre» y permite volver a ellos.
            videosDeSiempre: videosDeSiempre(joyeria),
            // Los textos con los que se ve hoy el bloque «Compras por mayor» (solo si la tienda lo tiene): el panel los muestra como «el de siempre» y permite volver a ellos.
            ...(joyeria?.mayoristas ? { textosMayoristas: textosDeSiempre(joyeria.mayoristas) } : {}),
          }
        : null;
    return apiOk({
      variables: VARIABLES.map((id) => ({ id, etiqueta: ETIQUETAS_VARIABLE[id], valor: vars.variables[id] ?? null })),
      minimoMayorista: vars.minimoMayorista,
      categorias,
      rutaTienda,
      tienda,
      zona: ZONA_NEGOCIO,
      ahora: new Date().toISOString(),
    });
  });
}
