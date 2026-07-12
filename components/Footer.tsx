const columns = [
  {
    title: "Productos",
    links: ["Du Life", "Du Academy", "Du IA Business"],
  },
  {
    title: "Empresa",
    links: ["Nosotros", "Tecnología", "Contacto"],
  },
  {
    title: "Legal",
    links: ["Privacidad", "Términos"],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-edge/60 bg-ink-2/50">
      <div className="mx-auto max-w-6xl px-6 py-16">
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
          </div>
          {columns.map((column) => (
            <div key={column.title}>
              <h3 className="text-sm font-semibold text-white">
                {column.title}
              </h3>
              <ul className="mt-4 flex flex-col gap-3">
                {column.links.map((link) => (
                  <li key={link}>
                    <a
                      href="#"
                      className="text-sm text-mist transition-colors duration-200 hover:text-white"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-edge/60 pt-8">
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
