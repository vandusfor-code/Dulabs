const navLinks = [
  { label: "Productos", href: "#productos" },
  { label: "Soluciones", href: "#soluciones" },
  { label: "Tecnología", href: "#tecnologia" },
  { label: "Nosotros", href: "#nosotros" },
];

export default function Header() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-edge/60 bg-ink/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a href="#" className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-lime text-[11px] font-bold tracking-tight text-ink">
            DU
          </span>
          <span className="text-sm font-semibold tracking-[0.18em] text-white">
            DU LABS
          </span>
        </a>

        <nav className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-mist transition-colors duration-200 hover:text-white"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <a
            href="#contacto"
            className="hidden rounded-lg border border-edge px-4 py-2 text-sm text-mist transition-colors duration-200 hover:border-mist/40 hover:text-white sm:block"
          >
            Contactar
          </a>
          <a
            href="#contacto"
            className="rounded-lg bg-lime px-4 py-2 text-sm font-semibold text-ink transition-colors duration-200 hover:bg-lime-hover"
          >
            Solicitar demo
          </a>
        </div>
      </div>
    </header>
  );
}
