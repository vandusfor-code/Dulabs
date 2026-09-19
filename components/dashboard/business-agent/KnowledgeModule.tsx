"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useDashboard } from "@/lib/dashboard-session";
import {
  createBusinessAgentFaq,
  deleteBusinessAgentDocument,
  deleteBusinessAgentFaq,
  getBusinessAgentKnowledge,
  searchBusinessAgentKnowledge,
  updateBusinessAgentFaq,
  uploadBusinessAgentDocument,
  type FaqInput,
  type KnowledgeOverview,
  type KnowledgeSearchResponse,
} from "@/lib/business-agent-client";
import type { BusinessAgentFaq } from "@/lib/business-agent-knowledge/faq";
import { DEFAULT_NO_ANSWER_MESSAGE, KNOWLEDGE_DOC_EXTENSIONS, KNOWLEDGE_LIMITS, NO_ANSWER_MESSAGE_MAX } from "@/lib/business-agent-knowledge/limits";
import type { EditableBusinessAgentSpecForm } from "@/lib/business-agent-form";
import { actionBtn, Field, inputCls, primaryBtn, SectionCard, ToggleRow } from "@/components/dashboard/business-agent/ui";
import { Pill } from "@/components/dashboard/shell/ui";

/**
 * Módulo "Conocimiento" (R4). FAQ estructurada + documentos indexados: el agente
 * los RECUPERA por relevancia durante la conversación (nunca se inyectan
 * completos en el prompt). Todo CRUD inmediato contra la API (el servidor valida
 * y aplica los límites; los chequeos de aquí son solo comodidad). "Probar una
 * pregunta" ejecuta la MISMA recuperación real que usa el agente. La política
 * "cuando no hay información" se guarda con el borrador (Spec.knowledge).
 */
const emptyFaq = (): FaqInput => ({ question: "", answer: "", active: true });

function bytesToLabel(n: number): string {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function KnowledgeModule({ form, onChange }: { form: EditableBusinessAgentSpecForm; onChange: (f: EditableBusinessAgentSpecForm) => void }) {
  const { t } = useI18n();
  const { session } = useDashboard();
  const [data, setData] = useState<KnowledgeOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // FAQ
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<FaqInput>(emptyFaq());
  const [filter, setFilter] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  // Documentos
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Probar
  const [query, setQuery] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<KnowledgeSearchResponse | null>(null);

  const cargar = useCallback(async () => {
    if (!session) return;
    const r = await getBusinessAgentKnowledge({ accessToken: session.access_token });
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else {
      setError(r.error.message);
    }
  }, [session]);

  useEffect(() => {
    // Carga al montar (mismo patrón que ServicesModule) -- intencional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  const faqsVisibles = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const todas = data?.faqs ?? [];
    return q ? todas.filter((f) => `${f.question} ${f.answer}`.toLowerCase().includes(q)) : todas;
  }, [data, filter]);

  // --- FAQ ---
  const abrirNueva = () => {
    setDraft(emptyFaq());
    setEditingId("new");
    setError(null);
    setWarnings([]);
  };
  const abrirEditar = (f: BusinessAgentFaq) => {
    setDraft({ question: f.question, answer: f.answer, active: f.active });
    setEditingId(f.id);
    setError(null);
    setWarnings([]);
  };
  const guardarFaq = async () => {
    if (!session || !editingId) return;
    setBusy(true);
    setError(null);
    const input: FaqInput = { question: draft.question.trim(), answer: draft.answer.trim(), active: draft.active ?? true };
    const r =
      editingId === "new"
        ? await createBusinessAgentFaq({ accessToken: session.access_token, input })
        : await updateBusinessAgentFaq({ accessToken: session.access_token, id: editingId, input });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setWarnings(r.data.warnings);
    setEditingId(null);
    await cargar();
  };
  const alternarFaq = async (f: BusinessAgentFaq) => {
    if (!session) return;
    setBusy(true);
    const r = await updateBusinessAgentFaq({ accessToken: session.access_token, id: f.id, input: { question: f.question, answer: f.answer, active: !f.active } });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else await cargar();
  };
  const eliminarFaq = async (f: BusinessAgentFaq) => {
    if (!session) return;
    if (!window.confirm(t(`¿Eliminar la pregunta "${f.question}"?`, `Delete the question "${f.question}"?`))) return;
    setBusy(true);
    setError(null);
    const r = await deleteBusinessAgentFaq({ accessToken: session.access_token, id: f.id });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else await cargar();
  };

  // --- Documentos ---
  const subir = async (file: File) => {
    if (!session) return;
    setError(null);
    // Chequeo previo de comodidad; el servidor valida de nuevo (firma real, tamaño, límites).
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!(KNOWLEDGE_DOC_EXTENSIONS as readonly string[]).includes(ext)) {
      setError(t(`Formato no soportado. Sube un archivo ${KNOWLEDGE_DOC_EXTENSIONS.map((e) => `.${e}`).join(", ")}.`, `Unsupported format. Upload a ${KNOWLEDGE_DOC_EXTENSIONS.map((e) => `.${e}`).join(", ")} file.`));
      return;
    }
    if (file.size > KNOWLEDGE_LIMITS.docMaxBytes) {
      setError(t(`El archivo pesa ${bytesToLabel(file.size)} y supera el límite de ${bytesToLabel(KNOWLEDGE_LIMITS.docMaxBytes)}.`, `The file is ${bytesToLabel(file.size)} and exceeds the ${bytesToLabel(KNOWLEDGE_LIMITS.docMaxBytes)} limit.`));
      return;
    }
    setUploading(true);
    const r = await uploadBusinessAgentDocument({ accessToken: session.access_token, file });
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    await cargar();
  };
  const eliminarDoc = async (id: string, nombre: string) => {
    if (!session) return;
    if (!window.confirm(t(`¿Eliminar el documento "${nombre}"? El agente dejará de usarlo.`, `Delete the document "${nombre}"? The agent will stop using it.`))) return;
    setBusy(true);
    setError(null);
    const r = await deleteBusinessAgentDocument({ accessToken: session.access_token, id });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else await cargar();
  };

  // --- Probar ---
  const probar = async () => {
    if (!session || !query.trim()) return;
    setTesting(true);
    setError(null);
    const r = await searchBusinessAgentKnowledge({ accessToken: session.access_token, query: query.trim() });
    setTesting(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setResult(r.data);
  };

  // --- Política sin información (Spec.knowledge) ---
  const knowledge = form.knowledge;
  const politica = knowledge.onNoAnswer ?? "message";
  const setKnowledge = (patch: Partial<typeof knowledge>) => onChange({ ...form, knowledge: { ...knowledge, ...patch } });
  const puedeTransferir = form.capabilities.humanHandoff;

  const total = (data?.faqs.filter((f) => f.active).length ?? 0) + (data?.documents.filter((d) => d.status === "ready").length ?? 0);

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-400">{error}</p>}

      <SectionCard
        title={t("Preguntas frecuentes", "Frequently asked questions")}
        description={t(
          "Respuestas exactas de tu negocio. El agente busca la más relevante a lo que pregunta el cliente -- no las recibe todas en cada mensaje.",
          "Exact answers from your business. The agent looks up the most relevant one for the customer's question -- it does not receive them all on every message.",
        )}
      >
        {warnings.map((w, i) => (
          <p key={i} className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-400">
            {w}
          </p>
        ))}
        {data === null ? (
          <p className="text-sm text-mist">{t("Cargando…", "Loading…")}</p>
        ) : (
          <div className="space-y-3">
            {data.faqs.length > 0 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-mist" />
                <input className={`${inputCls} pl-9`} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("Buscar en tus preguntas…", "Search your questions…")} />
              </div>
            )}
            {data.faqs.length === 0 && editingId !== "new" && (
              <p className="text-sm text-mist">{t("Todavía no has agregado preguntas frecuentes.", "You haven't added any FAQs yet.")}</p>
            )}
            {faqsVisibles.length > 0 && (
              <ul className="space-y-1.5">
                {faqsVisibles.map((f) => (
                  <li key={f.id} className="rounded-lg border border-edge bg-ink px-3 py-2.5 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-fg">{f.question}</span>
                          {!f.active && <Pill tone="neutral">{t("Inactiva", "Inactive")}</Pill>}
                        </div>
                        <p className="mt-0.5 whitespace-pre-line text-xs text-mist">{f.answer}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button type="button" onClick={() => alternarFaq(f)} disabled={busy} className={actionBtn}>
                          {f.active ? t("Desactivar", "Disable") : t("Activar", "Enable")}
                        </button>
                        <button type="button" onClick={() => abrirEditar(f)} disabled={busy} className={actionBtn} aria-label={t("Editar", "Edit")}>
                          <Pencil className="size-3.5" />
                        </button>
                        <button type="button" onClick={() => eliminarFaq(f)} disabled={busy} className={actionBtn} aria-label={t("Eliminar", "Delete")}>
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {filter && faqsVisibles.length === 0 && data.faqs.length > 0 && <p className="text-sm text-mist">{t("Ninguna pregunta coincide.", "No question matches.")}</p>}

            {editingId !== null ? (
              <div className="space-y-3 rounded-lg border border-edge bg-ink p-3">
                <Field label={t("Pregunta", "Question")} required>
                  <input className={inputCls} maxLength={KNOWLEDGE_LIMITS.faqQuestionMax} value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} placeholder={t("¿Cuál es el horario?", "What are your hours?")} />
                </Field>
                <Field
                  label={t("Respuesta", "Answer")}
                  required
                  hint={t("Puedes escribir la pregunta de varias formas en preguntas distintas: la búsqueda encuentra palabras parecidas, no sinónimos.", "You can add the same question phrased differently as separate entries: search matches similar words, not synonyms.")}
                >
                  <textarea className={inputCls} rows={3} maxLength={KNOWLEDGE_LIMITS.faqAnswerMax} value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} placeholder={t("Lunes a viernes de 8 a 6.", "Monday to Friday, 8 to 6.")} />
                </Field>
                <ToggleRow label={t("Activa", "Active")} hint={t("Desactivada = el agente no la usa.", "Disabled = the agent does not use it.")} checked={draft.active ?? true} onChange={(v) => setDraft({ ...draft, active: v })} />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={guardarFaq} disabled={busy || !draft.question.trim() || !draft.answer.trim()} className={primaryBtn}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                    {t("Guardar pregunta", "Save question")}
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} disabled={busy} className={actionBtn}>
                    {t("Cancelar", "Cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button type="button" onClick={abrirNueva} disabled={data.faqs.length >= KNOWLEDGE_LIMITS.faqMaxPerTenant} className={actionBtn}>
                  <Plus className="size-3.5" /> {t("Agregar pregunta", "Add question")}
                </button>
                <span className="text-[11px] text-mist">
                  {data.faqs.length}/{KNOWLEDGE_LIMITS.faqMaxPerTenant}
                </span>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={t("Documentos", "Documents")}
        description={t(
          "Sube manuales, políticas o listas (PDF, Excel, CSV o TXT). Se extrae el texto, se divide en fragmentos y se indexa: el agente solo recibe los fragmentos relevantes a cada pregunta, nunca el documento completo.",
          "Upload manuals, policies or lists (PDF, Excel, CSV or TXT). The text is extracted, split into fragments and indexed: the agent only receives the fragments relevant to each question, never the whole document.",
        )}
      >
        {data === null ? (
          <p className="text-sm text-mist">{t("Cargando…", "Loading…")}</p>
        ) : (
          <div className="space-y-3">
            {data.documents.length === 0 && <p className="text-sm text-mist">{t("Todavía no has subido documentos.", "You haven't uploaded any documents yet.")}</p>}
            {data.documents.length > 0 && (
              <ul className="space-y-1.5">
                {data.documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-edge bg-ink px-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <FileText className="size-3.5 shrink-0 text-mist" />
                        <span className="truncate font-medium text-fg">{d.filename}</span>
                        {d.status === "ready" && <Pill tone="success">{t("Procesado", "Processed")}</Pill>}
                        {d.status === "processing" && <Pill tone="info">{t("Procesando…", "Processing…")}</Pill>}
                        {d.status === "error" && <Pill tone="danger">{t("Error", "Error")}</Pill>}
                      </div>
                      <p className="mt-0.5 text-xs text-mist">
                        {bytesToLabel(d.sizeBytes)}
                        {d.status === "ready" ? ` · ${d.chunkCount} ${t("fragmentos", "fragments")}` : ""}
                        {d.truncated ? ` · ${t("se indexó solo el inicio (documento muy largo)", "only the beginning was indexed (very long document)")}` : ""}
                      </p>
                      {d.status === "error" && d.errorMessage && <p className="mt-0.5 text-xs text-red-400">{d.errorMessage}</p>}
                    </div>
                    <button type="button" onClick={() => eliminarDoc(d.id, d.filename)} disabled={busy} className={actionBtn} aria-label={t("Eliminar", "Delete")}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept={KNOWLEDGE_DOC_EXTENSIONS.map((e) => `.${e}`).join(",")}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void subir(f);
                }}
              />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || data.documents.filter((d) => d.status !== "error").length >= KNOWLEDGE_LIMITS.docMaxPerTenant} className={actionBtn}>
                {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                {uploading ? t("Procesando…", "Processing…") : t("Subir documento", "Upload document")}
              </button>
              <span className="text-[11px] text-mist">
                {t("Máx.", "Max")} {bytesToLabel(KNOWLEDGE_LIMITS.docMaxBytes)} · {data.documents.filter((d) => d.status !== "error").length}/{KNOWLEDGE_LIMITS.docMaxPerTenant}
              </span>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={t("Probar una pregunta", "Try a question")}
        description={t("Ejecuta la misma búsqueda que usa el agente y muestra los fragmentos que recibiría.", "Runs the same search the agent uses and shows the fragments it would receive.")}
      >
        <div className="flex gap-2">
          <input
            className={inputCls}
            value={query}
            maxLength={KNOWLEDGE_LIMITS.queryMaxChars}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void probar();
            }}
            placeholder={t("Ej. ¿Qué dice la política de cancelaciones?", "e.g. What is the cancellation policy?")}
          />
          <button type="button" onClick={probar} disabled={testing || !query.trim() || total === 0} className={primaryBtn}>
            {testing ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            {t("Probar", "Try")}
          </button>
        </div>
        {total === 0 && <p className="text-xs text-mist">{t("Agrega una pregunta frecuente o un documento para poder probar.", "Add an FAQ or a document to try it.")}</p>}
        {result && (
          <div className="space-y-2">
            {!result.found ? (
              <p className="rounded-lg border border-edge bg-ink p-3 text-xs text-mist">
                {t("No hay información relevante. El agente NO inventaría una respuesta: ", "No relevant information. The agent would NOT make up an answer: ")}
                <span className="text-fg">{politica === "handoff" ? t("transferiría a una persona.", "it would transfer to a person.") : `«${knowledge.noAnswerMessage?.trim() || DEFAULT_NO_ANSWER_MESSAGE}»`}</span>
              </p>
            ) : (
              result.hits.map((h, i) => (
                <div key={i} className="rounded-lg border border-edge bg-ink p-3 text-xs">
                  <div className="mb-1 flex items-center gap-2">
                    <Pill tone={h.source === "faq" ? "success" : "info"}>{h.source === "faq" ? t("Pregunta frecuente", "FAQ") : t("Documento", "Document")}</Pill>
                    <span className="font-medium text-fg">{h.title}</span>
                    <span className="text-mist">{Math.round(h.coverage * 100)}%</span>
                  </div>
                  <p className="whitespace-pre-line text-mist">{h.content}</p>
                </div>
              ))
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={t("Cuando no hay información", "When there is no information")}
        description={t(
          "Si lo que pregunta el cliente no está en tus preguntas ni documentos, el agente NO inventa: responde esto (la IA ni siquiera se invoca).",
          "If what the customer asks is not in your FAQs or documents, the agent does NOT make it up: it does this (the AI is not even invoked).",
        )}
      >
        <Field label={t("Qué hace el agente", "What the agent does")}>
          <select className={inputCls} value={politica} onChange={(e) => setKnowledge({ onNoAnswer: e.target.value as "message" | "handoff" })}>
            <option value="message">{t("Responder con un mensaje", "Reply with a message")}</option>
            <option value="handoff" disabled={!puedeTransferir}>
              {t("Transferir a una persona", "Transfer to a person")}
              {puedeTransferir ? "" : t(" (activa 'Transferir a un humano')", " (enable 'Human handoff')")}
            </option>
          </select>
        </Field>
        {politica === "message" && (
          <Field label={t("Mensaje", "Message")} hint={t("Vacío = mensaje estándar.", "Empty = standard message.")}>
            <textarea className={inputCls} rows={2} maxLength={NO_ANSWER_MESSAGE_MAX} value={knowledge.noAnswerMessage ?? ""} onChange={(e) => setKnowledge({ noAnswerMessage: e.target.value })} placeholder={DEFAULT_NO_ANSWER_MESSAGE} />
          </Field>
        )}
        {total === 0 && data !== null && (
          <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-400">
            {t("Para publicar necesitas al menos una pregunta activa o un documento procesado.", "To publish you need at least one active question or one processed document.")}
          </p>
        )}
      </SectionCard>
    </div>
  );
}
