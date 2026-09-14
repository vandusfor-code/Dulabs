"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { ORDEN_PLANES_ADMIN, PLANES } from "@/lib/planes";

export default function NuevoClientePage() {
  const { session } = useDashboard();
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [plan, setPlan] = useState("");
  const [activarDeInmediato, setActivarDeInmediato] = useState(false);
  const [observacion, setObservacion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputClass = "w-full rounded-lg border border-edge bg-ink-2 px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50";

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setError(null);
    setEnviando(true);
    try {
      const res = await fetch("/api/dashboard/admin/clientes/nuevo", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre,
          email,
          telefono: telefono || undefined,
          plan: plan || undefined,
          estado_inicial: activarDeInmediato ? "activa" : "sin_plan",
          observacion: observacion || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo crear el cliente");
      router.push(`/admin/clientes/${data.idTenant}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEnviando(false);
    }
  };

  return (
    <div>
      <PageHeader eyebrow="Centro de Operaciones" title="Crear cliente" description="Alta manual. El cliente recibe un correo real de invitación para elegir su propia contraseña." />
      <div className="px-4 py-6 md:max-w-xl md:px-8">
        <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border border-edge bg-card p-6">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-mist">Nombre del negocio</label>
            <input required value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-mist">Email</label>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-mist">Teléfono (opcional)</label>
            <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="573001234567" className={inputClass} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-mist">Plan (opcional -- déjalo vacío si todavía no pagó)</label>
            <select value={plan} onChange={(e) => setPlan(e.target.value)} className={inputClass}>
              <option value="">Sin plan todavía</option>
              {ORDEN_PLANES_ADMIN.filter((p) => PLANES[p].precioCop !== null).map((p) => (
                <option key={p} value={p}>
                  {PLANES[p].nombre} — ${PLANES[p].precioCop?.toLocaleString("es-CO")} COP/mes
                </option>
              ))}
            </select>
          </div>
          {plan && (
            <label className="flex items-center gap-2 text-sm text-fg">
              <input type="checkbox" checked={activarDeInmediato} onChange={(e) => setActivarDeInmediato(e.target.checked)} />
              Activar la suscripción de inmediato (trato ya cerrado/negociado, sin pasar por Wompi)
            </label>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-mist">Observación / motivo (opcional)</label>
            <textarea value={observacion} onChange={(e) => setObservacion(e.target.value)} rows={2} className={inputClass} />
          </div>

          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={enviando}
            className="mt-2 self-start rounded-lg bg-lime px-6 py-2.5 text-sm font-semibold text-lime-fg hover:bg-lime-hover disabled:opacity-50"
          >
            {enviando ? "Creando…" : "Crear cliente"}
          </button>
        </form>
      </div>
    </div>
  );
}
