import Reveal from "./Reveal";

type Product = {
  name: string;
  tag: string;
  title: string;
  description: string;
  features: string[];
  footnote?: string;
  cta: string;
};

const products: Product[] = [
  {
    name: "Du Life",
    tag: "Personas",
    title: "Tu segundo cerebro en WhatsApp.",
    description:
      "Du Life es un asistente personal impulsado por inteligencia artificial que vive completamente dentro de WhatsApp. Todo mediante conversaciones naturales. Sin aplicaciones adicionales. Sin configuraciones complejas.",
    features: [
      "Finanzas, gastos e ingresos",
      "Préstamos",
      "Tareas e ideas",
      "Recordatorios",
      "Pequeños negocios",
      "Bienestar personal",
    ],
    cta: "Conocer Du Life",
  },
  {
    name: "Du Academy",
    tag: "Equipos",
    title: "Capacitación y acompañamiento donde ya trabaja tu equipo.",
    description:
      "Du Academy convierte WhatsApp en una plataforma de aprendizaje continuo para organizaciones. Formación, retroalimentación y conocimiento organizacional, todo desde WhatsApp.",
    features: [
      "Consultas en tiempo real",
      "Formación diaria",
      "Auditorías",
      "Retroalimentación",
      "Métricas personales",
      "Conocimiento organizacional",
    ],
    cta: "Conocer Du Academy",
  },
  {
    name: "Du IA Business",
    tag: "Empresas",
    title: "Automatiza tu empresa desde las conversaciones.",
    description:
      "Du IA Business transforma WhatsApp en el centro de operaciones de tu empresa: atención, ventas, soporte, agenda y seguimiento comercial con automatizaciones e integraciones empresariales.",
    features: [
      "Atención al cliente y soporte",
      "Ventas y seguimiento comercial",
      "Agenda y recordatorios",
      "Automatizaciones",
      "Integraciones empresariales",
    ],
    footnote:
      "Compatible con WhatsApp Business, Cloud API, coexistencia, CRM, ERP y Google Workspace.",
    cta: "Conocer Du IA Business",
  },
];

export default function Products() {
  return (
    <section id="productos" className="scroll-mt-20 py-28">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal className="mb-16 max-w-2xl">
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.25em] text-lime">
            Productos
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">
            Un ecosistema de productos conversacionales.
          </h2>
        </Reveal>

        <div className="flex flex-col gap-8">
          {products.map((product, i) => (
            <Reveal key={product.name} delay={i * 100}>
              <article className="group grid gap-10 rounded-3xl border border-edge bg-card/60 p-8 transition-colors duration-300 hover:border-lime/25 sm:p-12 lg:grid-cols-[1.2fr_1fr]">
                <div>
                  <div className="mb-6 flex items-center gap-3">
                    <span className="rounded-full bg-lime/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-lime">
                      {product.tag}
                    </span>
                    <span className="text-sm font-medium text-mist">
                      {product.name}
                    </span>
                  </div>
                  <h3 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                    {product.title}
                  </h3>
                  <p className="mt-5 leading-relaxed text-mist">
                    {product.description}
                  </p>
                  {product.footnote && (
                    <p className="mt-4 text-sm text-mist/70">
                      {product.footnote}
                    </p>
                  )}
                  <a
                    href="#contacto"
                    className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-lime transition-colors duration-200 hover:text-lime-hover"
                  >
                    {product.cta}
                    <span className="transition-transform duration-200 group-hover:translate-x-1">
                      →
                    </span>
                  </a>
                </div>
                <ul className="grid content-center gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  {product.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-center gap-3 rounded-xl border border-edge/70 bg-ink-2/60 px-4 py-3 text-sm text-white/85"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
