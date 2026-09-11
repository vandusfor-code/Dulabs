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

// Preview aislado del rediseño (DuLabs V2). NO debe indexarse ni aparecer
// públicamente como la home hasta que se apruebe la migración (regla 53/54).
export const metadata: Metadata = {
  title: "DuLabs V2 — Preview",
  robots: { index: false, follow: false },
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
