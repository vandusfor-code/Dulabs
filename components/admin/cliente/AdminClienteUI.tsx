"use client";

// F15.2 (Operations Center, cierre) -- helpers visuales compartidos por
// todas las secciones de /admin/clientes/[idTenant] (tanto las que ya
// vivían ahí desde F15/F15.1 como las portadas del admin legacy eliminado
// esta fase, app/dashboard/admin/clientes/[idTenant]/page.tsx). Antes vivían
// duplicados (un `Seccion`/`Boton` local en cada página) -- un solo punto
// evita que las dos copias diverjan visualmente otra vez.

export function Seccion({ titulo, children, accion }: { titulo: string; children: React.ReactNode; accion?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-edge bg-card p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-fg">{titulo}</h2>
        {accion}
      </div>
      {children}
    </section>
  );
}

export function Boton({
  onClick,
  children,
  variante = "default",
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  variante?: "default" | "peligro";
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        variante === "peligro" ? "border-red-500/40 text-red-400 hover:bg-red-500/10" : "border-edge text-fg hover:bg-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function Bloque({ label, texto }: { label: string; texto: string | null }) {
  return (
    <div>
      <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{label}</p>
      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-fg">{texto || "—"}</p>
    </div>
  );
}

export function fechaLarga(fecha: string | null): string {
  if (!fecha) return "—";
  return new Date(fecha).toLocaleString("es-CO", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
