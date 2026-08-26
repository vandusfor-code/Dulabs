import type { Metadata } from "next";
import { Nav } from "@/components/site/Nav";
import { PageSpotlight } from "@/components/site/PageSpotlight";
import { Reveal } from "@/components/site/Reveal";
import { JsonLd } from "@/components/site/JsonLd";
import { breadcrumbSchema, serviceSchema } from "@/lib/schema";
import { ServiceHero, ServiceCapabilities, ServiceCallout, ServiceRelated } from "@/components/site/ServicePage";
import { Footer } from "@/components/site/Sections";
import { whatsappVentasUrl } from "@/lib/site-contact";

export const metadata: Metadata = {
  title: "Integraciones y conexiones entre sistemas | DuLabs",
  description:
    "Conectamos tus herramientas mediante APIs y automatizaciones para que la información fluya entre sistemas, sin procesos manuales repetidos.",
  alternates: { canonical: "https://www.dulabs.co/integraciones" },
};

const TECNOLOGIAS = ["WhatsApp Business Platform", "Meta Cloud API", "Supabase", "Claude (Anthropic)", "APIs REST"];

const CAPACIDADES = [
  "Conexión entre tu WhatsApp Business y tu CRM u otras herramientas.",
  "Automatización de flujos entre sistemas que hoy no se hablan entre sí.",
  "Sincronización de datos para que no tengas que digitarlos dos veces.",
  "APIs a medida cuando necesitas conectar un sistema propio o de terceros.",
  "Webhooks y eventos en tiempo real entre las plataformas que usa tu empresa.",
];

export default function IntegracionesPage() {
  return (
    <div className="relative min-h-screen bg-site-bg text-site-fg">
      <div className="site-grain" aria-hidden />
      <JsonLd
        data={breadcrumbSchema([
          { name: "Inicio", path: "/" },
          { name: "Integraciones", path: "/integraciones" },
        ])}
      />
      <JsonLd
        data={serviceSchema({
          name: "Integraciones y conexiones entre sistemas",
          description: "Conexión de herramientas empresariales mediante APIs y automatizaciones.",
          path: "/integraciones",
        })}
      />
      <PageSpotlight />
      <Nav />
      <main>
        <ServiceHero
          breadcrumb={[{ label: "Inicio", href: "/" }, { label: "Integraciones" }]}
          eyebrow="Integraciones"
          title="Integraciones y conexiones entre sistemas"
          description="Conectamos las herramientas que usa tu empresa mediante APIs y automatizaciones, para que la información fluya entre sistemas sin depender de procesos manuales."
          ctaLabel="Hablar sobre mi proyecto"
          ctaHref={whatsappVentasUrl("Hola, quiero hablar sobre una integración con DuLabs.")}
          ctaExternal
        />

        <Reveal>
          <ServiceCapabilities title="Qué podemos conectar" items={CAPACIDADES} />
        </Reveal>

        <section className="relative border-t border-site-border py-16">
          <div className="mx-auto max-w-[1440px] px-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">Tecnologías que ya usamos</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {TECNOLOGIAS.map((t) => (
                <span key={t} className="rounded-full border border-site-border bg-black/20 px-3 py-1.5 font-mono text-[11px] text-site-muted-fg">
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-4 max-w-2xl text-[12.5px] leading-relaxed text-site-muted-fg">
              Para cada proyecto evaluamos qué herramientas usa tu empresa y las conectamos mediante API. No
              afirmamos integraciones oficiales con plataformas que no hayamos implementado realmente.
            </p>
          </div>
        </section>

        <ServiceCallout>
          Cada integración se diseña según lo que tu empresa usa hoy — no vendemos una lista fija de conectores, sino
          la capacidad de conectar lo que realmente necesitas.
        </ServiceCallout>

        <ServiceRelated
          items={[
            { label: "CRM personalizado", href: "/crm-personalizado" },
            { label: "Software a medida", href: "/software-a-medida" },
            { label: "Automatización de procesos", href: "/automatizacion-empresas" },
          ]}
        />
      </main>
      <Footer />
    </div>
  );
}
