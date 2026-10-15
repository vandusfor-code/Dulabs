/**
 * PÁGINA «Mayoristas» del tema "joyeria" (/catalogo/{tienda}/mayoristas): a donde lleva el acceso «Mayorista» de la cabecera, el menú y el pie. Una página completa, no un ancla hacia el final del inicio:
 * portada oscura con el título y la introducción; las preguntas frecuentes; y un cierre con el botón de WhatsApp.
 *
 * Todo lo que dice sale de lo PUBLICADO en el CMS (tema «Mayoristas», más las entradas que la tienda enlaza por su código: envíos, pagos, garantías y cambios) con las mismas reglas que ARIA;
 * aquí solo se dibuja. Nada inventado y ningún bloque vacío: sin preguntas publicadas no hay sección de preguntas ni el enlace a ella, y sin introducción se usa la frase de la tienda. El botón
 * abre WhatsApp con el mensaje escrito (el mismo del bloque del inicio). Nunca aparece un precio ni un enlace mayorista que no esté en lo publicado: el catálogo mayorista solo lo da una asesora.
 * Server Component (el video de fondo es el único componente de cliente).
 */
import { ChevronDown, MessageCircle } from "lucide-react";
import { VideoSeccion } from "@/components/catalogo-publico/tienda/joyeria/VideoJoyeria";
import { Destellos, EncabezadoSeccion, EnlaceJoyeria } from "@/components/catalogo-publico/tienda/joyeria/piezas";
import type { MayoristasVisible } from "@/lib/catalogo/joyeria";
import { parrafosDe, type PaginaMayoristas } from "@/lib/cms-comercial/pagina-mayoristas";

const BOTON_CRISTAL = "joy-cristal inline-flex h-12 items-center justify-center gap-2 rounded-lg px-8 text-base font-medium tracking-[0.1em] active:scale-[0.98]";

/** Filete dorado con rombo, el mismo del bloque de mayoristas del inicio. */
function Ornamento() {
  return (
    <div className="mx-auto mt-5 flex items-center justify-center gap-3" aria-hidden>
      <span className="h-px w-10 bg-[var(--joy-oro)]" />
      <span className="text-[10px] text-[var(--joy-oro)]">◆</span>
      <span className="h-px w-10 bg-[var(--joy-oro)]" />
    </div>
  );
}

export function PaginaMayoristasJoyeria({ m, pagina }: { m: MayoristasVisible; pagina: PaginaMayoristas | null }) {
  const preguntas = pagina?.preguntas ?? [];
  // Sin introducción publicada, la frase de la tienda («Escríbenos por WhatsApp y una asesora te atiende.»).
  const introduccion = pagina?.intro ? parrafosDe(pagina.intro.texto) : [m.texto];
  const color = m.video ? "text-white" : "text-[var(--joy-oro-claro)]";

  return (
    <div className="joy-compensa">
      <section aria-labelledby="joy-may-titulo" className="joy-mayoristas joy-may-portada relative isolate overflow-hidden px-6 py-16 text-center md:py-24">
        {m.video && <VideoSeccion video={m.video} control="icono" className="-z-30" />}
        {m.video && <div className="joy-mayoristas-velo pointer-events-none absolute inset-0 -z-20" aria-hidden />}
        <div className="joy-mayoristas-fondo pointer-events-none absolute inset-0 -z-10" aria-hidden />
        <Destellos className="-z-10" />
        <div className="relative mx-auto w-full max-w-3xl">
          <p className={`text-[11px] font-medium uppercase tracking-[0.34em] ${color}`}>{m.etiqueta}</p>
          <h1 id="joy-may-titulo" className="font-serif-tienda mt-3 text-[clamp(2.4rem,7vw,4.25rem)] font-medium leading-[1.04] text-[#faf8f5]">
            {m.titulo}
          </h1>
          <Ornamento />
          <div className="mx-auto mt-6 max-w-xl space-y-3 text-base leading-relaxed text-white/90 md:text-lg">
            {introduccion.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-6">
            <EnlaceJoyeria href={m.href} className={BOTON_CRISTAL}>
              <MessageCircle className="size-4" strokeWidth={1.8} aria-hidden />
              {m.boton}
            </EnlaceJoyeria>
            {preguntas.length > 0 && (
              <a href="#preguntas" className="joy-enlace-subrayado inline-flex h-12 items-center text-sm tracking-[0.08em] text-white">
                Ver preguntas frecuentes
              </a>
            )}
          </div>
        </div>
      </section>

      {preguntas.length > 0 && (
        <section id="preguntas" aria-labelledby="joy-may-preguntas" className="joy-ancla bg-ink py-16 md:py-24">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <EncabezadoSeccion etiqueta="Antes de escribirnos" titulo="Preguntas frecuentes" id="joy-may-preguntas" />
            <ul className="joy-preguntas" role="list">
              {preguntas.map((p) => (
                <li key={p.clave}>
                  <details className="joy-pregunta" name="joy-preguntas-mayoristas">
                    <summary className="joy-pregunta-resumen">
                      <span className="font-serif-tienda text-[19px] font-medium leading-snug text-fg md:text-[21px]">{p.titulo}</span>
                      <ChevronDown className="joy-pregunta-flecha size-5 text-[var(--tienda-oro)]" strokeWidth={1.6} aria-hidden />
                    </summary>
                    <div className="joy-pregunta-texto space-y-3 text-[15px] leading-relaxed text-mist md:text-base">
                      {parrafosDe(p.texto).map((t, i) => (
                        <p key={i}>{t}</p>
                      ))}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section aria-labelledby="joy-may-cierre" className="joy-mayoristas joy-ancla relative isolate overflow-hidden px-6 py-16 text-center md:py-20">
        <div className="joy-mayoristas-fondo pointer-events-none absolute inset-0 -z-10" aria-hidden />
        <div className="relative mx-auto max-w-2xl">
          <h2 id="joy-may-cierre" className="font-serif-tienda text-[clamp(1.75rem,4.5vw,2.5rem)] font-medium leading-tight text-[#faf8f5]">
            ¿Tienes otra pregunta?
          </h2>
          <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-white/85">Escríbenos por WhatsApp y una asesora te atiende.</p>
          <div className="mt-7">
            <EnlaceJoyeria href={m.href} className={BOTON_CRISTAL}>
              <MessageCircle className="size-4" strokeWidth={1.8} aria-hidden />
              {m.boton}
            </EnlaceJoyeria>
          </div>
        </div>
      </section>
    </div>
  );
}
