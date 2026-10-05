/**
 * Pantalla de INICIO móvil del tema "tecnologia" (tienda de tecnología): hero, categorías, beneficios, productos destacados y banners. El header navy con el
 * buscador y la navegación inferior viven en el marco de la tienda (HeaderTecnologia / NavInferiorTecnologia). Server Component: todo llega en el HTML.
 * Datos comerciales = servicio público del catálogo (BD); contenido editorial = configuración de la vitrina del negocio. Nada inventado.
 */
import { BannersTecnologia } from "@/components/catalogo-publico/tienda/tecnologia/BannersTecnologia";
import { BeneficiosTecnologia } from "@/components/catalogo-publico/tienda/tecnologia/BeneficiosTecnologia";
import { CategoriasTecnologia } from "@/components/catalogo-publico/tienda/tecnologia/CategoriasTecnologia";
import { DestacadosTecnologia } from "@/components/catalogo-publico/tienda/tecnologia/DestacadosTecnologia";
import { HeroTecnologia } from "@/components/catalogo-publico/tienda/tecnologia/HeroTecnologia";
import { Revelar } from "@/components/catalogo-publico/tienda/Revelar";
import type { PublicHome } from "@/lib/catalogo/service";
import type { ConfigTecnologia } from "@/lib/catalogo/vitrina";

export function TiendaInicioTecnologia({
  home,
  contenido,
  basePath,
  listPath,
}: {
  home: PublicHome;
  contenido: ConfigTecnologia;
  basePath: string;
  listPath: string;
}) {
  return (
    <div className="flex flex-col gap-6 pb-2">
      <HeroTecnologia hero={contenido.hero} listPath={listPath} />
      <CategoriasTecnologia categorias={home.categories} basePath={basePath} listPath={listPath} />
      <Revelar>
        <BeneficiosTecnologia beneficios={contenido.beneficios} />
      </Revelar>
      <Revelar>
        <DestacadosTecnologia home={home} basePath={basePath} listPath={listPath} />
      </Revelar>
      <Revelar>
        <BannersTecnologia banners={contenido.banners} basePath={basePath} />
      </Revelar>
    </div>
  );
}
