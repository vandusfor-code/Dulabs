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

// Fase 6.3 -- promoción LOCAL de V2 a Home principal. Sin metadata propia:
// hereda a propósito el title/description/OpenGraph/Twitter/canonical ya
// auditados de app/layout.tsx (indexables, sin noindex) -- nunca la
// metadata experimental de /newversion (esa sí es noindex/nofollow y debe
// seguir siéndolo mientras esa ruta exista como preview).
export default function Home() {
  return (
    <div className="v2-scope relative min-h-screen">
      {/* Organization + WebSite ya se publican una sola vez en el layout raíz
          -- acá solo se agrega el Breadcrumb de esta página, apuntando a "/"
          ahora que esta es la Home real (antes vivía en /newversion con
          path: "/newversion"). Sin duplicados: ese archivo sigue existiendo
          pero renderiza su propia instancia de la misma página en su propia
          ruta, cada una con su propio breadcrumb de un solo nodo. */}
      <JsonLd data={breadcrumbSchema([{ name: "Inicio", path: "/" }])} />
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
