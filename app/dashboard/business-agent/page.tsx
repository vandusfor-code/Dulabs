"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, MessageSquareText, ShieldBan, UploadCloud } from "lucide-react";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { useDashboard } from "@/lib/dashboard-session";
import { useI18n } from "@/lib/i18n";
import { blankSpecForm, type EditableBusinessAgentSpecForm } from "@/lib/business-agent-form";
import { BusinessAgentWizard } from "@/components/dashboard/business-agent/Wizard";
import { BusinessAgentPreview } from "@/components/dashboard/business-agent/BusinessAgentPreview";
import { VersionsPanel } from "@/components/dashboard/business-agent/VersionsPanel";
import { BlockedNumbers } from "@/components/dashboard/business-agent/BlockedNumbers";
import {
  getCurrentBusinessAgent,
  listBusinessAgentVersions,
  saveBusinessAgentDraft,
  validateBusinessAgentSpecDraft,
} from "@/lib/business-agent-client";
import type { AgentSummaryPublic } from "@/lib/agent-compiler/api/business-agent-api";
import type { AgentVersionSummary } from "@/lib/agent-compiler/registry/types";
import type { CompilerDiagnostic } from "@/lib/agent-compiler/diagnostics";

type Tab = "configurar" | "preview" | "publicar" | "numeros";

function specToForm(spec: EditableBusinessAgentSpecForm): EditableBusinessAgentSpecForm {
  // El Spec completo del servidor ya contiene las 8 secciones editables --
  // se recorta explícitamente (nunca se reenvía metadata/schemaVersion).
  const { identity, personality, capabilities, catalog, policies, handoff, scheduling, knowledge } = spec;
  return { identity, personality, capabilities, catalog, policies, handoff, scheduling, knowledge };
}

export default function BusinessAgentPage() {
  const { t } = useI18n();
  const { session, negocios, rol } = useDashboard();
  const [tab, setTab] = useState<Tab>("configurar");
  const [agent, setAgent] = useState<AgentSummaryPublic | null>(null);
  const [versions, setVersions] = useState<AgentVersionSummary[]>([]);
  const [form, setForm] = useState<EditableBusinessAgentSpecForm>(blankSpecForm());
  const [baseVersionNumber, setBaseVersionNumber] = useState<number | undefined>(undefined);
  const [diagnostics, setDiagnostics] = useState<CompilerDiagnostic[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [numeroParaBloqueos, setNumeroParaBloqueos] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!session) return;
    const [agentResult, versionsResult] = await Promise.all([
      getCurrentBusinessAgent({ accessToken: session.access_token }),
      listBusinessAgentVersions({ accessToken: session.access_token }),
    ]);
    if (!agentResult.ok) {
      setLoadError(agentResult.error.message);
      setLoading(false);
      return;
    }
    setAgent(agentResult.data);
    setVersions(versionsResult.ok ? versionsResult.data.versions : []);
    const fuente = agentResult.data.draft ?? agentResult.data.published;
    if (fuente) {
      setForm(specToForm(fuente.spec));
      setBaseVersionNumber((agentResult.data.draft ?? agentResult.data.published)!.versionNumber);
      setDiagnostics(fuente.diagnostics);
    }
    setLoadError(null);
    setLoading(false);
  }, [session]);

  useEffect(() => {
    // Carga al montar (mismo patrón que FlowsListPage) -- intencional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  const guardarBorrador = async () => {
    if (!session) return;
    setSaving(true);
    setSaveError(null);
    // Validación previa (no persiste) para mostrar diagnósticos frescos antes
    // de intentar guardar -- el servidor vuelve a validar de todas formas.
    const validation = await validateBusinessAgentSpecDraft({ accessToken: session.access_token, editableSpec: form });
    const result = await saveBusinessAgentDraft({ accessToken: session.access_token, editableSpec: form, baseVersionNumber });
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error.message);
      setDiagnostics(result.error.diagnostics ?? (validation.ok ? validation.data.diagnostics : []));
      return;
    }
    setDiagnostics(result.data.diagnostics);
    setBaseVersionNumber(result.data.versionNumber);
    await cargar();
    setTab("publicar");
  };

  const puedeEditar = rol === "admin";
  const numerosNegocio = (negocios ?? []).map((n) => ({ phone_number_id: n.phone_number_id, nombre_negocio: n.nombre_negocio, flow_activo: n.flow_activo, flow_id: n.flow_id }));
  const previewVersionId = agent?.draft?.flowVersionId ?? agent?.published?.flowVersionId ?? null;

  const header = (
    <PageHeader
      eyebrow="Business Agent"
      title={t("Tu agente de WhatsApp", "Your WhatsApp agent")}
      description={t(
        "Configura, prueba y publica un bot conversacional para tu negocio -- sin programar.",
        "Configure, test and publish a conversational bot for your business -- no coding required.",
      )}
    />
  );

  if (loading) {
    return (
      <div className="pb-12">
        {header}
        <div className="px-4 pt-6 md:px-8">
          <p className="text-sm text-mist">{t("Cargando…", "Loading…")}</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="pb-12">
        {header}
        <div className="px-4 pt-6 md:px-8">
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!puedeEditar) {
    return (
      <div className="pb-12">
        {header}
        <div className="px-4 pt-6 md:px-8">
          <p className="text-sm text-mist">{t("Solo un administrador puede configurar el Business Agent.", "Only an admin can configure the Business Agent.")}</p>
        </div>
      </div>
    );
  }

  const TABS: { key: Tab; icon: typeof Bot; es: string; en: string }[] = [
    { key: "configurar", icon: Bot, es: "Configurar", en: "Configure" },
    { key: "preview", icon: MessageSquareText, es: "Vista previa", en: "Preview" },
    { key: "publicar", icon: UploadCloud, es: "Publicar y versiones", en: "Publish & versions" },
    { key: "numeros", icon: ShieldBan, es: "Números excluidos", en: "Blocked numbers" },
  ];

  return (
    <div className="pb-12">
      {header}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-edge px-4 md:px-8">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
            className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3.5 text-sm font-medium transition-colors ${tab === tb.key ? "border-lime text-lime-text" : "border-transparent text-mist hover:text-fg"}`}
          >
            <tb.icon className="size-4" strokeWidth={1.8} />
            {t(tb.es, tb.en)}
          </button>
        ))}
      </div>

      <div className="px-4 pt-6 md:px-8">
        {tab === "configurar" && (
          <BusinessAgentWizard form={form} onChange={setForm} diagnostics={diagnostics} saving={saving} onSaveDraft={guardarBorrador} saveError={saveError} />
        )}

        {tab === "preview" &&
          (previewVersionId ? (
            <BusinessAgentPreview flowVersionId={previewVersionId} />
          ) : (
            <p className="text-sm text-mist">{t("Guarda un borrador primero para poder probarlo.", "Save a draft first to be able to test it.")}</p>
          ))}

        {tab === "publicar" && agent && <VersionsPanel agent={agent} versions={versions} onChanged={cargar} numeros={numerosNegocio} />}

        {tab === "numeros" &&
          (numerosNegocio.length === 0 ? (
            <p className="text-sm text-mist">{t("Todavía no tienes ningún número conectado.", "You don't have any connected number yet.")}</p>
          ) : (
            <div className="space-y-4">
              {numerosNegocio.length > 1 && (
                <select className="w-full max-w-sm rounded-lg border border-edge bg-ink px-3 py-2.5 text-sm text-fg outline-none focus:border-lime/50" value={numeroParaBloqueos ?? numerosNegocio[0]!.phone_number_id} onChange={(e) => setNumeroParaBloqueos(e.target.value)}>
                  {numerosNegocio.map((n) => (
                    <option key={n.phone_number_id} value={n.phone_number_id}>{n.nombre_negocio}</option>
                  ))}
                </select>
              )}
              <BlockedNumbers phoneNumberId={numeroParaBloqueos ?? numerosNegocio[0]!.phone_number_id} businessLabel={numerosNegocio.find((n) => n.phone_number_id === (numeroParaBloqueos ?? numerosNegocio[0]!.phone_number_id))?.nombre_negocio ?? ""} />
            </div>
          ))}
      </div>
    </div>
  );
}
