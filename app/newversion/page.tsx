import type { Metadata } from "next";
import { NavV2 } from "@/components/site-v2/NavV2";
import { HeroV2 } from "@/components/site-v2/HeroV2";
import { PricingV2 } from "@/components/site-v2/PricingV2";
import { JsonLd } from "@/components/site/JsonLd";
import { breadcrumbSchema } from "@/lib/schema";
import {
  ProblemaSection,
  CapacidadesSection,
  QueAutomatizarSection,
  AntesDespuesSection,
  PlataformaSection,
  CasosSection,
  EnterpriseSection,
  EnterpriseContactSection,
  EmpresaSection,
  FinalCtaSection,
  FooterV2,
} from "@/components/site-v2/SectionsV2";

// V2 pasó de Home principal a preview -- se promovió el diseño oscuro (con
// la información comercial actual) a "/" en su lugar. Este archivo conserva
// exactamente la misma V2 que estuvo en producción, sin ningún cambio de
// contenido, solo de metadata (noindex/nofollow, ruta propia en el
// breadcrumb) para que siga existiendo como revisión, no pública.
export const metadata: Metadata = {
  title: "DuLabs — V2 (revisión)",
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
  alternates: { canonical: undefined },
};

export default function V2HomePreview() {
  return (
    <div className="v2-scope relative min-h-screen">
      <JsonLd data={breadcrumbSchema([{ name: "Inicio", path: "/newversion" }])} />
      <NavV2 />
      <main>
        {/* 01 · Hero */}
        <HeroV2 />
        {/* 02 · Problema */}
        <ProblemaSection />
        {/* 03 · Capacidades (3 pilares) */}
        <CapacidadesSection />
        {/* 03b · Qué quieres automatizar */}
        <QueAutomatizarSection />
        {/* 03c · Antes / Después */}
        <AntesDespuesSection />
        {/* 04 · Plataforma / Producto */}
        <PlataformaSection />
        {/* 05 · Casos */}
        <CasosSection />
        {/* 06 · DuLabs Custom */}
        <EnterpriseSection />
        {/* 06b · Contacto Enterprise (formulario real, /api/enterprise/contacto) */}
        <EnterpriseContactSection />
        {/* 07 · Pricing */}
        <PricingV2 />
        {/* 08 · Empresa */}
        <EmpresaSection />
        {/* 09 · CTA final */}
        <FinalCtaSection />
      </main>
      <FooterV2 />
    </div>
  );
}
