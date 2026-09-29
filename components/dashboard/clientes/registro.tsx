"use client";

// Bloque 34 — "+ Registrar cliente": nombre, celular, modalidad y "ya es cliente". El asistente lo
// saluda por su nombre y no le pregunta detal / por mayor. El backend valida y normaliza todo.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Modalidad } from "@/lib/catalogo/clientes/modelo";
import { CField, actionBtn, cn, inputCls, primaryBtn, useCatalogAccess, useCatalogToast } from "@/components/dashboard/catalogo/ui";
import { telefonoVisible } from "@/components/dashboard/clientes/ui";

/** Datos extra de un error del backend: la clave del cliente que ya existe, o los números del negocio. */
function extra(diagnostics: unknown): { clave?: string; numeros?: string[] } {
  if (!diagnostics || typeof diagnostics !== "object") return {};
  const d = diagnostics as { clave?: unknown; numeros?: unknown };
  return {
    clave: typeof d.clave === "string" ? d.clave : undefined,
    numeros: Array.isArray(d.numeros) && d.numeros.every((n) => typeof n === "string") ? (d.numeros as string[]) : undefined,
  };
}

export function RegistrarCliente({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { client } = useCatalogAccess();
  const toast = useCatalogToast();
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [modalidad, setModalidad] = useState<Modalidad | null>(null);
  const [yaCompro, setYaCompro] = useState(false);
  const [numeros, setNumeros] = useState<string[] | null>(null);
  const [numero, setNumero] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existente, setExistente] = useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!client || enviando || !modalidad) return;
    setEnviando(true);
    setError(null);
    setExistente(null);
    const r = await client.registerClient({ nombre, telefono, modalidad, yaCompro, ...(numero ? { numero } : {}) });
    setEnviando(false);
    if (!r.ok) {
      const x = extra(r.error.diagnostics);
      if (x.numeros) {
        setNumeros(x.numeros);
        setNumero((n) => n || x.numeros![0]);
      }
      if (x.clave) setExistente(x.clave);
      setError(r.error.message);
      return;
    }
    toast(t("✓ Cliente registrado.", "✓ Customer registered."));
    router.push(`/dashboard/clientes/${r.data.clave}`);
  }

  const listo = nombre.trim().length >= 2 && telefono.replace(/\D/g, "").length >= 8 && modalidad !== null && (!numeros || numero !== "");

  return (
    <form onSubmit={(e) => void guardar(e)} className="rounded-2xl border border-edge bg-card p-4 sm:p-5" aria-label={t("Registrar cliente", "Register customer")}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">{t("Registrar cliente", "Register customer")}</h2>
          <p className="mt-0.5 text-xs text-mist">
            {t(
              "Cuando escriba por WhatsApp, el asistente ya sabrá su nombre y si es detal o mayorista (no se lo vuelve a preguntar).",
              "When they message on WhatsApp, the assistant will already know their name and whether they're retail or wholesale.",
            )}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-mist hover:text-fg" aria-label={t("Cerrar", "Close")}>
          <X className="size-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <CField label={t("Nombre", "Name")} htmlFor="cli-nombre" required>
          <input id="cli-nombre" value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} placeholder={t("Ej.: Camila Pérez", "E.g.: Camila Pérez")} className={inputCls} autoComplete="off" />
        </CField>
        <CField label={t("Celular (WhatsApp)", "Mobile (WhatsApp)")} htmlFor="cli-telefono" required hint={t("Colombia: 10 dígitos. Otro país: con + y su indicativo.", "Colombia: 10 digits. Other countries: + and country code.")}>
          <input id="cli-telefono" value={telefono} maxLength={25} inputMode="tel" onChange={(e) => setTelefono(e.target.value)} placeholder="300 111 2233" className={inputCls} autoComplete="off" />
        </CField>
      </div>

      <fieldset className="mt-4">
        <legend className="mb-1.5 text-xs font-medium text-mist">
          {t("Modalidad", "Customer type")}
          <span className="ml-0.5 text-red-400" aria-hidden>*</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["detal", t("🛍️ Detal", "🛍️ Retail")],
              ["mayorista", t("📦 Mayorista", "📦 Wholesale")],
            ] as const
          ).map(([id, texto]) => (
            <label key={id} className={cn("cursor-pointer rounded-xl border px-4 py-2 text-sm transition-colors", modalidad === id ? "border-fg bg-ink font-medium text-fg" : "border-edge text-mist hover:text-fg")}>
              <input type="radio" name="cli-modalidad" value={id} checked={modalidad === id} onChange={() => setModalidad(id)} className="sr-only" />
              {texto}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-4 flex items-start gap-2 text-sm text-fg">
        <input type="checkbox" checked={yaCompro} onChange={(e) => setYaCompro(e.target.checked)} className="mt-0.5" />
        <span>
          {t("Ya es cliente (ha comprado antes)", "Existing customer (has bought before)")}
          <span className="block text-xs text-mist">
            {t("Si es mayorista, no se le exige el mínimo de la primera compra.", "If wholesale, the first-purchase minimum doesn't apply.")}
          </span>
        </span>
      </label>

      {numeros && (
        <div className="mt-4">
          <CField label={t("Número de WhatsApp del negocio", "Business WhatsApp number")} htmlFor="cli-numero" required>
            <select id="cli-numero" value={numero} onChange={(e) => setNumero(e.target.value)} className={inputCls}>
              {numeros.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </CField>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400" role="alert">
          {error}
          {existente && (
            <>
              {" "}
              <Link href={`/dashboard/clientes/${existente}`} className="font-medium underline">
                {t("Abrir cliente", "Open customer")}
              </Link>
            </>
          )}
        </p>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        {telefono.replace(/\D/g, "").length === 10 && /^3/.test(telefono.replace(/\D/g, "")) && <span className="mr-auto text-xs text-mist tabular-nums">{telefonoVisible(`57${telefono.replace(/\D/g, "")}`)}</span>}
        <button type="button" onClick={onClose} className={actionBtn}>
          {t("Cancelar", "Cancel")}
        </button>
        <button type="submit" disabled={!listo || enviando} className={cn(primaryBtn, "disabled:opacity-50")}>
          {enviando ? t("Guardando…", "Saving…") : t("Registrar", "Register")}
        </button>
      </div>
    </form>
  );
}
