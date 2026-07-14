"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDashboard } from "@/lib/dashboard-session";

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

function BadgeEstado({ estado }: { estado: string }) {
  const estilos =
    estado === "APPROVED"
      ? "bg-lime/10 text-lime"
      : estado === "REJECTED"
        ? "bg-red-500/10 text-red-400"
        : "bg-white/10 text-white";
  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${estilos}`}>
      {estado === "pendiente" ? "PENDING" : estado}
    </span>
  );
}

export default function PlantillasPage() {
  const { session, negocios } = useDashboard();
  const [plantillas, setPlantillas] = useState<Plantilla[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [phoneNumberIdElegido, setPhoneNumberIdElegido] = useState("");
  const phoneNumberId = phoneNumberIdElegido || negocios?.[0]?.phone_number_id || "";
  const [nombre, setNombre] = useState("");
  const [categoria, setCategoria] = useState("UTILITY");
  const [cuerpo, setCuerpo] = useState("");
  const [creando, setCreando] = useState(false);
  const [mensajeCrear, setMensajeCrear] = useState<string | null>(null);

  const [plantillaCampana, setPlantillaCampana] = useState<number | "">("");
  const [destinatarios, setDestinatarios] = useState("");
  const [enviandoCampana, setEnviandoCampana] = useState(false);
  const [resultadoCampana, setResultadoCampana] = useState<string | null>(null);

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
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
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

  const enviarCampana = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!session || !plantillaCampana) return;
      setEnviandoCampana(true);
      setResultadoCampana(null);
      const lista = destinatarios
        .split(/[\n,]+/)
        .map((d) => d.trim())
        .filter(Boolean);
      try {
        const res = await fetch("/api/campanas/enviar", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ plantilla_id: plantillaCampana, destinatarios: lista }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error enviando la campaña");
        setResultadoCampana(
          `Enviados: ${data.enviados}${data.fallidos?.length ? ` · Fallidos: ${data.fallidos.length}` : ""}`
        );
      } catch (err) {
        setResultadoCampana(err instanceof Error ? err.message : String(err));
      } finally {
        setEnviandoCampana(false);
      }
    },
    [session, plantillaCampana, destinatarios]
  );

  const plantillasAprobadas = plantillas?.filter((p) => p.estado === "APPROVED") ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl">
      <h1 className="text-2xl font-semibold sm:text-3xl">Plantillas y Campañas</h1>
      <p className="mt-2 text-sm text-mist">
        Crea plantillas de mensaje, espera la aprobación de Meta, y mándalas
        a varios clientes de un solo golpe.
      </p>

      {error && (
        <p className="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </p>
      )}

      {/* --- Crear plantilla --- */}
      <section className="mt-8 rounded-2xl border border-edge/60 bg-card p-6 sm:p-8">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-mist">
          Nueva plantilla
        </h2>
        <form onSubmit={crearPlantilla} className="mt-4 flex flex-col gap-4">
          {negocios && negocios.length > 1 && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-mist">Número</label>
              <select
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberIdElegido(e.target.value)}
                className="w-full rounded-lg border border-edge bg-ink-2 px-4 py-2.5 text-sm text-white outline-none focus:border-lime/50"
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
                className="w-full rounded-lg border border-edge bg-ink-2 px-4 py-2.5 text-sm text-white outline-none focus:border-lime/50"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-mist">Categoría</label>
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                className="w-full rounded-lg border border-edge bg-ink-2 px-4 py-2.5 text-sm text-white outline-none focus:border-lime/50"
              >
                <option value="UTILITY">Utilidad</option>
                <option value="MARKETING">Marketing</option>
                <option value="AUTHENTICATION">Autenticación</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-mist">
              Texto del mensaje
            </label>
            <textarea
              required
              rows={4}
              maxLength={1024}
              value={cuerpo}
              onChange={(e) => setCuerpo(e.target.value)}
              placeholder="Hola, tenemos una promoción especial este mes para ti."
              className="w-full rounded-lg border border-edge bg-ink-2 px-4 py-3 text-sm text-white outline-none focus:border-lime/50"
            />
          </div>
          {mensajeCrear && (
            <p className="rounded-lg border border-edge/60 bg-ink-2 p-3 text-xs leading-relaxed text-mist">
              {mensajeCrear}
            </p>
          )}
          <button
            type="submit"
            disabled={creando || !phoneNumberId}
            className="btn-shine self-start rounded-lg bg-lime px-5 py-2.5 text-sm font-semibold text-ink transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creando ? "Enviando a Meta…" : "Enviar a revisión"}
          </button>
        </form>
      </section>

      {/* --- Lista de plantillas --- */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-mist">
          Tus plantillas
        </h2>
        {plantillas !== null && plantillas.length === 0 && (
          <p className="mt-4 rounded-xl border border-edge/60 bg-card p-5 text-sm leading-relaxed text-mist">
            Todavía no has creado ninguna plantilla.
          </p>
        )}
        <div className="mt-4 flex flex-col gap-3">
          {plantillas?.map((p) => (
            <div key={p.id} className="rounded-xl border border-edge/60 bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-white">{p.nombre}</p>
                <BadgeEstado estado={p.estado} />
              </div>
              <p className="mt-2 text-sm text-mist">{p.cuerpo}</p>
            </div>
          ))}
        </div>
      </section>

      {/* --- Enviar campaña --- */}
      <section className="mt-8 rounded-2xl border border-edge/60 bg-card p-6 sm:p-8">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-mist">
          Enviar campaña masiva
        </h2>
        {plantillasAprobadas.length === 0 ? (
          <p className="mt-4 text-sm leading-relaxed text-mist">
            Necesitas al menos una plantilla con estado <strong>APPROVED</strong> para
            poder mandar una campaña. Meta revisa las plantillas nuevas
            automáticamente, normalmente en minutos u horas.
          </p>
        ) : (
          <form onSubmit={enviarCampana} className="mt-4 flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-mist">Plantilla</label>
              <select
                required
                value={plantillaCampana}
                onChange={(e) => setPlantillaCampana(Number(e.target.value))}
                className="w-full rounded-lg border border-edge bg-ink-2 px-4 py-2.5 text-sm text-white outline-none focus:border-lime/50"
              >
                <option value="">Selecciona una plantilla</option>
                {plantillasAprobadas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-mist">
                Destinatarios (uno por línea, con indicativo de país)
              </label>
              <textarea
                required
                rows={5}
                value={destinatarios}
                onChange={(e) => setDestinatarios(e.target.value)}
                placeholder={"573001234567\n573007654321"}
                className="w-full rounded-lg border border-edge bg-ink-2 px-4 py-3 text-sm text-white outline-none focus:border-lime/50"
              />
            </div>
            {resultadoCampana && (
              <p className="rounded-lg border border-edge/60 bg-ink-2 p-3 text-xs leading-relaxed text-mist">
                {resultadoCampana}
              </p>
            )}
            <button
              type="submit"
              disabled={enviandoCampana}
              className="btn-shine self-start rounded-lg bg-lime px-5 py-2.5 text-sm font-semibold text-ink transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enviandoCampana ? "Enviando…" : "Enviar campaña"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
