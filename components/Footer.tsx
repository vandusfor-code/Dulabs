const columns = [
  {
    title: "Productos",
    links: [
      { label: "Du Life", href: "https://www.dur.life/" },
      { label: "Du Academy", href: "#productos" },
      { label: "Du IA Business", href: "#productos" },
    ],
  },
  {
    title: "Empresa",
    links: [
      { label: "Nosotros", href: "#nosotros" },
      { label: "Tecnología", href: "#tecnologia" },
      { label: "Contacto", href: "#contacto" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacidad", href: "#" },
      { label: "Términos", href: "#" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-edge/60 bg-ink-2/50">
      <div className="mx-auto w-full max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12">
        <div className="grid gap-12 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-lime text-[11px] font-bold tracking-tight text-ink">
                DU
              </span>
              <span className="text-sm font-semibold tracking-[0.18em] text-white">
                DU LABS
              </span>
            </div>
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-mist">
              Construimos productos conversacionales impulsados por
              inteligencia artificial para personas, equipos y empresas.
            </p>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-mist/80">
              Du Life, Du Academy y Du IA Business son marcas creadas y
              operadas bajo el ecosistema Du Labs.
            </p>
          </div>
          {columns.map((column) => (
            <div key={column.title}>
              <h3 className="text-sm font-semibold text-white">
                {column.title}
              </h3>
              <ul className="mt-4 flex flex-col gap-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...(link.href.startsWith("http")
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                      className="text-sm text-mist transition-colors duration-200 hover:text-white"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 grid gap-10 border-t border-edge/60 pt-10 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Responsable del tratamiento de datos y propietario del servicio
            </h3>
            <p className="mt-4 text-sm leading-relaxed text-mist">
              Duvan Andres Ramos Padilla
              <br />
              CR 36 # 47 - 17, Brr. Santa Elena
              <br />
              Montería, Córdoba 230001
              <br />
              Colombia
            </p>
            <p className="mt-4 text-sm leading-relaxed text-mist/80">
              Du Labs es una marca y plataforma digital operada por Duvan
              Andres Ramos Padilla.
            </p>
          </div>
          <div className="md:justify-self-end">
            <h3 className="text-sm font-semibold text-white">Contacto</h3>
            <ul className="mt-4 flex flex-col gap-3 text-sm text-mist">
              <li>
                <a
                  href="mailto:vandusfor@gmail.com"
                  className="transition-colors duration-200 hover:text-white"
                >
                  vandusfor@gmail.com
                </a>
              </li>
              <li>
                <a
                  href="tel:+573148127388"
                  className="transition-colors duration-200 hover:text-white"
                >
                  +57 314 812 7388
                </a>
              </li>
              <li>
                <a
                  href="https://dulabs.co"
                  className="transition-colors duration-200 hover:text-white"
                >
                  dulabs.co
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-edge/60 pt-8">
          <p className="text-xs text-mist/70">
            © {new Date().getFullYear()} Du Labs. Todos los derechos
            reservados.
          </p>
          <p className="text-xs text-mist/70">Hecho en Colombia 🇨🇴</p>
        </div>
      </div>
    </footer>
  );
}
