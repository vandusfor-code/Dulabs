"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useDashboard } from "@/lib/dashboard-session";
import {
  createBusinessAgentService,
  deleteBusinessAgentService,
  listBusinessAgentServices,
  updateBusinessAgentService,
  type ServiceInput,
} from "@/lib/business-agent-client";
import type { BusinessAgentService } from "@/lib/business-agent-services";
import { actionBtn, Field, inputCls, primaryBtn, SectionCard } from "@/components/dashboard/business-agent/ui";
import { Pill } from "@/components/dashboard/shell/ui";

/**
 * Módulo de servicios estructurados (dulabs_servicios) del Business Agent.
 * CRUD inmediato contra la API (mismo patrón que BlockedNumbers) -- el precio y
 * la duración quedan en datos estructurados, no en un prompt. Se muestra solo
 * cuando la configuración lo requiere (catálogo o agendamiento).
 */
function emptyDraft(): ServiceInput {
  return { nombre: "", categoria: "", descripcion: "", duracionMin: 30, precio: null, activo: true };
}

function formatCOP(precio: number | null): string {
  if (precio === null) return "—";
  return `$${precio.toLocaleString("es-CO")}`;
}

function formatDuracion(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

export function ServicesModule() {
  const { t } = useI18n();
  const { session } = useDashboard();
  const [services, setServices] = useState<BusinessAgentService[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<ServiceInput>(emptyDraft());

  const cargar = useCallback(async () => {
    if (!session) return;
    const r = await listBusinessAgentServices({ accessToken: session.access_token });
    if (r.ok) {
      setServices(r.data.services);
      setError(null);
    } else {
      setError(r.error.message);
    }
  }, [session]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  const abrirNuevo = () => {
    setDraft(emptyDraft());
    setEditingId("new");
    setError(null);
  };
  const abrirEditar = (s: BusinessAgentService) => {
    setDraft({ nombre: s.nombre, categoria: s.categoria ?? "", descripcion: s.descripcion ?? "", duracionMin: s.duracionMin, precio: s.precio, activo: s.activo });
    setEditingId(s.id);
    setError(null);
  };

  const guardar = async () => {
    if (!session || !editingId) return;
    setBusy(true);
    setError(null);
    const input: ServiceInput = {
      nombre: draft.nombre.trim(),
      categoria: (draft.categoria || "").trim() || null,
      descripcion: (draft.descripcion || "").trim() || null,
      duracionMin: Number(draft.duracionMin),
      precio: draft.precio === null || (draft.precio as unknown) === "" ? null : Number(draft.precio),
      activo: draft.activo ?? true,
    };
    const r =
      editingId === "new"
        ? await createBusinessAgentService({ accessToken: session.access_token, input })
        : await updateBusinessAgentService({ accessToken: session.access_token, id: editingId, input });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setEditingId(null);
    await cargar();
  };

  const eliminar = async (s: BusinessAgentService) => {
    if (!session) return;
    if (!window.confirm(t(`¿Eliminar el servicio "${s.nombre}"?`, `Delete the service "${s.nombre}"?`))) return;
    setBusy(true);
    setError(null);
    const r = await deleteBusinessAgentService({ accessToken: session.access_token, id: s.id });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    await cargar();
  };

  const formulario = (
    <div className="space-y-3 rounded-lg border border-edge bg-ink p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("Nombre del servicio", "Service name")} required>
          <input className={inputCls} value={draft.nombre} onChange={(e) => setDraft({ ...draft, nombre: e.target.value })} placeholder={t("Manicure básica", "Basic manicure")} />
        </Field>
        <Field label={t("Categoría (opcional)", "Category (optional)")}>
          <input className={inputCls} value={draft.categoria ?? ""} onChange={(e) => setDraft({ ...draft, categoria: e.target.value })} placeholder={t("Uñas", "Nails")} />
        </Field>
        <Field label={t("Duración (minutos)", "Duration (minutes)")} required>
          <input type="number" min={1} step={5} className={inputCls} value={draft.duracionMin} onChange={(e) => setDraft({ ...draft, duracionMin: Number(e.target.value) })} />
        </Field>
        <Field label={t("Precio (COP, opcional)", "Price (COP, optional)")} hint={t("Déjalo vacío si el precio no es fijo.", "Leave empty if the price is not fixed.")}>
          <input type="number" min={0} step={1000} className={inputCls} value={draft.precio ?? ""} onChange={(e) => setDraft({ ...draft, precio: e.target.value === "" ? null : Number(e.target.value) })} placeholder="30000" />
        </Field>
      </div>
      <Field label={t("Descripción (opcional)", "Description (optional)")}>
        <textarea className={inputCls} rows={2} value={draft.descripcion ?? ""} onChange={(e) => setDraft({ ...draft, descripcion: e.target.value })} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-fg">
        <input type="checkbox" checked={draft.activo ?? true} onChange={(e) => setDraft({ ...draft, activo: e.target.checked })} />
        {t("Activo (visible para los clientes)", "Active (visible to customers)")}
      </label>
      <div className="flex items-center gap-2">
        <button type="button" onClick={guardar} disabled={busy} className={primaryBtn}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("Guardar servicio", "Save service")}
        </button>
        <button type="button" onClick={() => setEditingId(null)} disabled={busy} className={actionBtn}>
          {t("Cancelar", "Cancel")}
        </button>
      </div>
    </div>
  );

  return (
    <SectionCard
      title={t("Servicios", "Services")}
      description={t(
        "Los servicios que tus clientes pueden consultar y reservar. El precio y la duración quedan estructurados -- el agente nunca los inventa.",
        "The services your customers can ask about and book. Price and duration are stored as structured data -- the agent never makes them up.",
      )}
    >
      {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-400">{error}</p>}

      {services === null ? (
        <p className="text-sm text-mist">{t("Cargando…", "Loading…")}</p>
      ) : (
        <div className="space-y-3">
          {services.length === 0 && editingId !== "new" && (
            <p className="text-sm text-mist">{t("Todavía no has agregado servicios.", "You haven't added any services yet.")}</p>
          )}

          {services.length > 0 && (
            <ul className="space-y-1.5">
              {services.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-edge bg-ink px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-fg">{s.nombre}</span>
                      {!s.activo && <Pill tone="neutral">{t("Inactivo", "Inactive")}</Pill>}
                    </div>
                    <p className="text-xs text-mist">
                      {formatCOP(s.precio)} · {formatDuracion(s.duracionMin)}
                      {s.categoria ? ` · ${s.categoria}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => abrirEditar(s)} disabled={busy} className={actionBtn} aria-label={t("Editar", "Edit")}>
                      <Pencil className="size-3.5" />
                    </button>
                    <button type="button" onClick={() => eliminar(s)} disabled={busy} className={actionBtn} aria-label={t("Eliminar", "Delete")}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {editingId !== null ? (
            formulario
          ) : (
            <button type="button" onClick={abrirNuevo} className={actionBtn}>
              <Plus className="size-3.5" /> {t("Agregar servicio", "Add service")}
            </button>
          )}
        </div>
      )}
    </SectionCard>
  );
}
