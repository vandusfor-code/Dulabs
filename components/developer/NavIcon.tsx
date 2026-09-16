// DuLabs Developer V1 -- Fase 9. Set mínimo de iconos inline (16px), sin
// dependencia externa de iconos. Presentacional.

const PATHS: Record<string, string> = {
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  flow: "M4 4h6v6H4zM14 14h6v6h-6zM10 7h4M16 10v4",
  code: "M8 6l-5 6 5 6M16 6l5 6-5 6",
  phone: "M6 3h12v18H6zM10 18h4",
  webhook: "M12 8a4 4 0 10-3.5 6M12 8l3 6h5M9 20a3 3 0 100-6",
  logs: "M4 6h16M4 12h16M4 18h10",
  gauge: "M12 13a1 1 0 100-2 1 1 0 000 2zM12 13l4-4M4 18a8 8 0 1116 0",
  key: "M14 7a3 3 0 11-2.83 4H8v2H6v2H3v-3l5.17-5.17A3 3 0 0114 7z",
  users: "M9 11a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M16 11a3 3 0 10-1-5.83M21 20a6 6 0 00-4-5.65",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l1.5 1-1 2-1.8-.3-1.2 1.4.3 1.8-2 1-1.3-1.3h-1.6L10 20l-2-1 .3-1.8-1.2-1.4-1.8.3-1-2L5.5 12 4 11l1-2 1.8.3L8 7.9 7.7 6l2-1L11 6.3h1.6L14 4l2 1-.3 1.8 1.2 1.4 1.8-.3 1 2L19 12z",
};

export function NavIcon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name] ?? PATHS.grid} />
    </svg>
  );
}
