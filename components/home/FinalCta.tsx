import { CREAR_AGENTE_HREF, HABLAR_CON_DULABS_HREF } from "@/lib/home/links";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, HomeSection } from "./atoms";
import { TrackedLink } from "./TrackedLink";

// Cierre corto y fuerte: una frase y las dos vías de trabajo con DuLabs (crear tu agente / hablar con el equipo), con los mismos destinos del hero.
export function FinalCta() {
  return (
    <HomeSection id="empezar" titleId="empezar-titulo">
      <div className="mx-auto max-w-[56rem] text-center">
        <h2 id="empezar-titulo" className="text-balance text-[32px] font-medium leading-[1.06] tracking-[-0.03em] text-site-fg sm:text-[42px] lg:text-[52px] 2xl:text-[60px]">
          Tu negocio ya tiene procesos.{" "}
          <br className="hidden sm:block" />
          <span className="text-site-muted-fg">Ahora pueden trabajar automáticamente.</span>
        </h2>

        <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <TrackedLink href={CREAR_AGENTE_HREF} event="cta_crear_agente" source="cierre" className={BOTON_PRIMARIO}>
            Crea tu agente
            <span aria-hidden>→</span>
          </TrackedLink>
          <TrackedLink href={HABLAR_CON_DULABS_HREF} event="cta_whatsapp" source="cierre" className={BOTON_SECUNDARIO}>
            Hablar con DuLabs
          </TrackedLink>
        </div>
      </div>
    </HomeSection>
  );
}
