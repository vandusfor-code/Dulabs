import { HomeSection, SectionHeader } from "./atoms";

// Cómo trabajamos (proyectos a medida): una línea de tiempo vertical. Cada paso se activa al cruzar el centro del viewport y la línea
// avanza hasta él (ScrollFx: data-fx-grupo, --fx-progreso); el punto activo lleva el único acento azul. Los pasos y sus textos son los que
// el sitio ya publica (components/site/EnterpriseSections, HowWeWorkSection).
const PASOS = [
  { n: "01", titulo: "Entendemos", texto: "Conocemos tu negocio, procesos y objetivo." },
  { n: "02", titulo: "Diseñamos", texto: "Definimos la solución y la experiencia." },
  { n: "03", titulo: "Desarrollamos", texto: "Construimos e integramos la tecnología." },
  { n: "04", titulo: "Implementamos", texto: "Ponemos la solución en funcionamiento y te acompañamos." },
] as const;

export function WorkProcessSection() {
  return (
    <HomeSection id="como-trabajamos" titleId="como-trabajamos-titulo">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20 xl:gap-28">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHeader eyebrow="Cómo trabajamos" titleId="como-trabajamos-titulo" title="De la idea a una solución funcionando.">
            <p>Así llevamos los proyectos a medida. El tiempo depende del alcance de cada proyecto.</p>
          </SectionHeader>
        </div>

        <ol data-fx-grupo className="home-linea relative">
          {PASOS.map((p, i) => (
            <li key={p.n} data-fx-i={i} className="home-linea-paso">
              <span aria-hidden data-fx-disparador className="absolute left-0 top-2" />
              <span aria-hidden className="home-linea-punto" />
              <p className="font-mono text-[11px] tracking-[0.16em] text-site-muted-fg">{p.n}</p>
              <h3 className="home-linea-titulo">{p.titulo}</h3>
              <p className="mt-2 max-w-[30rem] text-[15px] leading-relaxed text-site-muted-fg md:text-[16px]">{p.texto}</p>
            </li>
          ))}
        </ol>
      </div>
    </HomeSection>
  );
}
