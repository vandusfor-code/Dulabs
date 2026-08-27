"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Plus,
  Send,
  Users,
  CircleCheck,
  Eye,
  MessagesSquare,
  Calendar,
  Clock,
  LayoutTemplate,
  FileUp,
  Download,
  Check,
  Image as ImageIcon,
} from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader, Pill, StatTile } from "@/components/dashboard/shell/ui";
import { AreaTrend } from "@/components/dashboard/shell/charts";
import { useI18n } from "@/lib/i18n";
import type { ContactoImportado } from "@/lib/contactos-import";

type Plantilla = {
  id: number;
  phone_number_id: string;
  nombre: string;
  cuerpo: string;
  estado: string;
  header_formato: string | null;
};

type Campana = {
  id: number;
  nombre: string;
  plantilla: string;
  destinatarios_total: number;
  created_at: string;
  estado: "completado" | "fallido";
  funnel: { sent: number; delivered: number; read: number; replied: number };
};

type DatosCampanas = {
  kpis: {
    mensajesEnviados: number;
    tasaEntrega: number;
    tasaLectura: number;
    tasaRespuesta: number;
    deltaEnviadosPct: number | null;
    deltaTasaEntregaPts: number | null;
    deltaTasaLecturaPts: number | null;
    deltaTasaRespuestaPts: number | null;
  };
  tendencia: { label: string; entregados: number; leidos: number }[];
  campanas: Campana[];
};

function pct(valor: number): string {
  return `${(valor * 100).toFixed(1)}%`;
}

export default function CampanasPage() {
  const { session } = useDashboard();
  const { t } = useI18n();
  const estadoInfo: Record<Campana["estado"], { tone: "success" | "danger"; label: string }> = {
    completado: { tone: "success", label: t("Completada", "Completed") },
    fallido: { tone: "danger", label: t("Fallida", "Failed") },
  };
  const etapas = [
    { key: "sent" as const, label: t("Enviados", "Sent"), icon: Send, color: "var(--color-chart-5)" },
    { key: "delivered" as const, label: t("Entregados", "Delivered"), icon: CircleCheck, color: "var(--color-chart-4)" },
    { key: "read" as const, label: t("Leídos", "Read"), icon: Eye, color: "var(--color-chart-2)" },
    { key: "replied" as const, label: t("Respondidos", "Replied"), icon: MessagesSquare, color: "var(--color-chart-1)" },
  ];
  const [plantillas, setPlantillas] = useState<Plantilla[] | null>(null);
  const [datos, setDatos] = useState<DatosCampanas | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [formAbierto, setFormAbierto] = useState(false);

  const [plantillaCampana, setPlantillaCampana] = useState<number | "">("");
  const [destinatarios, setDestinatarios] = useState("");
  const [enviandoCampana, setEnviandoCampana] = useState(false);
  const [resultadoCampana, setResultadoCampana] = useState<{ enviados: number; fallidos: number } | string | null>(
    null
  );
  // Progreso del envío por lotes -- null cuando no hay un envío en curso.
  const [progresoCampana, setProgresoCampana] = useState<{ hecho: number; total: number } | null>(null);

  // Archivo del encabezado (imagen/video/documento) -- solo aplica si la
  // plantilla elegida lo pide (ver plantilla.header_formato). Se sube UNA
  // vez a Meta al enviar, y el mismo media_id se reusa para todos los
  // destinatarios (ver /api/campanas/media y /api/campanas/enviar).
  const headerFileInputRef = useRef<HTMLInputElement>(null);
  const [headerArchivo, setHeaderArchivo] = useState<File | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importando, setImportando] = useState(false);
  const [propuestaContactos, setPropuestaContactos] = useState<ContactoImportado[] | null>(null);
  const [errorImportar, setErrorImportar] = useState<string | null>(null);

  const importarContactos = useCallback(
    async (archivo: File) => {
      if (!session) return;
      setImportando(true);
      setErrorImportar(null);
      setPropuestaContactos(null);
      try {
        const form = new FormData();
        form.append("archivo", archivo);
        const res = await fetch("/api/dashboard/campanas/importar", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: form,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("Error importando el archivo", "Error importing the file"));
        setPropuestaContactos(data.contactos as ContactoImportado[]);
      } catch (err) {
        setErrorImportar(err instanceof Error ? err.message : String(err));
      } finally {
        setImportando(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [session, t]
  );

  const registrarContactos = useCallback(() => {
    if (!propuestaContactos) return;
    // Si el Excel trajo nombre, se conserva en la línea ("teléfono, Nombre")
    // — la plantilla que se use decide si lo aprovecha para personalizar.
    const lineas = propuestaContactos.map((c) => (c.nombre ? `${c.telefono}, ${c.nombre}` : c.telefono));
    setDestinatarios((prev) => {
      const previos = prev.split("\n").map((d) => d.trim()).filter(Boolean);
      return [...previos, ...lineas].join("\n");
    });
    setPropuestaContactos(null);
  }, [propuestaContactos]);

  const cargarDatos = useCallback(() => {
    if (!session) return;
    fetch("/api/dashboard/campanas", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => setDatos(data))
      .catch(() => setDatos({ kpis: { mensajesEnviados: 0, tasaEntrega: 0, tasaLectura: 0, tasaRespuesta: 0, deltaEnviadosPct: null, deltaTasaEntregaPts: null, deltaTasaLecturaPts: null, deltaTasaRespuestaPts: null }, tendencia: [], campanas: [] }));
  }, [session]);

  useEffect(() => {
    if (!session) return;
    fetch("/api/plantillas", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => setPlantillas(data.plantillas ?? []))
      .catch(() => setPlantillas([]));
    cargarDatos();
  }, [session, cargarDatos]);

  const plantillaElegida = (plantillas ?? []).find((p) => p.id === plantillaCampana) ?? null;

  // Tamaño de lote: cada lote es una llamada aparte a /api/campanas/enviar,
  // así ninguna campaña -- sin importar el tamaño -- se acerca al límite de
  // tiempo de la función (eso fue justo lo que cortó a mitad de camino una
  // campaña real de 401 destinatarios). 100 por lote deja margen de sobra
  // incluso si Meta responde lento.
  const TAMANO_LOTE = 100;

  const enviarCampana = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!session || !plantillaCampana || !plantillaElegida) return;
      if (plantillaElegida.header_formato && !headerArchivo) {
        setResultadoCampana(
          t(`Esta plantilla necesita ${plantillaElegida.header_formato === "IMAGE" ? "una imagen" : "un archivo"} de encabezado.`, `This template needs a header ${plantillaElegida.header_formato.toLowerCase()}.`)
        );
        return;
      }
      setEnviandoCampana(true);
      setResultadoCampana(null);
      const lista = destinatarios
        .split("\n")
        .map((d) => d.trim())
        .filter(Boolean);
      setProgresoCampana({ hecho: 0, total: lista.length });
      try {
        let headerMediaId: string | undefined;
        if (plantillaElegida.header_formato && headerArchivo) {
          const form = new FormData();
          form.append("phone_number_id", plantillaElegida.phone_number_id);
          form.append("archivo", headerArchivo);
          const resMedia = await fetch("/api/campanas/media", {
            method: "POST",
            headers: { Authorization: `Bearer ${session.access_token}` },
            body: form,
          });
          const dataMedia = await resMedia.json();
          if (!resMedia.ok) throw new Error(dataMedia.error ?? t("Error subiendo el archivo de encabezado", "Error uploading the header file"));
          headerMediaId = dataMedia.media_id;
        }

        // Se manda en lotes chicos y secuenciales -- cada llamada termina
        // rápido y sola, así que ninguna campaña se corta a mitad de camino
        // sin importar cuántos destinatarios tenga.
        let campanaId: number | undefined;
        let totalEnviados = 0;
        let totalFallidos = 0;
        for (let i = 0; i < lista.length; i += TAMANO_LOTE) {
          const lote = lista.slice(i, i + TAMANO_LOTE);
          const esUltimoLote = i + TAMANO_LOTE >= lista.length;
          const res = await fetch("/api/campanas/enviar", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({
              plantilla_id: plantillaCampana,
              destinatarios: lote,
              header_media_id: headerMediaId,
              campana_id: campanaId,
              destinatarios_total: lista.length,
              es_ultimo_lote: esUltimoLote,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? t("Error enviando la campaña", "Error sending the campaign"));
          campanaId = data.campana_id;
          totalEnviados += data.enviados;
          totalFallidos += data.fallidos?.length ?? 0;
          setProgresoCampana({ hecho: Math.min(i + TAMANO_LOTE, lista.length), total: lista.length });
        }

        setResultadoCampana({ enviados: totalEnviados, fallidos: totalFallidos });
        setDestinatarios("");
        setHeaderArchivo(null);
        if (headerFileInputRef.current) headerFileInputRef.current.value = "";
        cargarDatos();
      } catch (err) {
        setResultadoCampana(err instanceof Error ? err.message : String(err));
      } finally {
        setProgresoCampana(null);
        setEnviandoCampana(false);
      }
    },
    [session, plantillaCampana, plantillaElegida, headerArchivo, destinatarios, cargarDatos, t]
  );

  const aprobadas = (plantillas ?? []).filter((p) => p.estado === "APPROVED");
  const conteoDestinatarios = destinatarios.split("\n").map((d) => d.trim()).filter(Boolean).length;

  const campanas = datos?.campanas ?? [];
  const activa = campanas.find((c) => c.id === activeId) ?? campanas[0] ?? null;

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow={t("Campañas", "Broadcasts")}
        title={t("Campañas", "Campaigns")}
        description={t(
          "Envía transmisiones a tus contactos y sigue la entrega, lectura y respuesta en tiempo real.",
          "Send broadcasts to your contacts and track delivery, read, and reply status in real time."
        )}
      >
        <button
          onClick={() => setFormAbierto((v) => !v)}
          className="flex items-center gap-2 rounded-lg bg-lime px-3.5 py-2 text-sm font-medium text-lime-fg transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" /> {t("Nueva campaña", "New campaign")}
        </button>
      </PageHeader>

      <div className="px-4 pt-6 md:px-8">
        {formAbierto && (
          <div className="mb-6">
            {plantillas === null ? (
              <p className="text-sm text-mist">{t("Cargando plantillas…", "Loading templates…")}</p>
            ) : aprobadas.length === 0 ? (
              <div className="rounded-xl border border-edge bg-card p-8 text-center">
                <Send className="mx-auto size-10 text-mist/40" strokeWidth={1.2} />
                <p className="mt-3 text-sm font-semibold text-fg">{t("Necesitas una plantilla aprobada", "You need an approved template")}</p>
                <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-mist">
                  {t("Meta revisa las plantillas nuevas automáticamente, normalmente en minutos u horas.", "Meta reviews new templates automatically, usually within minutes or hours.")}
                </p>
                <Link
                  href="/dashboard/plantillas"
                  className="mt-4 inline-block rounded-lg bg-lime px-4 py-2 text-xs font-semibold text-lime-fg hover:bg-lime-hover"
                >
                  {t("Crear una plantilla →", "Create a template →")}
                </Link>
              </div>
            ) : (
              <form onSubmit={enviarCampana} className="flex flex-col gap-4 rounded-xl border border-edge bg-card p-6">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-mist">{t("Plantilla", "Template")}</label>
                  <select
                    required
                    value={plantillaCampana}
                    onChange={(e) => {
                      setPlantillaCampana(Number(e.target.value));
                      setHeaderArchivo(null);
                      if (headerFileInputRef.current) headerFileInputRef.current.value = "";
                    }}
                    className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
                  >
                    <option value="">{t("Selecciona una plantilla", "Select a template")}</option>
                    {aprobadas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                        {p.header_formato ? ` (${p.header_formato.toLowerCase()})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {plantillaElegida?.header_formato && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-mist">
                      {t(
                        `Archivo de encabezado (${plantillaElegida.header_formato.toLowerCase()}) — se envía igual a todos los destinatarios`,
                        `Header file (${plantillaElegida.header_formato.toLowerCase()}) — sent the same to every recipient`
                      )}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        ref={headerFileInputRef}
                        type="file"
                        accept={
                          plantillaElegida.header_formato === "IMAGE"
                            ? "image/*"
                            : plantillaElegida.header_formato === "VIDEO"
                              ? "video/*"
                              : undefined
                        }
                        className="hidden"
                        onChange={(e) => setHeaderArchivo(e.target.files?.[0] ?? null)}
                      />
                      <button
                        type="button"
                        onClick={() => headerFileInputRef.current?.click()}
                        className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-xs font-medium text-fg transition-colors hover:border-lime/40"
                      >
                        <ImageIcon className="size-3.5" />
                        {headerArchivo ? headerArchivo.name : t("Elegir archivo", "Choose file")}
                      </button>
                      {headerArchivo && (
                        <span className="flex items-center gap-1 text-xs text-lime-text">
                          <Check className="size-3.5" /> {t("Listo", "Ready")}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-medium text-mist">
                      {t(
                        "Destinatarios (uno por línea, con indicativo de país — opcionalmente: teléfono, Nombre)",
                        "Recipients (one per line, with country code — optionally: phone, Name)"
                      )}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) importarContactos(f);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={importando}
                        className="flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-xs font-medium text-fg transition-colors hover:border-lime/40 disabled:cursor-not-allowed disabled:opacity-50"
                        title={t("Sube un .xlsx con las columnas Teléfono / Nombre (formato oficial)", "Upload an .xlsx with Teléfono / Nombre columns (official format)")}
                      >
                        <FileUp className="size-3.5" /> {importando ? t("Analizando…", "Analyzing…") : t("Importar Excel", "Import Excel")}
                      </button>
                      <a
                        href="/plantillas/contactos-plantilla.xlsx"
                        download
                        className="flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-xs font-medium text-fg transition-colors hover:border-lime/40"
                      >
                        <Download className="size-3.5" /> {t("Plantilla", "Template")}
                      </a>
                    </div>
                  </div>

                  {errorImportar && <p className="mb-2 text-xs text-red-400">{errorImportar}</p>}
                  {propuestaContactos && (
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-lime/30 bg-lime/5 px-4 py-3">
                      <p className="text-sm text-fg">
                        {t(
                          `Se encontraron ${propuestaContactos.length} contactos. ¿Los registro?`,
                          `Found ${propuestaContactos.length} contacts. Register them?`
                        )}
                      </p>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPropuestaContactos(null)}
                          className="rounded-lg px-3 py-1.5 text-xs font-medium text-mist hover:text-fg"
                        >
                          {t("Cancelar", "Cancel")}
                        </button>
                        <button
                          type="button"
                          onClick={registrarContactos}
                          className="flex items-center gap-2 rounded-lg bg-lime px-3.5 py-1.5 text-xs font-semibold text-lime-fg hover:opacity-90"
                        >
                          <Check className="size-3.5" /> {t("Registrar", "Register")}
                        </button>
                      </div>
                    </div>
                  )}

                  <textarea
                    required
                    rows={5}
                    value={destinatarios}
                    onChange={(e) => setDestinatarios(e.target.value)}
                    placeholder={"573001234567\n573007654321, Juan Pérez"}
                    className="w-full rounded-lg border border-edge bg-ink px-4 py-3 text-sm text-fg outline-none focus:border-lime/50"
                  />
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-mist">
                    <Users className="size-3.5" /> {conteoDestinatarios} {conteoDestinatarios === 1 ? t("destinatario", "recipient") : t("destinatarios", "recipients")}
                  </p>
                </div>
                {progresoCampana && (
                  <div>
                    <div className="flex items-center justify-between text-xs text-mist">
                      <span>{t("Enviando…", "Sending…")}</span>
                      <span className="font-medium tabular-nums text-fg">
                        {progresoCampana.hecho} / {progresoCampana.total}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink">
                      <div
                        className="h-full rounded-full bg-lime transition-all"
                        style={{ width: `${Math.round((progresoCampana.hecho / progresoCampana.total) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
                {resultadoCampana && (
                  <p className="rounded-lg border border-edge bg-ink p-3 text-xs leading-relaxed text-mist">
                    {typeof resultadoCampana === "string"
                      ? resultadoCampana
                      : t(
                          `Enviados: ${resultadoCampana.enviados}${resultadoCampana.fallidos ? ` · Fallidos: ${resultadoCampana.fallidos}` : ""}`,
                          `Sent: ${resultadoCampana.enviados}${resultadoCampana.fallidos ? ` · Failed: ${resultadoCampana.fallidos}` : ""}`
                        )}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={enviandoCampana || Boolean(plantillaElegida?.header_formato && !headerArchivo)}
                  className="btn-shine self-start rounded-lg bg-lime px-5 py-2.5 text-sm font-semibold text-lime-fg transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {enviandoCampana ? t("Enviando…", "Sending…") : t("Enviar campaña", "Send campaign")}
                </button>
              </form>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label={t("Mensajes enviados", "Messages sent")}
            value={(datos?.kpis.mensajesEnviados ?? 0).toLocaleString("es-CO")}
            delta={datos?.kpis.deltaEnviadosPct != null ? pct(Math.abs(datos.kpis.deltaEnviadosPct)) : undefined}
            positive={(datos?.kpis.deltaEnviadosPct ?? 0) >= 0}
            icon={Send}
          />
          <StatTile
            label={t("Tasa de entrega", "Delivery rate")}
            value={pct(datos?.kpis.tasaEntrega ?? 0)}
            delta={datos?.kpis.deltaTasaEntregaPts != null ? pct(Math.abs(datos.kpis.deltaTasaEntregaPts)) : undefined}
            positive={(datos?.kpis.deltaTasaEntregaPts ?? 0) >= 0}
            icon={CircleCheck}
          />
          <StatTile
            label={t("Tasa de lectura", "Read rate")}
            value={pct(datos?.kpis.tasaLectura ?? 0)}
            delta={datos?.kpis.deltaTasaLecturaPts != null ? pct(Math.abs(datos.kpis.deltaTasaLecturaPts)) : undefined}
            positive={(datos?.kpis.deltaTasaLecturaPts ?? 0) >= 0}
            icon={Eye}
          />
          <StatTile
            label={t("Tasa de respuesta", "Reply rate")}
            value={pct(datos?.kpis.tasaRespuesta ?? 0)}
            delta={datos?.kpis.deltaTasaRespuestaPts != null ? pct(Math.abs(datos.kpis.deltaTasaRespuestaPts)) : undefined}
            positive={(datos?.kpis.deltaTasaRespuestaPts ?? 0) >= 0}
            icon={MessagesSquare}
          />
        </div>

        <div className="mt-6 rounded-xl border border-edge bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-fg">{t("Rendimiento de campañas", "Campaign performance")}</h2>
              <p className="text-sm text-mist">{t("Entregados vs leídos, últimas 6 semanas", "Delivered vs. read, last 6 weeks")}</p>
            </div>
            <div className="flex items-center gap-4">
              <Legend color="var(--color-chart-4)" label={t("Entregados", "Delivered")} />
              <Legend color="var(--color-chart-2)" label={t("Leídos", "Read")} />
            </div>
          </div>
          <div className="mt-4">
            {datos === null ? (
              <div className="flex h-[220px] items-center justify-center text-sm text-mist">{t("Cargando…", "Loading…")}</div>
            ) : (
              <AreaTrend
                data={datos.tendencia}
                height={220}
                keys={[
                  { key: "entregados", name: t("Entregados", "Delivered"), color: "var(--color-chart-4)" },
                  { key: "leidos", name: t("Leídos", "Read"), color: "var(--color-chart-2)" },
                ]}
              />
            )}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            {datos !== null && campanas.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-edge bg-card p-10 text-center">
                <Send className="size-9 text-mist/40" strokeWidth={1.2} />
                <p className="mt-1 text-sm font-semibold text-fg">{t("Todavía no has enviado ninguna campaña", "You haven't sent any campaigns yet")}</p>
                <p className="max-w-xs text-xs leading-relaxed text-mist">
                  {t("Créala con “Nueva campaña” para empezar a mandar transmisiones.", "Create one with “New campaign” to start sending broadcasts.")}
                </p>
              </div>
            ) : (
              campanas.map((c) => {
                const info = estadoInfo[c.estado];
                const readPct = c.funnel.sent ? Math.round((c.funnel.read / c.funnel.sent) * 100) : 0;
                return (
                  <button
                    key={c.id}
                    onClick={() => setActiveId(c.id)}
                    className={`w-full rounded-xl border p-4 text-left transition-colors ${
                      activa?.id === c.id ? "border-lime/40 bg-card" : "border-edge bg-card hover:border-lime/25"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-lg bg-ink text-mist">
                          <Send className="size-4" />
                        </div>
                        <div>
                          <p className="font-medium text-fg">{c.nombre}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-widest text-mist">
                              <LayoutTemplate className="size-3" /> {c.plantilla}
                            </span>
                            <span className="size-0.5 rounded-full bg-mist/40" />
                            <span className="flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-widest text-mist">
                              <Users className="size-3" /> {c.destinatarios_total} {t("destinatarios", "recipients")}
                            </span>
                          </div>
                        </div>
                      </div>
                      <Pill tone={info.tone}>{info.label}</Pill>
                    </div>

                    <div className="mt-4 flex items-center gap-4">
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[10.5px] uppercase tracking-widest text-mist">
                            {t("Alcance", "Reach")} {c.funnel.sent.toLocaleString("es-CO")}
                          </span>
                          <span className="text-xs font-medium tabular-nums text-fg">{readPct}% {t("leído", "read")}</span>
                        </div>
                        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink">
                          <div className="h-full bg-lime" style={{ width: `${readPct}%` }} />
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-mist">
                        <Clock className="size-3.5" />
                        <span className="hidden sm:inline">
                          {new Date(c.created_at).toLocaleDateString(t("es-CO", "en-US"), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="rounded-xl border border-edge bg-card p-5 lg:sticky lg:top-20 lg:self-start">
            <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{t("Embudo de conversión", "Conversion funnel")}</p>
            <h3 className="mt-1 font-semibold text-fg">{activa ? activa.nombre : t("Sin campañas todavía", "No campaigns yet")}</h3>

            {!activa || activa.funnel.sent === 0 ? (
              <div className="mt-6 flex flex-col items-center justify-center rounded-lg border border-dashed border-edge py-10 text-center">
                <Calendar className="size-6 text-mist" />
                <p className="mt-2 text-sm text-mist">{t("Envía tu primera campaña para ver el embudo aquí.", "Send your first campaign to see the funnel here.")}</p>
              </div>
            ) : (
              <div className="mt-4 space-y-2.5">
                {etapas.map((s) => {
                  const val = activa.funnel[s.key];
                  const base = activa.funnel.sent || 1;
                  const porcentaje = Math.round((val / base) * 100);
                  return (
                    <div key={s.key}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="flex items-center gap-1.5 text-fg">
                          <s.icon className="size-3.5" style={{ color: s.color }} /> {s.label}
                        </span>
                        <span className="font-medium tabular-nums text-fg">{val.toLocaleString("es-CO")}</span>
                      </div>
                      <div className="h-7 overflow-hidden rounded-md bg-ink">
                        <div
                          className="flex h-full items-center justify-end rounded-md px-2 text-[11px] font-medium text-lime-fg transition-all"
                          style={{ width: `${Math.max(porcentaje, 12)}%`, background: s.color }}
                        >
                          {porcentaje}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-2.5 rounded-full" style={{ background: color }} />
      <span className="text-xs text-mist">{label}</span>
    </div>
  );
}
