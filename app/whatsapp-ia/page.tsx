import type { Metadata } from "next";
import { Nav } from "@/components/site/Nav";
import { PageSpotlight } from "@/components/site/PageSpotlight";
import { Reveal } from "@/components/site/Reveal";
import { JsonLd } from "@/components/site/JsonLd";
import { breadcrumbSchema, serviceSchema } from "@/lib/schema";
import { ServiceHero, ServiceCapabilities, ServiceCallout, ServiceRelated } from "@/components/site/ServicePage";
import { FaqSection, Footer } from "@/components/site/Sections";
import { whatsappVentasUrl, MENSAJE_WHATSAPP_GENERICO_ES } from "@/lib/site-contact";

export const metadata: Metadata = {
  title: "WhatsApp con IA para empresas | DuLabs",
  description:
    "Configuramos y personalizamos un asistente de WhatsApp con IA sobre la API Oficial de Meta: atención automática, agendamiento, campañas e integraciones. Nos cuentas tu negocio, nosotros lo configuramos.",
  alternates: { canonical: "https://www.dulabs.co/whatsapp-ia" },
};

const CAPACIDADES = [
  "Atención automática en tu WhatsApp Business, disponible todo el día.",
  "Respuestas con IA entrenada específicamente para tu negocio.",
  "Base de conocimiento con tus precios, horarios, productos y políticas.",
  "Personalidad del agente ajustada al tono con el que quieres atender.",
  "Catálogo de tus servicios y productos disponible para el asistente.",
  "Agendamiento de citas directo por WhatsApp, sin ida y vuelta manual.",
  "Automatizaciones: recordatorios, confirmaciones y seguimiento.",
  "Campañas y plantillas aprobadas por Meta para avisos y promociones.",
  "Integraciones con tu CRM u otras herramientas cuando el proyecto lo requiere.",
  "Escalamiento a una persona real cuando la conversación lo necesita.",
];

export default function WhatsappIaPage() {
  return (
    <div className="relative min-h-screen bg-site-bg text-site-fg">
      <div className="site-grain" aria-hidden />
      <JsonLd
        data={breadcrumbSchema([
          { name: "Inicio", path: "/" },
          { name: "WhatsApp con IA", path: "/whatsapp-ia" },
        ])}
      />
      <JsonLd
        data={serviceSchema({
          name: "WhatsApp con IA para empresas",
          description:
            "Configuración y personalización de asistentes de WhatsApp con IA sobre la API Oficial de WhatsApp Business (Meta Cloud API).",
          path: "/whatsapp-ia",
        })}
      />
      <PageSpotlight />
      <Nav />
      <main>
        <ServiceHero
          breadcrumb={[{ label: "Inicio", href: "/" }, { label: "WhatsApp con IA" }]}
          eyebrow="WhatsApp con IA"
          title="WhatsApp con IA para empresas"
          description="Convertimos tu WhatsApp Business en un asistente con inteligencia artificial, configurado sobre la infraestructura oficial de Meta. No tienes que programar ni configurar nada: nos cuentas cómo funciona tu negocio y nosotros configuramos el asistente."
          ctaLabel="Configurar mi WhatsApp con IA"
          ctaHref={whatsappVentasUrl(MENSAJE_WHATSAPP_GENERICO_ES)}
          ctaExternal
        />

        <Reveal>
          <ServiceCapabilities title="Qué incluye" desc="Todo corre sobre la API Oficial de WhatsApp Business (Meta Cloud API) — sin hacks no oficiales, sin riesgo de baneo." items={CAPACIDADES} />
        </Reveal>

        <ServiceCallout>
          Nos cuentas cómo funciona tu negocio y nosotros configuramos el asistente: conectamos tu número, escribimos las
          instrucciones de tu IA y probamos que responda bien antes de activarla.
        </ServiceCallout>

        <Reveal>
          <FaqSection ids={["conexion", "quien-configura", "control", "masivos", "meta-cobra"]} />
        </Reveal>

        <ServiceRelated
          items={[
            { label: "Ver planes y precios", href: "/precios" },
            { label: "Automatización de procesos", href: "/automatizacion-empresas" },
            { label: "Integraciones", href: "/integraciones" },
          ]}
        />
      </main>
      <Footer />
    </div>
  );
}
