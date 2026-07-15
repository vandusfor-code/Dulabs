"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LayoutTemplate, CircleCheck, Clock, CircleAlert, Plus } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader, Pill } from "@/components/dashboard/shell/ui";

type Plantilla = {
  id: number;
  phone_number_id: string;
  nombre: string;
  categoria: string;
  idioma: string;
  cuerpo: string;
  estado: string;
  created_at: string;
};

const categorias = ["Todas", "MARKETING", "UTILITY", "AUTHENTICATION"] as const;

const estadoInfo: Record<string, { tone: "success" | "warning" | "danger" | "neutral"; label: string; icon: typeof CircleCheck }> = {
  APPROVED: { tone: "success", label: "Aprobada", icon: CircleCheck },
  REJECTED: { tone: "danger", label: "Rechazada", icon: CircleAlert },
  pendiente: { tone: "warning", label: "En revisión", icon: Clock },
  PENDING: { tone: "warning", label: "En revisión", icon: Clock },
};

export default function PlantillasPage() {
  const { session, negocios } = useDashboard();
  const [plantillas, setPlantillas] = useState<Plantilla[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState<(typeof categorias)[number]>("Todas");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [formAbierto, setFormAbierto] = useState(false);

  const [phoneNumberIdElegido, setPhoneNumberIdElegido] = useState("");
  const phoneNumberId = phoneNumberIdElegido || negocios?.[0]?.phone_number_id || "";
  const [nombre, setNombre] = useState("");
  const [categoria, setCategoria] = useState("UTILITY");
  const [cuerpo, setCuerpo] = useState("");
  const [creando, setCreando] = useState(false);
  const [mensajeCrear, setMensajeCrear] = useState<string | null>(null);

  const cargarPlantillas = useCallback(() => {
    if (!session) return;
    fetch("/api/plantillas", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setPlantillas(data.plantillas ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session]);

  useEffect(() => {
    cargarPlantillas();
  }, [cargarPlantillas]);

  const crearPlantilla = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!session) return;
      setCreando(true);
      setMensajeCrear(null);
      try {
        const res = await fetch("/api/plantillas", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ phone_number_id: phoneNumberId, nombre, categoria, cuerpo }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error creando la plantilla");
        setMensajeCrear(`Enviada a revisión de Meta (estado: ${data.estado}).`);
        setNombre("");
        setCuerpo("");
        cargarPlantillas();
      } catch (err) {
        setMensajeCrear(err instanceof Error ? err.message : String(err));
      } finally {
        setCreando(false);
      }
    },
    [session, phoneNumberId, nombre, categoria, cuerpo, cargarPlantillas]
  );

  const filtradas = (plantillas ?? []).filter((p) => cat === "Todas" || p.categoria === cat);
  const activa = filtradas.find((p) => p.id === activeId) ?? filtradas[0] ?? null;

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Crear"
        title="Plantillas"
        description="Diseña, envía a revisión y administra tus plantillas de mensaje de WhatsApp."
      >
        <button
          onClick={() => setFormAbierto((v) => !v)}
          className="flex items-center gap-2 rounded-lg bg-lime px-3.5 py-2 text-sm font-medium text-lime-fg transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" /> Nueva plantilla
        </button>
      </PageHeader>

      <div className="px-4 pt-6 md:px-8">
        {error && (
          <p className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">{error}</p>
        )}

        {formAbierto && (
          <form
            onSubmit={crearPlantilla}
            className="mb-6 flex flex-col gap-4 rounded-xl border border-edge bg-card p-6"
          >
            {negocios && negocios.length > 1 && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-mist">Número</label>
                <select
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberIdElegido(e.target.value)}
                  className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
                >
                  {negocios.map((n) => (
                    <option key={n.phone_number_id} value={n.phone_number_id}>
                      {n.nombre_negocio}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-mist">Nombre</label>
                <input
                  required
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="promo_julio"
                  className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-mist">Categoría</label>
                <select
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value)}
                  className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
                >
                  <option value="UTILITY">Utilidad</option>
                  <option value="MARKETING">Marketing</option>
                  <option value="AUTHENTICATION">Autenticación</option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-mist">Texto del mensaje</label>
              <textarea
                required
                rows={4}
                maxLength={1024}
                value={cuerpo}
                onChange={(e) => setCuerpo(e.target.value)}
                placeholder="Hola, tenemos una promoción especial este mes para ti."
                className="w-full rounded-lg border border-edge bg-ink px-4 py-3 text-sm text-fg outline-none focus:border-lime/50"
              />
            </div>
            {mensajeCrear && (
              <p className="rounded-lg border border-edge bg-ink p-3 text-xs leading-relaxed text-mist">{mensajeCrear}</p>
            )}
            <button
              type="submit"
              disabled={creando || !phoneNumberId}
              className="btn-shine self-start rounded-lg bg-lime px-5 py-2.5 text-sm font-semibold text-lime-fg transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creando ? "Enviando a Meta…" : "Enviar a revisión"}
            </button>
          </form>
        )}

        <div className="flex gap-1 overflow-x-auto">
          {categorias.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                cat === c ? "bg-lime text-lime-fg" : "bg-card text-mist hover:text-fg"
              }`}
            >
              {c === "Todas" ? "Todas" : c === "MARKETING" ? "Marketing" : c === "UTILITY" ? "Utilidad" : "Autenticación"}
            </button>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,340px)]">
          <div>
            {plantillas !== null && filtradas.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-edge bg-card p-10 text-center">
                <LayoutTemplate className="size-9 text-mist/40" strokeWidth={1.2} />
                <p className="mt-1 text-sm font-semibold text-fg">Todavía no has creado ninguna plantilla</p>
                <p className="max-w-xs text-xs leading-relaxed text-mist">
                  Créala arriba para empezar a mandar campañas masivas.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {filtradas.map((p) => {
                  const info = estadoInfo[p.estado] ?? estadoInfo.pendiente;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setActiveId(p.id)}
                      className={`rounded-xl border p-4 text-left transition-colors ${
                        activa?.id === p.id ? "border-lime/40 bg-card" : "border-edge bg-card hover:border-lime/25"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="flex size-8 items-center justify-center rounded-lg bg-ink text-mist">
                            <LayoutTemplate className="size-4" />
                          </div>
                          <span className="font-mono text-sm font-medium text-fg">{p.nombre}</span>
                        </div>
                        <Pill tone={info.tone}>
                          <info.icon className="size-3" /> {info.label}
                        </Pill>
                      </div>
                      <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-mist">{p.cuerpo}</p>
                      <p className="mt-3 font-mono text-[10.5px] uppercase tracking-widest text-mist">
                        {p.categoria} · {p.idioma}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="lg:sticky lg:top-20 lg:self-start">
            <div className="rounded-xl border border-edge bg-card p-4">
              <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">Vista previa</p>
              <div className="mt-3 rounded-[1.75rem] border border-edge bg-ink p-2.5">
                <div className="rounded-[1.4rem] bg-[#0b3b2e] p-3">
                  <div className="mb-2 flex justify-center">
                    <span className="rounded-full bg-black/20 px-2 py-0.5 font-mono text-[9.5px] text-white/70">
                      Hoy
                    </span>
                  </div>
                  <div className="max-w-[92%] rounded-xl rounded-tl-sm bg-card p-3 shadow-sm">
                    <p className="whitespace-pre-line text-sm leading-relaxed text-fg">
                      {activa ? activa.cuerpo : "Hola, tenemos una promoción especial este mes para ti."}
                    </p>
                    <p className="mt-1 text-right text-[10px] text-mist">10:24 ✓✓</p>
                  </div>
                </div>
              </div>
              <p className="mt-3 text-center text-xs text-mist">
                {activa ? activa.nombre : "Así se verá tu próxima plantilla"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
