import type { Metadata } from "next";
import { NavV2 } from "@/components/site-v2/NavV2";
import { HeroV2 } from "@/components/site-v2/HeroV2";
import { PricingV2 } from "@/components/site-v2/PricingV2";
import {
  ProblemaSection,
  CapacidadesSection,
  PlataformaSection,
  CasosSection,
  EnterpriseSection,
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
      <NavV2 />
      <main>
        {/* 01 · Hero */}
        <HeroV2 />
        {/* 02 · Problema */}
        <ProblemaSection />
        {/* 03 · Capacidades */}
        <CapacidadesSection />
        {/* 04 · Plataforma / Producto */}
        <PlataformaSection />
        {/* 05 · Casos */}
        <CasosSection />
        {/* 07 · Pricing */}
        <PricingV2 />
        {/* 06 · Enterprise */}
        <EnterpriseSection />
        {/* 08 · CTA final */}
        <FinalCtaSection />
      </main>
      <FooterV2 />
    </div>
  );
}
