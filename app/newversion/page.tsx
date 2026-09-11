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

// Versión de revisión del rediseño (DuLabs V2), servida en /newversion.
// NO debe indexarse ni reemplazar la home hasta autorización explícita de
// migración. noindex/nofollow para que Google no la indexe antes de aprobar.
export const metadata: Metadata = {
  title: "DuLabs — Nueva versión (revisión)",
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
  alternates: { canonical: undefined },
};

export default function V2Home() {
  return (
    <div className="v2-scope relative min-h-screen">
      {/* Organization + WebSite ya se publican una sola vez en el layout raíz
          (app/layout.tsx) -- acá solo se agrega el Breadcrumb específico de
          esta página, para no duplicar los schemas globales. El path queda
          en "/newversion" mientras sigue siendo la vista de revisión; debe
          actualizarse a "/" el día que se promueva (ver lista de cambios
          pendientes del swap). */}
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
