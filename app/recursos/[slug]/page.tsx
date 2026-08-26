import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Nav } from "@/components/site/Nav";
import { PageSpotlight } from "@/components/site/PageSpotlight";
import { JsonLd } from "@/components/site/JsonLd";
import { breadcrumbSchema, articleSchema } from "@/lib/schema";
import { ServiceBreadcrumb, ServiceRelated } from "@/components/site/ServicePage";
import { Footer } from "@/components/site/Sections";
import { ARTICULOS, articuloPorSlug } from "@/lib/recursos";

export function generateStaticParams() {
  return ARTICULOS.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const articulo = articuloPorSlug(slug);
  if (!articulo) return {};
  return {
    title: `${articulo.titulo} | DuLabs`,
    description: articulo.resumen,
    alternates: { canonical: `https://www.dulabs.co/recursos/${articulo.slug}` },
  };
}

export default async function ArticuloPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const articulo = articuloPorSlug(slug);
  if (!articulo) notFound();

  return (
    <div className="relative min-h-screen bg-site-bg text-site-fg">
      <div className="site-grain" aria-hidden />
      <JsonLd
        data={breadcrumbSchema([
          { name: "Inicio", path: "/" },
          { name: "Recursos", path: "/recursos" },
          { name: articulo.titulo, path: `/recursos/${articulo.slug}` },
        ])}
      />
      <JsonLd
        data={articleSchema({
          title: articulo.titulo,
          description: articulo.resumen,
          path: `/recursos/${articulo.slug}`,
          datePublished: articulo.fechaPublicacion,
        })}
      />
      <PageSpotlight />
      <Nav />
      <main>
        <article className="relative pt-24 pb-16 md:pt-32 md:pb-20">
          <div className="mx-auto max-w-3xl px-6">
            <ServiceBreadcrumb
              items={[{ label: "Inicio", href: "/" }, { label: "Recursos", href: "/recursos" }, { label: articulo.titulo }]}
            />
            <h1 className="mt-6 font-display text-[30px] font-medium leading-[1.12] tracking-[-0.02em] text-site-fg md:text-[40px]">
              {articulo.titulo}
            </h1>
            <p className="mt-4 text-[15px] leading-relaxed text-site-muted-fg">{articulo.resumen}</p>

            <div className="mt-10 flex flex-col gap-5">
              {articulo.bloques.map((bloque, i) => {
                if (bloque.tipo === "h2") {
                  return (
                    <h2 key={i} className="mt-3 font-display text-[19px] font-medium tracking-tight text-site-fg">
                      {bloque.texto}
                    </h2>
                  );
                }
                if (bloque.tipo === "ul") {
                  return (
                    <ul key={i} className="flex flex-col gap-2">
                      {bloque.items.map((item) => (
                        <li key={item} className="flex items-start gap-2.5 text-[14.5px] leading-relaxed text-site-fg/90">
                          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-site-primary" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  );
                }
                return (
                  <p key={i} className="text-[14.5px] leading-relaxed text-site-fg/90">
                    {bloque.texto}
                  </p>
                );
              })}
            </div>
          </div>
        </article>

        <ServiceRelated items={[articulo.servicioRelacionado, { label: "Ver todos los recursos", href: "/recursos" }]} />
      </main>
      <Footer />
    </div>
  );
}
