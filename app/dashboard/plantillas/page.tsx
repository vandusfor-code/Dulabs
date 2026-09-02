"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LayoutTemplate, CircleCheck, Clock, CircleAlert, Plus, FileEdit, Ban, Search, Copy, Check as CheckIcon, X, Download as DownloadIcon, Image as ImageIcon, Upload, Link as LinkIcon, Phone } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader, Pill, StatTile } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";
import { contarVariablesPlantilla, MAX_BOTONES_CTA, type FormatoHeaderPlantilla, type BotonCTA } from "@/lib/meta-templates";

type Plantilla = {
  id: number;
  phone_number_id: string;
  nombre: string;
  categoria: string;
  idioma: string;
  cuerpo: string;
  footer: string | null;
  botones: string[];
  botones_cta: BotonCTA[];
  estado: string;
  header_formato: string | null;
  header_texto: string | null;
  header_ejemplo: string | null;
  variables_ejemplo: string[];
  borrador: boolean;
  created_at: string;
  enviados: number;
  tasaLectura: number;
};

const MAX_BOTONES = 3;
const MAX_CARACTERES_BOTON = 25;

const IDIOMAS_PLANTILLA = [
  { codigo: "es_CO", etiqueta: "Español (Colombia)" },
  { codigo: "es", etiqueta: "Español" },
  { codigo: "es_MX", etiqueta: "Español (México)" },
  { codigo: "es_ES", etiqueta: "Español (España)" },
  { codigo: "en_US", etiqueta: "English (US)" },
  { codigo: "pt_BR", etiqueta: "Português (Brasil)" },
];

const FORMATOS_HEADER: { valor: FormatoHeaderPlantilla | ""; etiqueta: string }[] = [
  { valor: "", etiqueta: "Ninguno" },
  { valor: "TEXT", etiqueta: "Texto" },
  { valor: "IMAGE", etiqueta: "Imagen" },
  { valor: "VIDEO", etiqueta: "Video" },
  { valor: "DOCUMENT", etiqueta: "Documento" },
];


const categorias = ["Todas", "MARKETING", "UTILITY", "AUTHENTICATION"] as const;

export default function PlantillasPage() {
  const { session, negocios } = useDashboard();
  const { t } = useI18n();
  const estadoInfo: Record<string, { tone: "success" | "warning" | "danger" | "neutral"; label: string; icon: typeof CircleCheck }> = {
    APPROVED: { tone: "success", label: t("Aprobada", "Approved"), icon: CircleCheck },
    REJECTED: { tone: "danger", label: t("Rechazada", "Rejected"), icon: CircleAlert },
    pendiente: { tone: "warning", label: t("En revisión", "Under review"), icon: Clock },
    PENDING: { tone: "warning", label: t("En revisión", "Under review"), icon: Clock },
    IN_APPEAL: { tone: "warning", label: t("En apelación", "In appeal"), icon: Clock },
    PAUSED: { tone: "warning", label: t("Pausada por Meta", "Paused by Meta"), icon: Ban },
    DISABLED: { tone: "danger", label: t("Deshabilitada", "Disabled"), icon: Ban },
    PENDING_DELETION: { tone: "neutral", label: t("Eliminando…", "Deleting…"), icon: Clock },
    DELETED: { tone: "neutral", label: t("Eliminada", "Deleted"), icon: CircleAlert },
    LIMIT_EXCEEDED: { tone: "danger", label: t("Límite excedido", "Limit exceeded"), icon: CircleAlert },
    borrador: { tone: "neutral", label: t("Borrador", "Draft"), icon: FileEdit },
  };
  const infoDePlantilla = (p: Plantilla) =>
    p.borrador ? estadoInfo.borrador : estadoInfo[p.estado] ?? estadoInfo.pendiente;
  const [plantillas, setPlantillas] = useState<Plantilla[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState<(typeof categorias)[number]>("Todas");
  const [busqueda, setBusqueda] = useState("");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [formAbierto, setFormAbierto] = useState(false);
  const [importarAbierto, setImportarAbierto] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const [phoneNumberIdElegido, setPhoneNumberIdElegido] = useState("");
  const phoneNumberId = phoneNumberIdElegido || negocios?.[0]?.phone_number_id || "";
  const [nombre, setNombre] = useState("");
  const [categoria, setCategoria] = useState("UTILITY");
  const [idioma, setIdioma] = useState("es_CO");
  const [cuerpo, setCuerpo] = useState("");
  const [footer, setFooter] = useState("");
  const [botones, setBotones] = useState<string[]>([]);
  const [creando, setCreando] = useState(false);
  const [mensajeCrear, setMensajeCrear] = useState<string | null>(null);
  const [publicandoId, setPublicandoId] = useState<number | null>(null);

  const [headerFormato, setHeaderFormato] = useState<FormatoHeaderPlantilla | "">("");
  const [headerTexto, setHeaderTexto] = useState("");
  const [headerEjemplo, setHeaderEjemplo] = useState("");
  const [headerArchivoNombre, setHeaderArchivoNombre] = useState<string | null>(null);
  const [headerEjemploHandle, setHeaderEjemploHandle] = useState<string | null>(null);
  const [subiendoHeader, setSubiendoHeader] = useState(false);
  const [errorHeader, setErrorHeader] = useState<string | null>(null);
  const inputHeaderArchivoRef = useRef<HTMLInputElement | null>(null);

  const variablesCuerpo = contarVariablesPlantilla(cuerpo);
  const [variablesEjemploMap, setVariablesEjemploMap] = useState<Record<number, string>>({});
  const variablesEjemplo = Array.from({ length: variablesCuerpo }, (_, i) => variablesEjemploMap[i] ?? "");

  const [botonesCta, setBotonesCta] = useState<BotonCTA[]>([]);

  const [draftHeaderHandle, setDraftHeaderHandle] = useState<string | null>(null);
  const [subiendoDraftHeader, setSubiendoDraftHeader] = useState(false);
  const [errorDraftHeader, setErrorDraftHeader] = useState<string | null>(null);

  const subirArchivoHeader = useCallback(
    async (archivo: File) => {
      if (!session || !phoneNumberId) return;
      setSubiendoHeader(true);
      setErrorHeader(null);
      setHeaderEjemploHandle(null);
      try {
        const form = new FormData();
        form.append("phone_number_id", phoneNumberId);
        form.append("archivo", archivo);
        const res = await fetch("/api/plantillas/header-media", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: form,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("Error subiendo el archivo a Meta", "Error uploading the file to Meta"));
        setHeaderEjemploHandle(data.handle);
        setHeaderArchivoNombre(archivo.name);
      } catch (err) {
        setErrorHeader(err instanceof Error ? err.message : String(err));
      } finally {
        setSubiendoHeader(false);
      }
    },
    [session, phoneNumberId, t]
  );

  const resetearFormularioHeader = () => {
    setHeaderFormato("");
    setHeaderTexto("");
    setHeaderEjemplo("");
    setHeaderArchivoNombre(null);
    setHeaderEjemploHandle(null);
    setErrorHeader(null);
    if (inputHeaderArchivoRef.current) inputHeaderArchivoRef.current.value = "";
  };

  const [nombreImportar, setNombreImportar] = useState("");
  const [idiomaImportar, setIdiomaImportar] = useState("");
  const [importando, setImportando] = useState(false);
  const [mensajeImportar, setMensajeImportar] = useState<string | null>(null);

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
    async (e: { preventDefault: () => void }, borrador: boolean) => {
      e.preventDefault();
      if (!session) return;
      setCreando(true);
      setMensajeCrear(null);
      try {
        const res = await fetch("/api/plantillas", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            phone_number_id: phoneNumberId,
            nombre,
            categoria,
            idioma,
            cuerpo,
            footer: footer.trim() || undefined,
            botones,
            botones_cta: botonesCta,
            header_formato: headerFormato || undefined,
            header_texto: headerFormato === "TEXT" ? headerTexto : undefined,
            header_ejemplo: headerFormato === "TEXT" ? headerEjemplo || undefined : undefined,
            header_ejemplo_handle: headerFormato && headerFormato !== "TEXT" ? headerEjemploHandle || undefined : undefined,
            variables_ejemplo: variablesEjemplo,
            borrador,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("Error creando la plantilla", "Error creating the template"));
        setMensajeCrear(borrador ? t("Guardada como borrador.", "Saved as a draft.") : t(`Enviada a revisión de Meta (estado: ${data.estado}).`, `Submitted for Meta review (status: ${data.estado}).`));
        setNombre("");
        setCuerpo("");
        setFooter("");
        setBotones([]);
        setBotonesCta([]);
        setVariablesEjemploMap({});
        resetearFormularioHeader();
        cargarPlantillas();
      } catch (err) {
        setMensajeCrear(err instanceof Error ? err.message : String(err));
      } finally {
        setCreando(false);
      }
    },
    [session, phoneNumberId, nombre, categoria, idioma, cuerpo, footer, botones, botonesCta, headerFormato, headerTexto, headerEjemplo, headerEjemploHandle, variablesEjemplo, cargarPlantillas, t]
  );

  // Para plantillas creadas directamente en el Administrador de Meta (ej.
  // cualquiera con encabezado de imagen/video/documento, que el editor de
  // arriba todavía no sabe crear) -- las trae por nombre y las registra
  // aquí para poder usarlas en campañas.
  const importarPlantilla = useCallback(
    async (e: { preventDefault: () => void }) => {
      e.preventDefault();
      if (!session) return;
      setImportando(true);
      setMensajeImportar(null);
      try {
        const res = await fetch("/api/plantillas/importar", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ phone_number_id: phoneNumberId, nombre: nombreImportar, idioma: idiomaImportar || undefined }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("Error importando la plantilla", "Error importing the template"));
        setMensajeImportar(
          data.header_formato
            ? t(`Importada con encabezado de ${data.header_formato.toLowerCase()} (estado: ${data.estado}).`, `Imported with a ${data.header_formato.toLowerCase()} header (status: ${data.estado}).`)
            : t(`Importada (estado: ${data.estado}).`, `Imported (status: ${data.estado}).`)
        );
        setNombreImportar("");
        cargarPlantillas();
      } catch (err) {
        setMensajeImportar(err instanceof Error ? err.message : String(err));
      } finally {
        setImportando(false);
      }
    },
    [session, phoneNumberId, nombreImportar, idiomaImportar, cargarPlantillas, t]
  );

  const headerRequiereHandle = (p: Plantilla) => Boolean(p.header_formato && p.header_formato !== "TEXT");

  const subirArchivoHeaderDraft = useCallback(
    async (p: Plantilla, archivo: File) => {
      if (!session) return;
      setSubiendoDraftHeader(true);
      setErrorDraftHeader(null);
      setDraftHeaderHandle(null);
      try {
        const form = new FormData();
        form.append("phone_number_id", p.phone_number_id);
        form.append("archivo", archivo);
        const res = await fetch("/api/plantillas/header-media", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: form,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("Error subiendo el archivo a Meta", "Error uploading the file to Meta"));
        setDraftHeaderHandle(data.handle);
      } catch (err) {
        setErrorDraftHeader(err instanceof Error ? err.message : String(err));
      } finally {
        setSubiendoDraftHeader(false);
      }
    },
    [session, t]
  );

  const publicarBorrador = useCallback(
    async (p: Plantilla) => {
      if (!session) return;
      if (headerRequiereHandle(p) && !draftHeaderHandle) {
        setMensajeCrear(t("Vuelve a adjuntar el archivo del encabezado antes de enviar a revisión.", "Re-attach the header file before submitting for review."));
        return;
      }
      setPublicandoId(p.id);
      try {
        const res = await fetch("/api/plantillas", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            id: p.id,
            phone_number_id: p.phone_number_id,
            nombre: p.nombre,
            categoria: p.categoria,
            cuerpo: p.cuerpo,
            footer: p.footer,
            botones: p.botones ?? [],
            botones_cta: p.botones_cta ?? [],
            idioma: p.idioma,
            header_formato: p.header_formato || undefined,
            header_texto: p.header_texto || undefined,
            header_ejemplo: p.header_ejemplo || undefined,
            header_ejemplo_handle: draftHeaderHandle || undefined,
            variables_ejemplo: p.variables_ejemplo ?? [],
            borrador: false,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("Error enviando a revisión", "Error submitting for review"));
        cargarPlantillas();
      } catch (err) {
        setMensajeCrear(err instanceof Error ? err.message : String(err));
      } finally {
        setPublicandoId(null);
      }
    },
    [session, draftHeaderHandle, cargarPlantillas, t]
  );

  const filtradas = (plantillas ?? []).filter((p) => {
    if (cat !== "Todas" && p.categoria !== cat) return false;
    if (busqueda.trim() && !p.nombre.toLowerCase().includes(busqueda.trim().toLowerCase())) return false;
    return true;
  });
  const activa = filtradas.find((p) => p.id === activeId) ?? filtradas[0] ?? null;
  const variablesActiva = activa ? contarVariablesPlantilla(activa.cuerpo) : 0;
  const nombreNegocioActiva = negocios?.find((n) => n.phone_number_id === activa?.phone_number_id)?.nombre_negocio;

  const copiarTexto = () => {
    if (!activa) return;
    navigator.clipboard.writeText(activa.cuerpo).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    });
  };

  const todas = plantillas ?? [];
  const conteos = {
    aprobadas: todas.filter((p) => p.estado === "APPROVED").length,
    pendientes: todas.filter((p) => !p.borrador && ["pendiente", "PENDING", "IN_APPEAL"].includes(p.estado)).length,
    rechazadas: todas.filter((p) => ["REJECTED", "DISABLED", "LIMIT_EXCEEDED"].includes(p.estado)).length,
    pausadas: todas.filter((p) => p.estado === "PAUSED").length,
    borradores: todas.filter((p) => p.borrador).length,
  };

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow={t("Crear", "Create")}
        title={t("Plantillas", "Templates")}
        description={t("Diseña, envía a revisión y administra tus plantillas de mensaje de WhatsApp.", "Design, submit for review and manage your WhatsApp message templates.")}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => setImportarAbierto((v) => !v)}
            className="flex items-center gap-2 rounded-lg border border-edge px-3.5 py-2 text-sm font-medium text-fg transition-colors hover:border-lime/40"
          >
            <DownloadIcon className="size-4" /> {t("Importar de Meta", "Import from Meta")}
          </button>
          <button
            onClick={() => setFormAbierto((v) => !v)}
            className="flex items-center gap-2 rounded-lg bg-lime px-3.5 py-2 text-sm font-medium text-lime-fg transition-opacity hover:opacity-90"
          >
            <Plus className="size-4" /> {t("Nueva plantilla", "New template")}
          </button>
        </div>
      </PageHeader>

      <div className="px-4 pt-6 md:px-8">
        {error && (
          <p className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">{error}</p>
        )}

        {importarAbierto && (
          <form
            onSubmit={importarPlantilla}
            className="mb-6 flex flex-col gap-4 rounded-xl border border-edge bg-card p-6"
          >
            <p className="text-xs leading-relaxed text-mist">
              {t(
                "Para plantillas que ya creaste directamente en el Administrador de WhatsApp de Meta (por ejemplo, con imagen en el encabezado). Escribe el nombre exacto y la traemos con su estado real.",
                "For templates you already created directly in Meta's WhatsApp Manager (for example, with an image header). Type the exact name and we'll bring it in with its real status."
              )}
            </p>
            {negocios && negocios.length > 1 && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-mist">{t("Número", "Number")}</label>
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
                <label className="mb-1.5 block text-xs font-medium text-mist">{t("Nombre exacto en Meta", "Exact name in Meta")}</label>
                <input
                  required
                  value={nombreImportar}
                  onChange={(e) => setNombreImportar(e.target.value)}
                  placeholder="invitacion_asamblea_antioquia"
                  className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-mist">{t("Idioma (opcional)", "Language (optional)")}</label>
                <input
                  value={idiomaImportar}
                  onChange={(e) => setIdiomaImportar(e.target.value)}
                  placeholder="es_CO"
                  className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
                />
              </div>
            </div>
            {mensajeImportar && (
              <p className="rounded-lg border border-edge bg-ink p-3 text-xs leading-relaxed text-mist">{mensajeImportar}</p>
            )}
            <button
              type="submit"
              disabled={importando || !phoneNumberId}
              className="btn-shine self-start rounded-lg bg-lime px-5 py-2.5 text-sm font-semibold text-lime-fg transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importando ? t("Importando…", "Importing…") : t("Importar", "Import")}
            </button>
          </form>
        )}

        {plantillas !== null && plantillas.length > 0 && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatTile label={t("Aprobadas", "Approved")} value={String(conteos.aprobadas)} icon={CircleCheck} />
            <StatTile label={t("En revisión", "Under review")} value={String(conteos.pendientes)} icon={Clock} />
            <StatTile label={t("Rechazadas", "Rejected")} value={String(conteos.rechazadas)} icon={CircleAlert} />
            <StatTile label={t("Pausadas", "Paused")} value={String(conteos.pausadas)} icon={Ban} />
            <StatTile label={t("Borradores", "Drafts")} value={String(conteos.borradores)} icon={FileEdit} />
          </div>
        )}

        {formAbierto && (
          <form
            onSubmit={(e) => crearPlantilla(e, false)}
            className="mb-6 flex flex-col gap-4 rounded-xl border border-edge bg-card p-6"
          >
            {negocios && negocios.length > 1 && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-mist">{t("Número", "Number")}</label>
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
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-mist">{t("Nombre", "Name")}</label>
                <input
                  required
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="promo_julio"
                  className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-mist">{t("Categoría", "Category")}</label>
                <select
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value)}
                  className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
                >
                  <option value="UTILITY">{t("Utilidad", "Utility")}</option>
                  <option value="MARKETING">Marketing</option>
                  <option value="AUTHENTICATION">{t("Autenticación", "Authentication")}</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-mist">{t("Idioma", "Language")}</label>
                <select
                  value={idioma}
                  onChange={(e) => setIdioma(e.target.value)}
                  className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
                >
                  {IDIOMAS_PLANTILLA.map((i) => (
                    <option key={i.codigo} value={i.codigo}>
                      {i.etiqueta}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-mist">{t("Encabezado (opcional)", "Header (optional)")}</label>
              <select
                value={headerFormato}
                onChange={(e) => {
                  resetearFormularioHeader();
                  setHeaderFormato(e.target.value as FormatoHeaderPlantilla | "");
                }}
                className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50 sm:w-56"
              >
                {FORMATOS_HEADER.map((f) => (
                  <option key={f.valor} value={f.valor}>
                    {f.etiqueta}
                  </option>
                ))}
              </select>

              {headerFormato === "TEXT" && (
                <div className="mt-3 space-y-3">
                  <input
                    value={headerTexto}
                    maxLength={60}
                    onChange={(e) => setHeaderTexto(e.target.value)}
                    placeholder={t("Texto del encabezado, ej: {{1}} tiene una oferta para ti", "Header text, e.g. {{1}} has an offer for you")}
                    className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
                  />
                  {contarVariablesPlantilla(headerTexto) > 0 && (
                    <input
                      value={headerEjemplo}
                      onChange={(e) => setHeaderEjemplo(e.target.value)}
                      placeholder={t("Valor de ejemplo para {{1}} del encabezado", "Example value for the header's {{1}}")}
                      className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
                    />
                  )}
                </div>
              )}

              {headerFormato && headerFormato !== "TEXT" && (
                <div className="mt-3 space-y-2">
                  <input
                    ref={inputHeaderArchivoRef}
                    type="file"
                    accept={headerFormato === "IMAGE" ? "image/*" : headerFormato === "VIDEO" ? "video/*" : "application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"}
                    onChange={(e) => {
                      const archivo = e.target.files?.[0];
                      if (archivo) subirArchivoHeader(archivo);
                    }}
                    className="block w-full text-xs text-mist file:mr-3 file:rounded-lg file:border file:border-edge file:bg-ink file:px-3 file:py-2 file:text-xs file:font-medium file:text-fg"
                  />
                  <p className="flex items-center gap-1.5 text-[10.5px] text-mist">
                    {subiendoHeader && <>{t("Subiendo a Meta…", "Uploading to Meta…")}</>}
                    {!subiendoHeader && headerEjemploHandle && (
                      <>
                        <Upload className="size-3 text-lime-text" /> {t(`Listo: ${headerArchivoNombre}`, `Ready: ${headerArchivoNombre}`)}
                      </>
                    )}
                  </p>
                  {errorHeader && <p className="text-[10.5px] text-red-400">{errorHeader}</p>}
                </div>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-mist">{t("Texto del mensaje", "Message text")}</label>
              <textarea
                required
                rows={4}
                maxLength={1024}
                value={cuerpo}
                onChange={(e) => setCuerpo(e.target.value)}
                placeholder={t("Hola {{1}}, tenemos una promoción especial este mes para ti.", "Hi {{1}}, we have a special promotion for you this month.")}
                className="w-full rounded-lg border border-edge bg-ink px-4 py-3 text-sm text-fg outline-none focus:border-lime/50"
              />
              <p className="mt-1 text-[10.5px] text-mist">
                {t("Usa {{1}}, {{2}}… para partes variables (nombre, fecha, etc).", "Use {{1}}, {{2}}… for variable parts (name, date, etc).")}
              </p>
            </div>

            {variablesEjemplo.length > 0 && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-mist">
                  {t("Valores de ejemplo para las variables", "Example values for the variables")}
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {variablesEjemplo.map((v, i) => (
                    <input
                      key={i}
                      required
                      value={v}
                      onChange={(e) => setVariablesEjemploMap((prev) => ({ ...prev, [i]: e.target.value }))}
                      placeholder={t(`Ejemplo para {{${i + 1}}}`, `Example for {{${i + 1}}}`)}
                      className="w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-lime/50"
                    />
                  ))}
                </div>
                <p className="mt-1 text-[10.5px] text-mist">
                  {t("Meta los exige para revisar la plantilla; no se envían a tus clientes.", "Meta requires these to review the template; they aren't sent to your customers.")}
                </p>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-medium text-mist">{t("Pie de página (opcional)", "Footer (optional)")}</label>
              <input
                value={footer}
                maxLength={60}
                onChange={(e) => setFooter(e.target.value)}
                placeholder={t("Soluciones Financieras", "Your business name")}
                className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-mist">
                {t("Botones de respuesta rápida (opcional)", "Quick-reply buttons (optional)")}
              </label>
              <div className="space-y-2">
                {botones.map((b, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      value={b}
                      maxLength={MAX_CARACTERES_BOTON}
                      onChange={(e) => setBotones((prev) => prev.map((x, idx) => (idx === i ? e.target.value : x)))}
                      placeholder={t(`Botón ${i + 1}`, `Button ${i + 1}`)}
                      className="w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-lime/50"
                    />
                    <button
                      type="button"
                      onClick={() => setBotones((prev) => prev.filter((_, idx) => idx !== i))}
                      aria-label={t("Quitar botón", "Remove button")}
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-mist transition-colors hover:text-red-400"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
              {botones.length < MAX_BOTONES && (
                <button
                  type="button"
                  onClick={() => setBotones((prev) => [...prev, ""])}
                  className="mt-2 flex items-center gap-1.5 text-sm font-medium text-lime-text transition-opacity hover:opacity-80"
                >
                  <Plus className="size-4" /> {t("Agregar botón", "Add button")}
                </button>
              )}
              <p className="mt-1 text-[10.5px] text-mist">
                {t(`Hasta ${MAX_BOTONES} botones, ${MAX_CARACTERES_BOTON} caracteres cada uno.`, `Up to ${MAX_BOTONES} buttons, ${MAX_CARACTERES_BOTON} characters each.`)}
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-mist">
                {t("Botones de acción (opcional)", "Call-to-action buttons (optional)")}
              </label>
              <div className="space-y-2">
                {botonesCta.map((b, i) => (
                  <div key={i} className="flex flex-col gap-2 rounded-lg border border-edge p-2.5 sm:flex-row sm:items-center">
                    <select
                      value={b.tipo}
                      onChange={(e) =>
                        setBotonesCta((prev) => prev.map((x, idx) => (idx === i ? { ...x, tipo: e.target.value as BotonCTA["tipo"], valor: "" } : x)))
                      }
                      className="rounded-lg border border-edge bg-ink px-2.5 py-2 text-xs text-fg outline-none focus:border-lime/50 sm:w-32"
                    >
                      <option value="URL">{t("Abrir sitio", "Visit website")}</option>
                      <option value="PHONE_NUMBER">{t("Llamar", "Call")}</option>
                    </select>
                    <input
                      value={b.texto}
                      maxLength={MAX_CARACTERES_BOTON}
                      onChange={(e) => setBotonesCta((prev) => prev.map((x, idx) => (idx === i ? { ...x, texto: e.target.value } : x)))}
                      placeholder={t("Texto del botón", "Button text")}
                      className="w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-lime/50 sm:w-36"
                    />
                    <input
                      value={b.valor}
                      onChange={(e) => setBotonesCta((prev) => prev.map((x, idx) => (idx === i ? { ...x, valor: e.target.value } : x)))}
                      placeholder={b.tipo === "URL" ? "https://tuweb.com" : "+573001234567"}
                      className="w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-lime/50"
                    />
                    <button
                      type="button"
                      onClick={() => setBotonesCta((prev) => prev.filter((_, idx) => idx !== i))}
                      aria-label={t("Quitar botón", "Remove button")}
                      className="flex size-8 shrink-0 items-center justify-center self-end rounded-lg text-mist transition-colors hover:text-red-400 sm:self-auto"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
              {botonesCta.length < MAX_BOTONES_CTA && (
                <button
                  type="button"
                  onClick={() => setBotonesCta((prev) => [...prev, { tipo: "URL", texto: "", valor: "" }])}
                  className="mt-2 flex items-center gap-1.5 text-sm font-medium text-lime-text transition-opacity hover:opacity-80"
                >
                  <Plus className="size-4" /> {t("Agregar botón de acción", "Add call-to-action button")}
                </button>
              )}
              <p className="mt-1 text-[10.5px] text-mist">
                {t(`Hasta ${MAX_BOTONES_CTA}: abrir un sitio web o llamar a un número.`, `Up to ${MAX_BOTONES_CTA}: visit a website or call a number.`)}
              </p>
            </div>
            {mensajeCrear && (
              <p className="rounded-lg border border-edge bg-ink p-3 text-xs leading-relaxed text-mist">{mensajeCrear}</p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={creando || !phoneNumberId}
                className="btn-shine rounded-lg bg-lime px-5 py-2.5 text-sm font-semibold text-lime-fg transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creando ? t("Enviando a Meta…", "Sending to Meta…") : t("Enviar a revisión", "Submit for review")}
              </button>
              <button
                type="button"
                onClick={(e) => crearPlantilla(e, true)}
                disabled={creando || !phoneNumberId}
                className="rounded-lg border border-edge px-5 py-2.5 text-sm font-semibold text-fg transition-colors hover:border-lime/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("Guardar borrador", "Save draft")}
              </button>
            </div>
          </form>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 overflow-x-auto">
            {categorias.map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  cat === c ? "bg-lime text-lime-fg" : "bg-card text-mist hover:text-fg"
                }`}
              >
                {c === "Todas" ? t("Todas", "All") : c === "MARKETING" ? "Marketing" : c === "UTILITY" ? t("Utilidad", "Utility") : t("Autenticación", "Authentication")}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={t("Buscar plantillas…", "Search templates…")}
              className="w-56 rounded-lg border border-edge bg-card py-1.5 pl-9 pr-3 text-sm text-fg outline-none focus:border-lime/50"
            />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,340px)]">
          <div>
            {plantillas !== null && filtradas.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-edge bg-card p-10 text-center">
                <LayoutTemplate className="size-9 text-mist/40" strokeWidth={1.2} />
                <p className="mt-1 text-sm font-semibold text-fg">{t("Todavía no has creado ninguna plantilla", "You haven't created any template yet")}</p>
                <p className="max-w-xs text-xs leading-relaxed text-mist">
                  {t("Créala arriba para empezar a mandar campañas masivas.", "Create one above to start sending bulk campaigns.")}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {filtradas.map((p) => {
                  const info = infoDePlantilla(p);
                  return (
                    <button
                      key={p.id}
                      onClick={() => {
                        setActiveId(p.id);
                        setDraftHeaderHandle(null);
                        setErrorDraftHeader(null);
                      }}
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
                          {p.header_formato && (
                            <span title={t(`Con encabezado de ${p.header_formato.toLowerCase()}`, `With a ${p.header_formato.toLowerCase()} header`)}>
                              <ImageIcon className="size-3.5 text-mist" />
                            </span>
                          )}
                        </div>
                        <Pill tone={info.tone}>
                          <info.icon className="size-3" /> {info.label}
                        </Pill>
                      </div>
                      <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-mist">{p.cuerpo}</p>
                      {p.botones?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {p.botones.map((b, i) => (
                            <span key={i} className="rounded-full border border-edge px-2 py-0.5 text-[10.5px] text-mist">
                              {b}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <Pill tone={p.categoria === "MARKETING" ? "info" : "neutral"}>{p.categoria}</Pill>
                          <span className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{p.idioma}</span>
                        </div>
                        <span className="font-mono text-[10.5px] uppercase tracking-widest text-mist">
                          {p.enviados.toLocaleString("es-CO")} {t("enviados", "sent")}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="lg:sticky lg:top-20 lg:self-start">
            <div className="rounded-xl border border-edge bg-card p-4">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{t("Vista previa", "Preview")}</p>
                {activa && (
                  <button
                    onClick={copiarTexto}
                    className="flex items-center gap-1 text-xs text-mist transition-colors hover:text-fg"
                  >
                    {copiado ? <CheckIcon className="size-3.5 text-lime-text" /> : <Copy className="size-3.5" />}
                    {copiado ? t("Copiado", "Copied") : t("Copiar", "Copy")}
                  </button>
                )}
              </div>
              <div className="mt-3 rounded-[1.75rem] border border-edge bg-ink p-2.5">
                <div className="rounded-[1.4rem] bg-[#0b3b2e] p-3">
                  <div className="mb-2 flex justify-center">
                    <span className="rounded-full bg-black/20 px-2 py-0.5 font-mono text-[9.5px] text-white/70">
                      {t("Hoy", "Today")}
                    </span>
                  </div>
                  <div className="max-w-[92%] overflow-hidden rounded-xl rounded-tl-sm bg-card shadow-sm">
                    {(() => {
                      const formato = activa ? activa.header_formato : headerFormato || null;
                      const texto = activa ? activa.header_texto : headerFormato === "TEXT" ? headerTexto : null;
                      if (formato === "TEXT" && texto) {
                        return <p className="px-3 pt-3 text-sm font-semibold text-fg">{texto}</p>;
                      }
                      if (formato === "IMAGE" || formato === "VIDEO" || formato === "DOCUMENT") {
                        return (
                          <div className="flex h-28 items-center justify-center bg-ink text-mist">
                            <ImageIcon className="size-6" />
                          </div>
                        );
                      }
                      return null;
                    })()}
                    <div className="p-3">
                      <p className="whitespace-pre-line text-sm leading-relaxed text-fg">
                        {activa ? activa.cuerpo : t("Hola, tenemos una promoción especial este mes para ti.", "Hi, we have a special promotion for you this month.")}
                      </p>
                      {(activa ? activa.footer : footer) && <p className="mt-1.5 text-xs text-mist">{activa ? activa.footer : footer}</p>}
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span className="truncate text-[10px] text-mist">{nombreNegocioActiva ?? ""}</span>
                        <span className="shrink-0 text-[10px] text-mist">10:24 ✓✓</span>
                      </div>
                    </div>
                  </div>
                  {(activa ? activa.botones : botones).filter(Boolean).length > 0 && (
                    <div className="mt-1.5 max-w-[92%] space-y-1">
                      {(activa ? activa.botones : botones).filter(Boolean).map((b, i) => (
                        <div key={i} className="rounded-lg bg-card/80 py-1.5 text-center text-xs font-medium text-lime-text">
                          {b}
                        </div>
                      ))}
                    </div>
                  )}
                  {(activa ? activa.botones_cta ?? [] : botonesCta).filter((b) => b.texto).length > 0 && (
                    <div className="mt-1.5 max-w-[92%] space-y-1">
                      {(activa ? activa.botones_cta ?? [] : botonesCta)
                        .filter((b) => b.texto)
                        .map((b, i) => (
                          <div key={i} className="flex items-center justify-center gap-1.5 rounded-lg bg-card/80 py-1.5 text-center text-xs font-medium text-lime-text">
                            {b.tipo === "URL" ? <LinkIcon className="size-3" /> : <Phone className="size-3" />}
                            {b.texto}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
              <p className="mt-3 text-center text-xs text-mist">
                {activa ? activa.nombre : t("Así se verá tu próxima plantilla", "This is how your next template will look")}
              </p>

              {activa && (
                <div className="mt-4 grid grid-cols-2 gap-2 border-t border-edge pt-4">
                  <div>
                    <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{t("Variables", "Variables")}</p>
                    <p className="mt-1 text-lg font-semibold text-fg">{variablesActiva}</p>
                  </div>
                  <div>
                    <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{t("Tasa de lectura", "Read rate")}</p>
                    <p className="mt-1 text-lg font-semibold text-fg">
                      {activa.enviados > 0 ? `${Math.round(activa.tasaLectura * 100)}%` : "—"}
                    </p>
                  </div>
                </div>
              )}

              {activa?.borrador && (
                <div className="mt-4 border-t border-edge pt-4">
                  {headerRequiereHandle(activa) && (
                    <div className="mb-3 space-y-1.5">
                      <p className="text-[10.5px] text-mist">
                        {t("Este borrador tiene encabezado de archivo: vuelve a adjuntarlo para enviarlo a revisión.", "This draft has a file header: re-attach it to submit for review.")}
                      </p>
                      <input
                        type="file"
                        accept={activa.header_formato === "IMAGE" ? "image/*" : activa.header_formato === "VIDEO" ? "video/*" : "application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"}
                        onChange={(e) => {
                          const archivo = e.target.files?.[0];
                          if (archivo) subirArchivoHeaderDraft(activa, archivo);
                        }}
                        className="block w-full text-xs text-mist file:mr-3 file:rounded-lg file:border file:border-edge file:bg-ink file:px-3 file:py-2 file:text-xs file:font-medium file:text-fg"
                      />
                      {subiendoDraftHeader && <p className="text-[10.5px] text-mist">{t("Subiendo…", "Uploading…")}</p>}
                      {!subiendoDraftHeader && draftHeaderHandle && (
                        <p className="flex items-center gap-1 text-[10.5px] text-lime-text">
                          <Upload className="size-3" /> {t("Archivo listo.", "File ready.")}
                        </p>
                      )}
                      {errorDraftHeader && <p className="text-[10.5px] text-red-400">{errorDraftHeader}</p>}
                    </div>
                  )}
                  <button
                    onClick={() => publicarBorrador(activa)}
                    disabled={publicandoId === activa.id || (headerRequiereHandle(activa) && !draftHeaderHandle)}
                    className="btn-shine w-full rounded-lg bg-lime px-4 py-2.5 text-sm font-semibold text-lime-fg transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {publicandoId === activa.id ? t("Enviando…", "Sending…") : t("Enviar a revisión", "Submit for review")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
