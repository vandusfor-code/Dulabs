"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Users, Search, Cake } from "lucide-react";
import { useAdminWeb } from "@/components/admin-web/AdminWebContext";
import { AdminOnlyDesktop } from "@/components/admin-web/AdminOnlyDesktop";
import { inicialesDe, formatearFechaCorta } from "@/components/spa-panel/format";
import { filtrarClientes } from "@/components/spa-panel/filtrar-clientes";
import { RUTA_CLIENTES } from "@/components/admin-web/admin-web-routes";

type ClienteVista = {
  id: number;
  nombre: string;
  telefono: string;
  correo: string | null;
  fechaRegistro: string;
  cumpleDia: number | null;
  cumpleMes: number | null;
  citasRegistradas: number;
  ultimaCita: string | null;
};

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function formatearCumpleanos(dia: number | null, mes: number | null): string | null {
  if (!dia || !mes) return null;
  return `${dia} de ${MESES_CORTOS[mes - 1]}`;
}

// Panel web AMORE (autorizado) — Clientes desktop: MISMO endpoint que ya
// usa el móvil (AmoreClientesScreen.tsx), solo en tabla. Admin-only.
export default function AdminAmoreClientesPage() {
  return (
    <AdminOnlyDesktop>
      <ClientesContenido />
    </AdminOnlyDesktop>
  );
}

function ClientesContenido() {
  const { token } = useAdminWeb();
  const router = useRouter();
  const [clientes, setClientes] = useState<ClienteVista[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    fetch(`/api/agenda/${token}/clientes`)
      .then((r) => r.json())
      .then((body) => (body.error ? setError(body.error) : setClientes(body.clientes)))
      .catch(() => setError("No se pudieron cargar los clientes"));
  }, [token]);

  const filtrados = useMemo(() => (clientes ? filtrarClientes(clientes, busqueda) : null), [clientes, busqueda]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Clientes</h1>
        <p className="text-sm text-mist">Todas las personas que han agendado con AMORE</p>
      </div>

      {clientes && clientes.length > 0 && (
        <label className="flex max-w-md items-center gap-2.5 rounded-xl border border-edge bg-card px-4 py-2.5">
          <Search className="size-4 shrink-0 text-mist" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o WhatsApp..."
            className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-mist"
          />
        </label>
      )}

      {error && <p className="text-sm text-danger-text">{error}</p>}

      <div className="rounded-2xl border border-edge bg-card shadow-sm">
        {!clientes && !error ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-5 animate-spin text-mist" />
          </div>
        ) : clientes && clientes.length === 0 ? (
          <div className="flex flex-col items-center py-16">
            <Users className="size-6 text-mist" />
            <p className="mt-2 text-sm text-mist">Todavía no tienes clientes registrados.</p>
          </div>
        ) : filtrados && filtrados.length === 0 ? (
          <p className="py-10 text-center text-sm text-mist">Ningún cliente coincide con &quot;{busqueda}&quot;.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-mist">
                <th className="px-5 py-3 font-medium">Nombre</th>
                <th className="px-5 py-3 font-medium">WhatsApp</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Cumpleaños</th>
                <th className="px-5 py-3 font-medium">Citas</th>
                <th className="px-5 py-3 font-medium">Última cita</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {filtrados?.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => router.push(`${RUTA_CLIENTES}/${c.id}`)}
                  className="cursor-pointer hover:bg-ink-2"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-lime-soft text-[11px] font-semibold text-lime-text">
                        {inicialesDe(c.nombre)}
                      </div>
                      <span className="font-medium text-fg">{c.nombre}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-fg">{c.telefono}</td>
                  <td className="px-5 py-3 text-fg">{c.correo ?? "—"}</td>
                  <td className="px-5 py-3 text-fg">
                    {formatearCumpleanos(c.cumpleDia, c.cumpleMes) ? (
                      <span className="flex items-center gap-1">
                        <Cake className="size-3.5 text-mist" /> {formatearCumpleanos(c.cumpleDia, c.cumpleMes)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-5 py-3 text-fg">{c.citasRegistradas}</td>
                  <td className="px-5 py-3 text-fg">{c.ultimaCita ? formatearFechaCorta(c.ultimaCita) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
