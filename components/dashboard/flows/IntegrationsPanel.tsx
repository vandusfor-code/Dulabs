"use client";

/**
 * Fase 5 (Actions + Integrations, autorizado) — panel para crear/aprobar/
 * revocar integraciones HTTP del tenant y configurar sus credenciales
 * cifradas. Habla EXCLUSIVAMENTE con app/api/flows/integrations/** (vía
 * lib/flow-builder/integrations-client.ts) -- la API es la única autoridad
 * (rol admin, ownership, SSRF). Nunca muestra ni pide ver un secreto ya
 * guardado, solo permite ESCRIBIR uno nuevo.
 */

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Plus, ShieldCheck, ShieldOff, TriangleAlert, X } from "lucide-react";
import {
  approveIntegration,
  createIntegration,
  listIntegrationCredentialKeys,
  listIntegrations,
  revokeIntegration,
  saveIntegrationCredential,
} from "@/lib/flow-builder/integrations-client";
import { Pill } from "@/components/dashboard/shell/ui";
import type { FlowIntegrationRow } from "@/lib/flow/flow-store-types";

export interface IntegrationsPanelProps {
  open: boolean;
  onClose: () => void;
  accessToken: string;
}

const STATUS_TONE: Record<FlowIntegrationRow["status"], "success" | "warning" | "danger"> = {
  approved: "success",
  pending: "warning",
  revoked: "danger",
};

const STATUS_LABEL: Record<FlowIntegrationRow["status"], string> = {
  approved: "Aprobada",
  pending: "Pendiente",
  revoked: "Revocada",
};

function CredentialsEditor({ integration, accessToken }: { integration: FlowIntegrationRow; accessToken: string }) {
  const [keys, setKeys] = useState<string[] | null>(null);
  const [nuevaClave, setNuevaClave] = useState("Authorization");
  const [nuevoValor, setNuevoValor] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const cargar = useCallback(() => {
    listIntegrationCredentialKeys({ integrationId: integration.id, accessToken }).then((result) => {
      if (result.ok) setKeys(result.credentials.map((c) => c.credentialKey));
    });
  }, [integration.id, accessToken]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function guardar() {
    if (!nuevaClave.trim() || !nuevoValor.trim()) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    const result = await saveIntegrationCredential({ integrationId: integration.id, credentialKey: nuevaClave.trim(), plaintext: nuevoValor, accessToken });
    setSaving(false);
    if (result.ok) {
      setSuccess(true);
      setNuevoValor("");
      cargar();
    } else {
      setError(result.error.message);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-edge bg-ink p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-mist">
        <KeyRound className="size-3.5" /> Credenciales (nunca se muestran una vez guardadas)
      </p>
      {keys && keys.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {keys.map((k) => (
            <Pill key={k} tone="neutral">
              {k} ✓
            </Pill>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="rounded-md border border-edge bg-card px-2 py-1.5 text-xs text-fg sm:w-40"
          placeholder="Nombre del header (ej. Authorization)"
          value={nuevaClave}
          onChange={(e) => setNuevaClave(e.target.value)}
        />
        <input
          className="flex-1 rounded-md border border-edge bg-card px-2 py-1.5 text-xs text-fg"
          placeholder="Valor (ej. Bearer sk-...)"
          type="password"
          value={nuevoValor}
          onChange={(e) => setNuevoValor(e.target.value)}
        />
        <button
          type="button"
          onClick={() => void guardar()}
          disabled={saving || !nuevaClave.trim() || !nuevoValor.trim()}
          className="shrink-0 rounded-md bg-lime px-3 py-1.5 text-xs font-semibold text-lime-fg hover:bg-lime-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
      {success && <p className="mt-1.5 text-xs text-lime-text">Credencial guardada.</p>}
    </div>
  );
}

export function IntegrationsPanel({ open, onClose, accessToken }: IntegrationsPanelProps) {
  const [integrations, setIntegrations] = useState<FlowIntegrationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ slug: "", displayName: "", capability: "", url: "", httpMethod: "POST" });
  const [createError, setCreateError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    listIntegrations({ accessToken }).then((result) => {
      if (result.ok) {
        setIntegrations(result.integrations);
        setError(null);
      } else {
        setError(result.error.message);
      }
    });
  }, [accessToken]);

  useEffect(() => {
    if (open) cargar();
  }, [open, cargar]);

  if (!open) return null;

  async function handleCrear() {
    setCreating(true);
    setCreateError(null);
    const result = await createIntegration({ ...form, accessToken });
    setCreating(false);
    if (result.ok) {
      setForm({ slug: "", displayName: "", capability: "", url: "", httpMethod: "POST" });
      cargar();
    } else {
      setCreateError(result.error.message);
    }
  }

  async function handleAprobar(id: string) {
    setBusyId(id);
    await approveIntegration({ integrationId: id, accessToken });
    setBusyId(null);
    cargar();
  }

  async function handleRevocar(id: string) {
    setBusyId(id);
    await revokeIntegration({ integrationId: id, accessToken });
    setBusyId(null);
    cargar();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/50" role="dialog" aria-modal="true">
      <div className="flex h-full w-full max-w-xl flex-col border-l border-edge bg-card shadow-2xl">
        <div className="flex shrink-0 items-center gap-3 border-b border-edge px-5 py-3">
          <ShieldCheck className="size-4 text-mist" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">Integraciones</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-mist hover:bg-ink hover:text-fg">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-5 rounded-xl border border-edge p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-mist">Nueva integración HTTP</p>
            <div className="grid grid-cols-2 gap-2">
              <input
                className="rounded-md border border-edge bg-ink px-2 py-1.5 text-xs text-fg"
                placeholder="slug (único)"
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              />
              <input
                className="rounded-md border border-edge bg-ink px-2 py-1.5 text-xs text-fg"
                placeholder="Nombre visible"
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              />
              <input
                className="rounded-md border border-edge bg-ink px-2 py-1.5 text-xs text-fg"
                placeholder="capability (ej. notificar_pedido)"
                value={form.capability}
                onChange={(e) => setForm((f) => ({ ...f, capability: e.target.value }))}
              />
              <select
                className="rounded-md border border-edge bg-ink px-2 py-1.5 text-xs text-fg"
                value={form.httpMethod}
                onChange={(e) => setForm((f) => ({ ...f, httpMethod: e.target.value }))}
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
              </select>
              <input
                className="col-span-2 rounded-md border border-edge bg-ink px-2 py-1.5 text-xs text-fg"
                placeholder="https://api.tuservicio.com/endpoint"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              />
            </div>
            {createError && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-red-400">
                <TriangleAlert className="size-3.5" /> {createError}
              </p>
            )}
            <button
              type="button"
              onClick={() => void handleCrear()}
              disabled={creating || !form.slug || !form.displayName || !form.capability || !form.url}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-lime px-3 py-1.5 text-xs font-semibold text-lime-fg hover:bg-lime-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="size-3.5" /> {creating ? "Creando…" : "Crear integración"}
            </button>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {!integrations ? (
            <p className="text-sm text-mist">Cargando…</p>
          ) : integrations.length === 0 ? (
            <p className="text-sm text-mist">Todavía no tienes ninguna integración.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {integrations.map((integ) => (
                <div key={integ.id} className="rounded-xl border border-edge p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-fg">{integ.display_name}</div>
                      <div className="truncate text-xs text-mist">
                        {integ.http_method} {integ.url}
                      </div>
                      <div className="mt-1 text-[11px] text-mist">capability: {integ.capability}</div>
                    </div>
                    <Pill tone={STATUS_TONE[integ.status]}>{STATUS_LABEL[integ.status]}</Pill>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expandedId === integ.id ? null : integ.id)}
                      className="rounded-md border border-edge px-2.5 py-1 text-xs font-medium text-fg hover:border-edge/80"
                    >
                      {expandedId === integ.id ? "Ocultar credenciales" : "Credenciales"}
                    </button>
                    {integ.status !== "approved" ? (
                      <button
                        type="button"
                        onClick={() => void handleAprobar(integ.id)}
                        disabled={busyId === integ.id}
                        className="inline-flex items-center gap-1 rounded-md border border-lime/40 px-2.5 py-1 text-xs font-medium text-lime-text hover:bg-lime/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <CheckCircle2 className="size-3.5" /> Aprobar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleRevocar(integ.id)}
                        disabled={busyId === integ.id}
                        className="inline-flex items-center gap-1 rounded-md border border-red-500/40 px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <ShieldOff className="size-3.5" /> Revocar
                      </button>
                    )}
                  </div>
                  {expandedId === integ.id && <CredentialsEditor integration={integ} accessToken={accessToken} />}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
