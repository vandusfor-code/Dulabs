// Server component -- solo serializa un objeto JSON-LD a un <script>, sin
// interactividad. Se usa una vez por tipo de schema por página (Organization
// + WebSite en el layout raíz, Service/Article/BreadcrumbList en cada
// página que corresponda).
export function JsonLd({ data }: { data: object }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
  );
}
