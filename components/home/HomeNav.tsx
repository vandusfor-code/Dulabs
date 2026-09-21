import Image from "next/image";
import Link from "next/link";
import { CREAR_AGENTE_HREF, HABLAR_CON_DULABS_HREF, HOME_NAV_LINKS, LOGIN_HREF } from "@/lib/home/links";
import { HomeMobileMenu } from "./HomeMobileMenu";
import { TrackedLink } from "./TrackedLink";

// Navbar de la home v3. Servidor: sin JS salvo la isla del menú móvil y los enlaces con tracking. Sticky (en flujo, sin
// padding-top compensatorio ni saltos de layout). El logo se muestra tal cual, sin recolorear.
export function HomeNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-site-border bg-site-bg/85 backdrop-blur-md">
      <div className="relative mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-6 px-5 sm:px-6">
        <Link href="/" aria-label="DuLabs, ir al inicio" className="flex items-center gap-2.5 text-[15px] font-medium tracking-tight text-site-fg">
          <Image src="/logo.png" alt="" width={26} height={26} priority className="rounded-full" />
          DuLabs
        </Link>

        <nav aria-label="Principal" className="hidden items-center gap-7 lg:flex">
          {HOME_NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="text-[13.5px] text-site-muted-fg transition-colors hover:text-site-fg">
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-5 lg:flex">
          <Link href={LOGIN_HREF} className="text-[13.5px] text-site-muted-fg transition-colors hover:text-site-fg">
            Iniciar sesión
          </Link>
          <TrackedLink
            href={CREAR_AGENTE_HREF}
            event="cta_crear_agente"
            source="nav"
            className="inline-flex h-9 items-center rounded-lg bg-home-accent px-4 text-[13.5px] font-medium text-home-accent-fg transition-colors hover:bg-home-accent-hover"
          >
            Crear mi agente
          </TrackedLink>
        </div>

        <HomeMobileMenu links={HOME_NAV_LINKS} crearAgenteHref={CREAR_AGENTE_HREF} hablarHref={HABLAR_CON_DULABS_HREF} loginHref={LOGIN_HREF} />
      </div>
    </header>
  );
}
