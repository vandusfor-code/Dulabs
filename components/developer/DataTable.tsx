import type { ReactNode } from "react";

// DuLabs Developer V1 -- Fase 9. Tabla de datos técnica, densa y responsive
// (scroll horizontal propio en móvil). Presentacional/genérica. NUNCA
// renderiza HTML crudo: cada celda es texto/JSX controlado por el caller.

export type Columna<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  align?: "left" | "right";
};

export function DataTable<T>({ columns, rows, rowKey, empty }: { columns: Columna<T>[]; rows: T[]; rowKey: (row: T) => string; empty?: ReactNode }) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className="overflow-x-auto rounded-lg border border-edge">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-edge bg-ink-2/50">
            {columns.map((c) => (
              <th key={c.key} className={`px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-mist ${c.align === "right" ? "text-right" : "text-left"}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-edge last:border-0 hover:bg-ink-2/40">
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-3 text-fg ${c.align === "right" ? "text-right" : "text-left"} ${c.className ?? ""}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
