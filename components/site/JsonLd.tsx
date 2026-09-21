// Server component -- solo serializa un objeto JSON-LD a un <script>, sin
// interactividad. Se usa una vez por tipo de schema por página (Organization
// + WebSite en el layout raíz, Service/Article/BreadcrumbList en cada
// página que corresponda).
//
// `<` se escapa como < (recomendación de la guía JSON-LD de Next.js): JSON.stringify no sanea HTML, y un texto con "</script>" cerraría
// la etiqueta antes de tiempo. Para un JSON parser el resultado es idéntico (< == "<").
export function JsonLd({ data }: { data: object }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />
  );
}
