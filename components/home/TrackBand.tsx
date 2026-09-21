// Banda que separa las DOS líneas de DuLabs a lo largo de la página: 01 Crea tu agente (agente estándar: el cliente lo configura solo) y 02 A la
// medida (automatización, integraciones y soluciones personalizadas con el equipo). Es el mismo par que aparece en el hero.
export function TrackBand({ n, etiqueta, texto }: { n: string; etiqueta: string; texto: string }) {
  return (
    <div className="border-t border-site-border bg-site-surface">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
        <p className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-site-fg">
          <span className="text-site-muted-fg">{n}</span>
          {etiqueta}
        </p>
        <p className="text-[13px] leading-snug text-site-muted-fg">{texto}</p>
      </div>
    </div>
  );
}
