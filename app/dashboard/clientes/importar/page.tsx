"use client";

// Bloque 34 — importar clientes desde Excel (.xlsx) o CSV: plantilla → archivo → vista previa (qué se
// crea, qué se actualiza y qué filas tienen errores) → aplicar. El servidor vuelve a validar cada fila.
import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Upload } from "lucide-react";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";
import { IMPORTAR_MAX_FILAS, PLANTILLA_CLIENTES_CSV, type FilaImportacion } from "@/lib/catalogo/clientes/modelo";
import { actionBtn, cn, primaryBtn, useCatalogAccess, useCatalogToast } from "@/components/dashboard/catalogo/ui";
import { Badge, telefonoVisible } from "@/components/dashboard/clientes/ui";

type Vista = { filas: FilaImportacion[]; resumen: { nuevos: number; actualizar: number; errores: number } };
type Resultado = { creados: number; actualizados: number; errores: Array<{ telefono: string; motivo: string }> };

const ACCION: Record<FilaImportacion["accion"], { es: string; en: string; tone: string }> = {
  nuevo: { es: "Nuevo", en: "New", tone: "bg-lime-soft text-lime-text" },
  actualizar: { es: "Se actualiza", en: "Update", tone: "bg-sky-500/15 text-sky-400" },
  error: { es: "Error", en: "Error", tone: "bg-red-500/15 text-red-400" },
};

export default function ImportarClientesPage() {
  const { t } = useI18n();
  const { client } = useCatalogAccess();
  const toast = useCatalogToast();
  const input = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<"leyendo" | "aplicando" | null>(null);

  function plantilla() {
    const url = URL.createObjectURL(new Blob([PLANTILLA_CLIENTES_CSV], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla-clientes.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function leer(f: File | undefined) {
    if (!client || !f || ocupado) return;
    setOcupado("leyendo");
    setArchivo(f.name);
    setVista(null);
    setResultado(null);
    setError(null);
    const r = await client.previewClientImport(f);
    setOcupado(null);
    if (input.current) input.current.value = "";
    if (!r.ok) return setError(r.error.message);
    setVista(r.data);
  }

  async function aplicar() {
    if (!client || !vista || ocupado) return;
    const filas = vista.filas
      .filter((f) => f.accion !== "error" && f.nombre && f.telefono && f.modalidad)
      // "+" + indicativo: el servidor lo vuelve a normalizar (también números de otro país).
      .map((f) => ({ nombre: f.nombre!, telefono: `+${f.telefono}`, modalidad: f.modalidad!, yaCompro: f.yaCompro }));
    if (filas.length === 0) return;
    setOcupado("aplicando");
    const r = await client.applyClientImport(filas);
    setOcupado(null);
    if (!r.ok) return toast(r.error.message, "error");
    setResultado(r.data);
    setVista(null);
    toast(t("✓ Importación terminada.", "✓ Import finished."));
  }

  const validas = vista ? vista.resumen.nuevos + vista.resumen.actualizar : 0;

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow={t("Clientes", "Customers")}
        title={t("Importar clientes", "Import customers")}
        description={t(
          `Sube un Excel (.xlsx) o CSV con las columnas Nombre, Celular, Modalidad (detal o mayorista) y, si quieres, Ya es cliente (sí / no). Máximo ${IMPORTAR_MAX_FILAS} clientes por archivo.`,
          `Upload an Excel (.xlsx) or CSV with the columns Nombre, Celular, Modalidad (detal or mayorista) and, optionally, Ya es cliente (sí / no). Up to ${IMPORTAR_MAX_FILAS} customers per file.`,
        )}
      >
        <Link href="/dashboard/clientes" className={actionBtn}>
          <ArrowLeft className="size-4" />
          {t("Clientes", "Customers")}
        </Link>
      </PageHeader>

      <div className="space-y-4 px-4 pt-6 md:px-8">
        <section className="rounded-2xl border border-edge bg-card p-4 sm:p-5">
          <ol className="space-y-4 text-sm text-fg">
            <li className="flex flex-wrap items-center gap-3">
              <span className="font-semibold">1.</span>
              <span className="text-mist">{t("Descarga la plantilla y llénala en Excel.", "Download the template and fill it in Excel.")}</span>
              <button type="button" onClick={plantilla} className={actionBtn}>
                <Download className="size-4" />
                {t("Descargar plantilla", "Download template")}
              </button>
            </li>
            <li className="flex flex-wrap items-center gap-3">
              <span className="font-semibold">2.</span>
              <span className="text-mist">{t("Sube el archivo: primero verás qué se va a hacer, sin guardar nada.", "Upload the file: you'll see a preview first, nothing is saved yet.")}</span>
              <input ref={input} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => void leer(e.target.files?.[0])} />
              <button type="button" disabled={ocupado !== null} onClick={() => input.current?.click()} className={cn(primaryBtn, "disabled:opacity-50")}>
                <Upload className="size-4" />
                {ocupado === "leyendo" ? t("Leyendo…", "Reading…") : t("Subir archivo", "Upload file")}
              </button>
              {archivo && <span className="text-xs text-mist">{archivo}</span>}
            </li>
          </ol>
          <p className="mt-4 text-xs text-mist">
            {t(
              "Si un celular ya es cliente, se actualizan su nombre, su modalidad y \"ya es cliente\". Los clientes importados reciben el saludo con su nombre cuando escriben.",
              "If a phone is already a customer, their name, type and \"existing customer\" are updated. Imported customers are greeted by name when they message.",
            )}
          </p>
        </section>

        {error && <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400" role="alert">{error}</p>}

        {vista && (
          <section className="rounded-2xl border border-edge bg-card p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-fg">{t("Vista previa", "Preview")}</span>
              <Badge tone={ACCION.nuevo.tone}>
                {vista.resumen.nuevos} {t("nuevos", "new")}
              </Badge>
              <Badge tone={ACCION.actualizar.tone}>
                {vista.resumen.actualizar} {t("se actualizan", "to update")}
              </Badge>
              <Badge tone={ACCION.error.tone}>
                {vista.resumen.errores} {t("con errores (no se importan)", "with errors (skipped)")}
              </Badge>
              <button type="button" disabled={validas === 0 || ocupado !== null} onClick={() => void aplicar()} className={cn(primaryBtn, "ml-auto disabled:opacity-50")}>
                {ocupado === "aplicando" ? t("Importando…", "Importing…") : t(`Importar ${validas} clientes`, `Import ${validas} customers`)}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-mist">
                  <tr>
                    <th className="py-2 pr-3 font-medium">{t("Fila", "Row")}</th>
                    <th className="py-2 pr-3 font-medium">{t("Nombre", "Name")}</th>
                    <th className="py-2 pr-3 font-medium">{t("Celular", "Phone")}</th>
                    <th className="py-2 pr-3 font-medium">{t("Modalidad", "Type")}</th>
                    <th className="py-2 pr-3 font-medium">{t("Ya es cliente", "Existing")}</th>
                    <th className="py-2 font-medium">{t("Acción", "Action")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge">
                  {vista.filas.map((f) => (
                    <tr key={f.fila} className={f.accion === "error" ? "text-mist" : "text-fg"}>
                      <td className="py-2 pr-3 tabular-nums">{f.fila}</td>
                      <td className="py-2 pr-3">{f.nombre ?? "—"}</td>
                      <td className="py-2 pr-3 tabular-nums">{f.telefono ? telefonoVisible(f.telefono) : "—"}</td>
                      <td className="py-2 pr-3">{f.modalidad === "mayorista" ? t("📦 Mayorista", "📦 Wholesale") : f.modalidad === "detal" ? t("🛍️ Detal", "🛍️ Retail") : "—"}</td>
                      <td className="py-2 pr-3">{f.yaCompro ? t("Sí", "Yes") : t("No", "No")}</td>
                      <td className="py-2">
                        <Badge tone={ACCION[f.accion].tone}>{t(ACCION[f.accion].es, ACCION[f.accion].en)}</Badge>
                        {f.motivo && <span className="ml-2 text-xs text-red-400">{f.motivo}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {resultado && (
          <section className="rounded-2xl border border-edge bg-card p-4 sm:p-5" aria-live="polite">
            <h2 className="text-sm font-semibold text-fg">{t("Resultado", "Result")}</h2>
            <p className="mt-2 text-sm text-fg">
              {t(`${resultado.creados} clientes nuevos · ${resultado.actualizados} actualizados`, `${resultado.creados} new customers · ${resultado.actualizados} updated`)}
              {resultado.errores.length > 0 && ` · ${t(`${resultado.errores.length} no se pudieron guardar`, `${resultado.errores.length} could not be saved`)}`}
            </p>
            {resultado.errores.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-red-400">
                {resultado.errores.map((e, i) => (
                  <li key={i}>
                    {e.telefono}: {e.motivo}
                  </li>
                ))}
              </ul>
            )}
            <Link href="/dashboard/clientes" className={cn(actionBtn, "mt-4")}>
              {t("Ver clientes", "View customers")}
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}
