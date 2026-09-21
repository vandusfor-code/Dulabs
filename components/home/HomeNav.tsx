import Image from "next/image";
import Link from "next/link";
import { CREAR_AGENTE_HREF, HABLAR_CON_DULABS_HREF, HOME_NAV_LINKS, LOGIN_HREF } from "@/lib/home/links";
import { Contenedor } from "./atoms";
import { HomeMobileMenu } from "./HomeMobileMenu";
import { TrackedLink } from "./TrackedLink";

// Navbar de la home. Servidor: sin JS salvo la isla del menú móvil y los enlaces con tracking. Sticky (en flujo, sin padding-top
// compensatorio ni saltos de layout). Usa el contenedor más amplio de la home (el mismo del hero) para que logo, enlaces y acciones se
// repartan de forma natural en pantallas grandes en vez de quedar apretados en una columna central. El logo se muestra tal cual.
export function HomeNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-site-border bg-site-bg/85 backdrop-blur-md">
      <Contenedor ancho="hero" className="relative flex h-16 items-center justify-between gap-6 xl:h-[72px]">
        <Link href="/" aria-label="DuLabs, ir al inicio" className="flex min-h-11 items-center gap-2.5 text-[15px] font-medium tracking-tight text-site-fg xl:text-[16px]">
          <Image src="/logo.png" alt="" width={26} height={26} priority className="rounded-full" />
          DuLabs
        </Link>

        <nav aria-label="Principal" className="hidden items-center gap-7 lg:flex xl:gap-10">
          {HOME_NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="inline-flex min-h-10 items-center text-[13.5px] text-site-muted-fg transition-colors hover:text-site-fg xl:text-[14px]">
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-5 lg:flex xl:gap-7">
          <Link href={LOGIN_HREF} className="inline-flex min-h-10 items-center text-[13.5px] text-site-muted-fg transition-colors hover:text-site-fg xl:text-[14px]">
            Iniciar sesión
          </Link>
          <TrackedLink
            href={CREAR_AGENTE_HREF}
            event="cta_crear_agente"
            source="nav"
            className="inline-flex h-10 items-center rounded-lg bg-dev-accent px-4 text-[13.5px] font-medium text-dev-accent-fg transition-colors hover:bg-dev-accent-hover xl:px-5 xl:text-[14px]"
          >
            Crear mi agente
          </TrackedLink>
        </div>

        <HomeMobileMenu links={HOME_NAV_LINKS} crearAgenteHref={CREAR_AGENTE_HREF} hablarHref={HABLAR_CON_DULABS_HREF} loginHref={LOGIN_HREF} />
      </Contenedor>
    </header>
  );
}
