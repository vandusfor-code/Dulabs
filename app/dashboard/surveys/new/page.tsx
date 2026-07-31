"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Save, Play, Workflow, FileUp, Download, X, Check, MessageSquareText } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useDashboard, type Negocio } from "@/lib/dashboard-session";
import { createBlankQuestion, estimatedMinutes, isChoiceType, isScaleType, newQuestionId, type SurveyQuestion } from "@/lib/survey-builder";
import { BuilderTabs, type BuilderTab } from "@/components/dashboard/surveys/builder/BuilderTabs";
import { QuestionsList } from "@/components/dashboard/surveys/builder/QuestionsList";
import { QuestionEditor } from "@/components/dashboard/surveys/builder/QuestionEditor";
import { WhatsAppPreview } from "@/components/dashboard/surveys/builder/WhatsAppPreview";
import { SummaryBar } from "@/components/dashboard/surveys/builder/SummaryBar";
import { TabPlaceholder } from "@/components/dashboard/surveys/builder/TabPlaceholder";
import { SurveySimulator } from "@/components/dashboard/surveys/SurveySimulator";
import { InvitarPanel } from "@/components/dashboard/surveys/InvitarPanel";
import { toEngineConfig, type RemoteBotConfig } from "@/lib/survey-remote-config";
import { DEFAULT_SURVEY_BOT_CONFIG } from "@/lib/survey-engine";
import type { EncuestaExtraida } from "@/lib/survey-import";

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Asegura los campos coherentes con el tipo (opciones para choice, etiquetas para escala). */
function normalize(q: SurveyQuestion): SurveyQuestion {
  const next = { ...q };
  if (isChoiceType(next.type)) {
    if (!next.options || next.options.length === 0) next.options = ["", ""];
  }
  if (isScaleType(next.type)) {
    next.minLabel ??= "";
    next.maxLabel ??= "";
  }
  return next;
}

/**
 * Punto de partida en blanco para "+ Nueva encuesta" — mismos textos por
 * defecto que usa el backend (DEFAULT_SURVEY_BOT_CONFIG), pero con
 * `questions: []` y `active: false`. Existe porque el GET del backend, si ya
 * hay una encuesta guardada para el número, siempre devuelve esa encuesta
 * real (correcto para "Editar encuesta →"); esta función es lo que se
 * muestra en el builder cuando el usuario llegó pidiendo explícitamente
 * "nueva", para no arrastrar preguntas de una encuesta que ya existe.
 */
function encuestaEnBlanco(phoneNumberId: string, brandNameFallback: string): RemoteBotConfig {
  return {
    phone_number_id: phoneNumberId,
    survey_name: "",
    brand_name: DEFAULT_SURVEY_BOT_CONFIG.brandName === "nuestro servicio" ? brandNameFallback : DEFAULT_SURVEY_BOT_CONFIG.brandName,
    agent_name: DEFAULT_SURVEY_BOT_CONFIG.agentName,
    intro_template: DEFAULT_SURVEY_BOT_CONFIG.introTemplate,
    closing_template: DEFAULT_SURVEY_BOT_CONFIG.closingTemplate,
    decline_template: DEFAULT_SURVEY_BOT_CONFIG.declineTemplate,
    schedule_confirm_template: DEFAULT_SURVEY_BOT_CONFIG.scheduleConfirmTemplate,
    milestone_half: DEFAULT_SURVEY_BOT_CONFIG.milestones.half,
    milestone_two_left: DEFAULT_SURVEY_BOT_CONFIG.milestones.twoLeft,
    milestone_last: DEFAULT_SURVEY_BOT_CONFIG.milestones.last,
    reminder_delay_hours: DEFAULT_SURVEY_BOT_CONFIG.reminder.delayHours,
    reminder_max: DEFAULT_SURVEY_BOT_CONFIG.reminder.maxReminders,
    reminder_template: DEFAULT_SURVEY_BOT_CONFIG.reminder.template,
    allow_change_answers: DEFAULT_SURVEY_BOT_CONFIG.allowChangeAnswers,
    questions: [],
    close_date: null,
    invite_template_name: "du_encuesta_invitacion",
    reminder_template_name: "du_encuesta_recordatorio",
    active: false,
  };
}

const inputCls =
  "w-full rounded-lg border border-edge bg-ink px-3 py-2.5 text-sm text-fg outline-none transition-colors focus:border-lime/50";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-mist">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[10.5px] text-mist/70">{hint}</p>}
    </div>
  );
}

const actionBtn =
  "flex items-center gap-2 rounded-lg border border-edge px-3.5 py-2 text-sm font-medium text-fg transition-colors hover:border-lime/40 disabled:cursor-not-allowed disabled:opacity-50";

export default function CreateSurveyPage() {
  const { t } = useI18n();
  const { session, negocios } = useDashboard();
  const accessToken = session?.access_token;

  // Selección explícita del usuario (o precargada por ?phone_number_id= en
  // la URL). Si el tenant solo tiene un número, se usa ese por defecto — sin
  // guardar un estado aparte para ello, se deriva en cada render.
  const [phoneNumberIdElegido, setPhoneNumberIdElegido] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("phone_number_id");
  });
  // "Editar encuesta →" (desde el detalle de una encuesta) llega con
  // ?phone_number_id= en la URL — es la ÚNICA forma de decir "quiero seguir
  // editando lo que ya existe para este número". Cualquier otra manera de
  // llegar aquí (el botón "+ Nueva encuesta", el ítem del menú lateral, o
  // luego cambiar el número en el selector de abajo) debe partir en blanco,
  // aunque ese número YA tenga una encuesta guardada — nunca arrastrar sus
  // preguntas sin que el usuario lo haya pedido explícitamente. Se calcula
  // una sola vez al montar: cambiar el <select> después no debe convertir
  // "nueva" en "editar".
  const [modoEdicion] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).has("phone_number_id");
  });
  const phoneNumberId = phoneNumberIdElegido ?? (negocios && negocios.length === 1 ? negocios[0].phone_number_id : null);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col">
      <div className="border-b border-edge px-4 py-5 md:px-6">
        <nav className="flex items-center gap-1.5 text-sm text-mist" aria-label="Breadcrumb">
          <Link href="/dashboard/surveys" className="transition-colors hover:text-fg">
            {t("Encuestas", "Surveys")}
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="text-fg">{modoEdicion ? t("Editar encuesta", "Edit survey") : t("Nueva encuesta", "New survey")}</span>
        </nav>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg md:text-[26px]">
          {modoEdicion ? t("Editar encuesta", "Edit survey") : t("Crear encuesta", "Create survey")}
        </h1>
        <div className="mt-3 max-w-xs">
          <label className="mb-1.5 block text-xs font-medium text-mist">{t("Número de WhatsApp", "WhatsApp number")}</label>
          <select value={phoneNumberId ?? ""} onChange={(e) => setPhoneNumberIdElegido(e.target.value || null)} className={inputCls}>
            <option value="">{t("Selecciona un número…", "Select a number…")}</option>
            {negocios?.map((n) => (
              <option key={n.phone_number_id} value={n.phone_number_id}>
                {n.nombre_negocio}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!phoneNumberId ? (
        <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-mist">
          {t("Elige un número de WhatsApp para crear o editar su encuesta.", "Choose a WhatsApp number to create or edit its survey.")}
        </div>
      ) : accessToken ? (
        <SurveyEditor key={phoneNumberId} phoneNumberId={phoneNumberId} accessToken={accessToken} negocios={negocios ?? []} modoEdicion={modoEdicion} />
      ) : null}
    </div>
  );
}

function SurveyEditor({
  phoneNumberId,
  accessToken,
  negocios,
  modoEdicion,
}: {
  phoneNumberId: string;
  accessToken: string;
  negocios: Negocio[];
  modoEdicion: boolean;
}) {
  const { t } = useI18n();

  const [remote, setRemote] = useState<RemoteBotConfig | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<"borrador" | "publicar" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<BuilderTab>("questions");
  const [toast, setToast] = useState<string | null>(null);
  const [mostrarSimulador, setMostrarSimulador] = useState(false);

  // Instantánea de lo que YA está publicado en producción (tal como llegó del
  // GET, antes de cualquier edición local) — sirve para detectar si un
  // guardado está a punto de reducir/vaciar una encuesta que ya está activa,
  // y pedir confirmación antes de sobrescribirla en silencio.
  const [publicado, setPublicado] = useState<{ activo: boolean; preguntas: number } | null>(null);
  const [confirmandoSobrescritura, setConfirmandoSobrescritura] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`/api/dashboard/survey-bot-config?phone_number_id=${encodeURIComponent(phoneNumberId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => res.json())
      .then((data: RemoteBotConfig) => {
        // El "publicado" (para el candado de sobrescritura) siempre refleja
        // lo que REALMENTE hay guardado, sin importar el modo. Lo que se
        // muestra en el builder es distinto: en modo edición, lo real; en
        // modo "nueva", siempre en blanco — aunque el número ya tenga algo.
        // `existe` solo viene en true cuando el GET encontró una fila real —
        // si el número nunca se configuró, el backend responde con una
        // encuesta de ejemplo (`active: true` incluido) solo para tener algo
        // que mostrar; sin `existe`, no hay nada real que proteger.
        setPublicado({
          activo: Boolean(data.existe) && data.active,
          preguntas: data.questions.filter((q) => q.type !== "message").length,
        });
        const negocio = negocios.find((n) => n.phone_number_id === phoneNumberId);
        const inicial = modoEdicion ? data : encuestaEnBlanco(phoneNumberId, negocio?.nombre_negocio ?? "");
        setRemote(inicial);
        setSelectedId(inicial.questions[0]?.id ?? null);
      })
      .finally(() => setCargando(false));
  }, [phoneNumberId, accessToken, modoEdicion, negocios]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  const questions = remote?.questions ?? [];
  const selectedIndex = questions.findIndex((q) => q.id === selectedId);
  const selectedQuestion = selectedIndex >= 0 ? questions[selectedIndex] : null;

  const setQuestions = (next: SurveyQuestion[]) => setRemote((r) => (r ? { ...r, questions: next } : r));

  const updateQuestion = (id: string, patch: Partial<SurveyQuestion>) =>
    setQuestions(questions.map((q) => (q.id === id ? normalize({ ...q, ...patch }) : q)));

  const addQuestion = () => {
    const q = createBlankQuestion();
    const at = selectedIndex >= 0 ? selectedIndex + 1 : questions.length;
    const next = [...questions];
    next.splice(at, 0, q);
    setQuestions(next);
    setSelectedId(q.id);
  };

  const duplicateQuestion = (id: string) => {
    const idx = questions.findIndex((q) => q.id === id);
    if (idx < 0) return;
    const copy: SurveyQuestion = { ...questions[idx], id: newQuestionId(), options: questions[idx].options ? [...questions[idx].options!] : undefined };
    const next = [...questions];
    next.splice(idx + 1, 0, copy);
    setQuestions(next);
    setSelectedId(copy.id);
  };

  const deleteQuestion = (id: string) => {
    const idx = questions.findIndex((q) => q.id === id);
    if (idx < 0) return;
    const next = questions.filter((q) => q.id !== id);
    setQuestions(next);
    if (selectedId === id) setSelectedId(next[Math.min(idx, next.length - 1)]?.id ?? null);
  };

  const moveQuestion = (id: string, dir: -1 | 1) => {
    const idx = questions.findIndex((q) => q.id === id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= questions.length) return;
    setQuestions(arrayMove(questions, idx, to));
  };

  const reorder = (from: number, to: number) => setQuestions(arrayMove(questions, from, to));

  const set = <K extends keyof RemoteBotConfig>(key: K, value: RemoteBotConfig[K]) => setRemote((r) => (r ? { ...r, [key]: value } : r));

  const guardarReal = useCallback(
    async (activar: boolean) => {
      if (!remote) return;
      setGuardando(activar ? "publicar" : "borrador");
      try {
        const res = await fetch("/api/dashboard/survey-bot-config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ ...remote, active: activar }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("Error guardando", "Error saving"));
        setRemote((r) => (r ? { ...r, active: activar } : r));
        // Este guardado ya es el nuevo "publicado" — futuras comparaciones de
        // sobrescritura deben medirse contra esto, no contra el estado con el
        // que se abrió el builder.
        setPublicado({
          activo: activar,
          preguntas: questions.filter((q) => q.type !== "message").length,
        });
        setToast(
          activar
            ? t("Encuesta publicada. El bot ya usa estas preguntas en producción.", "Survey published. The bot now uses these questions in production.")
            : t("Borrador guardado.", "Draft saved.")
        );
      } catch (err) {
        setToast(err instanceof Error ? err.message : String(err));
      } finally {
        setGuardando(null);
      }
    },
    [remote, accessToken, questions, t]
  );

  const guardar = useCallback(
    (activar: boolean) => {
      if (!remote) return;
      if (activar && questions.filter((q) => q.type !== "message").length === 0) {
        setToast(t("Agrega al menos una pregunta antes de publicar", "Add at least one question before publishing"));
        return;
      }
      if (activar && !remote.survey_name.trim()) {
        setToast(t("Ponle un nombre a la encuesta antes de publicar (pestaña Ajustes)", "Name the survey before publishing (Settings tab)"));
        setActiveTab("settings");
        return;
      }
      // Candado contra sobrescritura silenciosa: si esta encuesta YA está
      // activa en producción y este guardado la dejaría con MENOS preguntas
      // (por ejemplo 0, si se abrió el builder para "empezar de nuevo" sin
      // darse cuenta de que es la MISMA encuesta del número, no una nueva),
      // pedir confirmación explícita en vez de guardar directo.
      const preguntasActuales = questions.filter((q) => q.type !== "message").length;
      if (publicado?.activo && preguntasActuales < publicado.preguntas) {
        setConfirmandoSobrescritura(activar);
        return;
      }
      guardarReal(activar);
    },
    [remote, questions, t, guardarReal, publicado]
  );

  // --- Importar desde Excel ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importando, setImportando] = useState(false);
  const [propuesta, setPropuesta] = useState<EncuestaExtraida | null>(null);
  const [errorImportar, setErrorImportar] = useState<string | null>(null);

  const importar = useCallback(
    async (archivo: File) => {
      setImportando(true);
      setErrorImportar(null);
      setPropuesta(null);
      try {
        const form = new FormData();
        form.append("archivo", archivo);
        form.append("phone_number_id", phoneNumberId);
        const res = await fetch("/api/dashboard/surveys/importar", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: form,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("Error importando el archivo", "Error importing the file"));
        const resultado = data as EncuestaExtraida;
        if (resultado.preguntas.length === 0 && resultado.destinatarios.length === 0) {
          setErrorImportar(t("No se encontraron preguntas ni contactos en el archivo.", "No questions or contacts were found in the file."));
        } else {
          setPropuesta(resultado);
        }
      } catch (err) {
        setErrorImportar(err instanceof Error ? err.message : String(err));
      } finally {
        setImportando(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [accessToken, phoneNumberId, t]
  );

  const aplicarPreguntas = useCallback(() => {
    if (!propuesta || propuesta.preguntas.length === 0) return;
    setQuestions([...questions, ...propuesta.preguntas]);
    setActiveTab("questions");
    setToast(t(`${propuesta.preguntas.length} preguntas agregadas.`, `${propuesta.preguntas.length} questions added.`));
  }, [propuesta, questions, t]);

  const numeroActual = negocios.find((n) => n.phone_number_id === phoneNumberId) ?? null;
  const estadoLabel = !remote ? "—" : remote.active ? t("Activa", "Active") : t("Borrador", "Draft");
  const [modoBienvenida, setModoBienvenida] = useState<"ventana24h" | "primerContacto">("ventana24h");

  if (cargando || !remote) {
    return <div className="flex flex-1 items-center justify-center p-10 text-sm text-mist">{t("Cargando…", "Loading…")}</div>;
  }

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-3 md:px-6">
          <span className="rounded-full bg-ink px-2 py-0.5 text-xs font-medium text-mist">{estadoLabel}</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importar(f);
              }}
            />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={importando} className={actionBtn} title={t("Sube un .xlsx con el formato oficial (hojas Preguntas/Contactos) o cualquier archivo suelto — la IA arma la propuesta si no coincide.", "Upload an .xlsx with the official format (Preguntas/Contactos sheets) or any loose file — AI builds the proposal if it doesn't match.")}>
              <FileUp className="size-4" /> {importando ? t("Analizando…", "Analyzing…") : t("Importar Excel", "Import Excel")}
            </button>
            <a href="/plantillas/encuesta-plantilla.xlsx" download className={actionBtn}>
              <Download className="size-4" /> {t("Plantilla", "Template")}
            </a>
            <button type="button" onClick={() => guardar(false)} disabled={guardando !== null} className={actionBtn}>
              <Save className="size-4" /> {guardando === "borrador" ? t("Guardando…", "Saving…") : t("Guardar borrador", "Save draft")}
            </button>
            <button type="button" onClick={() => setMostrarSimulador(true)} className={actionBtn}>
              <MessageSquareText className="size-4" /> {t("Probar encuesta", "Test survey")}
            </button>
            <button
              type="button"
              onClick={() => guardar(true)}
              disabled={guardando !== null}
              className="flex items-center gap-2 rounded-lg bg-lime px-3.5 py-2 text-sm font-semibold text-lime-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play className="size-4" /> {guardando === "publicar" ? t("Publicando…", "Publishing…") : t("Publicar encuesta", "Publish survey")}
            </button>
          </div>
        </div>

        {(errorImportar || propuesta) && (
          <div className="border-b border-edge px-4 py-3 md:px-6">
            {errorImportar && <p className="text-xs text-red-400">{errorImportar}</p>}
            {propuesta && (
              <div className="rounded-xl border border-lime/30 bg-lime/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-fg">
                    {propuesta.metodo === "estructurado"
                      ? t(
                          `Leído con la plantilla oficial: ${propuesta.preguntas.length} preguntas y ${propuesta.destinatarios.length} contactos.`,
                          `Read with the official template: ${propuesta.preguntas.length} questions and ${propuesta.destinatarios.length} contacts.`
                        )
                      : t(
                          `Interpretado por IA: ${propuesta.preguntas.length} preguntas y ${propuesta.destinatarios.length} contactos.`,
                          `Interpreted by AI: ${propuesta.preguntas.length} questions and ${propuesta.destinatarios.length} contacts.`
                        )}
                  </p>
                  <button onClick={() => setPropuesta(null)} className="text-mist hover:text-fg" aria-label={t("Descartar", "Discard")}>
                    <X className="size-4" />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {propuesta.preguntas.length > 0 && (
                    <div>
                      <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{t("Preguntas", "Questions")}</p>
                      <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto text-xs text-mist">
                        {propuesta.preguntas.map((p) => (
                          <li key={p.id} className="truncate">
                            • {p.text}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {propuesta.destinatarios.length > 0 && (
                    <div>
                      <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{t("Contactos", "Contacts")}</p>
                      <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto text-xs text-mist">
                        {propuesta.destinatarios.map((d, i) => (
                          <li key={`${d.telefono}-${i}`} className="truncate">
                            • {d.nombre ? `${d.nombre} — ${d.telefono}` : d.telefono}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {propuesta.preguntas.length > 0 && (
                    <button onClick={aplicarPreguntas} className="flex items-center gap-2 rounded-lg bg-lime px-3.5 py-1.5 text-xs font-semibold text-lime-fg hover:opacity-90">
                      <Check className="size-3.5" /> {t("Agregar preguntas al Builder", "Add questions to the Builder")}
                    </button>
                  )}
                  {propuesta.destinatarios.length > 0 && (
                    <button
                      onClick={() => setActiveTab("settings")}
                      className="flex items-center gap-2 rounded-lg border border-edge px-3.5 py-1.5 text-xs font-medium text-fg hover:border-lime/40"
                    >
                      {t("Ir a Ajustes para enviarles la encuesta →", "Go to Settings to send them the survey →")}
                    </button>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-mist/70">
                  {t(
                    "Las preguntas quedan editables en la lista de abajo tras agregarlas. Los contactos ya quedan listos para enviar en Ajustes → Enviar invitaciones, con casilla para elegir cuáles.",
                    "Questions stay editable in the list below once added. Contacts are ready to send in Settings → Send invitations, with a checkbox to pick which ones."
                  )}
                </p>
              </div>
            )}
          </div>
        )}

        <BuilderTabs active={activeTab} onChange={setActiveTab} />

        <div className="flex-1 px-4 py-5 md:px-6">
          {activeTab === "questions" ? (
            <>
              <p className="mb-4 text-xs leading-relaxed text-mist">
                {t(
                  "¿Vas a importar desde Excel? Usa la plantilla oficial (botón \"Plantilla\" arriba): hoja \"Preguntas\" con columnas Pregunta / Tipo / Obligatoria / Opción 1, 2, 3… y hoja \"Contactos\" con Teléfono / Nombre. Si subes ese formato se lee exacto, sin IA; cualquier otro archivo se interpreta con IA.",
                  "Importing from Excel? Use the official template (\"Template\" button above): a \"Preguntas\" sheet with Pregunta / Tipo / Obligatoria / Opción 1, 2, 3… columns and a \"Contactos\" sheet with Teléfono / Nombre. That exact format is read precisely, no AI; any other file gets interpreted by AI."
                )}
              </p>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <QuestionsList
                  questions={questions}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onAdd={addQuestion}
                  onDuplicate={duplicateQuestion}
                  onDelete={deleteQuestion}
                  onMove={moveQuestion}
                  onReorder={reorder}
                />
                {selectedQuestion ? (
                  <QuestionEditor
                    key={selectedQuestion.id}
                    question={selectedQuestion}
                    index={selectedIndex}
                    onChange={(patch) => updateQuestion(selectedQuestion.id, patch)}
                    onDuplicate={() => duplicateQuestion(selectedQuestion.id)}
                    onDelete={() => deleteQuestion(selectedQuestion.id)}
                  />
                ) : (
                  <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-edge bg-card p-6 text-center text-sm text-mist">
                    {t("Selecciona o agrega una pregunta para editarla.", "Select or add a question to edit it.")}
                  </div>
                )}
              </div>

              <div className="mt-4">
                <SummaryBar estMinutes={estimatedMinutes(questions.length)} totalQuestions={questions.length} conditionalPaths={0} estadoLabel={estadoLabel} />
              </div>
            </>
          ) : activeTab === "flow" ? (
            <TabPlaceholder
              icon={Workflow}
              title={t("Flujo condicional", "Conditional flow")}
              description={t(
                "El motor de encuestas responde una pregunta a la vez, en orden — todavía no soporta ramificar según la respuesta.",
                "The survey engine asks one question at a time, in order — it doesn't support branching by answer yet."
              )}
              bullets={[
                t("SI la respuesta de Qx ES un valor, ENTONCES ir a Qy", "IF answer of Qx IS a value, THEN go to Qy"),
                t("Saltos y rutas condicionales entre preguntas", "Jumps and conditional paths between questions"),
              ]}
            />
          ) : activeTab === "engagement" ? (
            <div className="mx-auto max-w-xl space-y-4">
              <Field label={t("Motivación al 50%", "Halfway nudge")}>
                <input value={remote.milestone_half} onChange={(e) => set("milestone_half", e.target.value)} className={inputCls} />
              </Field>
              <Field label={t("Motivación al faltar 2", "Two-left nudge")}>
                <input value={remote.milestone_two_left} onChange={(e) => set("milestone_two_left", e.target.value)} className={inputCls} />
              </Field>
              <Field label={t("Última pregunta", "Last question")}>
                <input value={remote.milestone_last} onChange={(e) => set("milestone_last", e.target.value)} className={inputCls} />
              </Field>
              <Field label={t("Mensaje de cierre", "Closing message")} hint="{brand}">
                <textarea rows={2} value={remote.closing_template} onChange={(e) => set("closing_template", e.target.value)} className={`${inputCls} resize-none`} />
              </Field>
            </div>
          ) : activeTab === "recovery" ? (
            <div className="mx-auto max-w-xl space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("Recordatorio tras (horas)", "Reminder after (hours)")}>
                  <input
                    type="number"
                    min={1}
                    max={72}
                    value={remote.reminder_delay_hours}
                    onChange={(e) => set("reminder_delay_hours", Math.max(1, Number(e.target.value) || 1))}
                    className={inputCls}
                  />
                </Field>
                <Field label={t("Máx. recordatorios", "Max reminders")}>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    value={remote.reminder_max}
                    onChange={(e) => set("reminder_max", Math.max(0, Number(e.target.value) || 0))}
                    className={inputCls}
                  />
                </Field>
              </div>
              <Field label={t("Mensaje de recuperación", "Recovery message")} hint={t("Se envía para retomar una encuesta abandonada. Usa {brand}.", "Sent to resume an abandoned survey. Use {brand}.")}>
                <textarea rows={2} value={remote.reminder_template} onChange={(e) => set("reminder_template", e.target.value)} className={`${inputCls} resize-none`} />
              </Field>
              <Field label={t("Mensaje al no querer continuar", "Decline message")} hint="{closeDate}">
                <textarea rows={2} value={remote.decline_template} onChange={(e) => set("decline_template", e.target.value)} className={`${inputCls} resize-none`} />
              </Field>
              <label className="flex items-center gap-2.5 text-sm text-fg">
                <input type="checkbox" checked={remote.allow_change_answers} onChange={(e) => set("allow_change_answers", e.target.checked)} className="size-4 accent-lime" />
                {t("Permitir cambiar respuestas anteriores", "Allow changing previous answers")}
              </label>
            </div>
          ) : (
            <div className="mx-auto max-w-xl space-y-4">
              <Field
                label={t("Nombre de la encuesta", "Survey name")}
                hint={t(
                  "Ej. \"Encuesta de satisfacción Q3\". Es el nombre que ves en la lista de Encuestas y llena {{nombre_encuesta}} en la plantilla de invitación de Meta — distinto del nombre de tu empresa.",
                  "E.g. \"Q3 satisfaction survey\". This is the name shown in the Surveys list and fills {{nombre_encuesta}} in Meta's invitation template — different from your company name."
                )}
              >
                <div className="flex items-center gap-2">
                  <input
                    value={remote.survey_name}
                    maxLength={60}
                    onChange={(e) => set("survey_name", e.target.value)}
                    placeholder={t("Ej. Encuesta de satisfacción Q3", "e.g. Q3 satisfaction survey")}
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={() => guardar(false)}
                    disabled={guardando !== null}
                    title={t("Guardar nombre", "Save name")}
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-edge text-mist transition-colors hover:border-lime/40 hover:text-lime-text disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Check className="size-4" />
                  </button>
                </div>
              </Field>
              <Field label={t("Nombre de la empresa o servicio", "Company or service name")} hint={t("Aparece en los mensajes del bot (variable {brand}).", "Shown in the bot's messages ({brand} variable).")}>
                <div className="flex items-center gap-2">
                  <input value={remote.brand_name} maxLength={60} onChange={(e) => set("brand_name", e.target.value)} className={inputCls} />
                  <button
                    type="button"
                    onClick={() => guardar(false)}
                    disabled={guardando !== null}
                    title={t("Guardar nombre", "Save name")}
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-edge text-mist transition-colors hover:border-lime/40 hover:text-lime-text disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Check className="size-4" />
                  </button>
                </div>
              </Field>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-mist">{t("¿Cómo le llega la invitación a tu contacto?", "How does the invitation reach your contact?")}</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setModoBienvenida("ventana24h")}
                    className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${modoBienvenida === "ventana24h" ? "border-lime/50 bg-lime/10 text-lime-text" : "border-edge text-mist hover:text-fg"}`}
                  >
                    {t("Ya te escribió (< 24h)", "Already wrote to you (< 24h)")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setModoBienvenida("primerContacto")}
                    className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${modoBienvenida === "primerContacto" ? "border-lime/50 bg-lime/10 text-lime-text" : "border-edge text-mist hover:text-fg"}`}
                  >
                    {t("Primer contacto", "First contact")}
                  </button>
                </div>
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-mist/70">
                  {t(
                    "Esto es solo para que veas cuál mensaje aplica a cuál caso — Du Labs ya elige automáticamente la ruta correcta por cada contacto al enviar. Nunca se mandan los dos.",
                    "This is just so you can see which message applies to which case — Du Labs already picks the right path automatically per contact when sending. Never both."
                  )}
                </p>
              </div>

              {modoBienvenida === "ventana24h" ? (
                <Field
                  label={t("Mensaje de bienvenida", "Welcome message")}
                  hint={t("Texto libre que TÚ controlas — se envía solo cuando el contacto ya te escribió antes. Usa {brand} y {count}.", "Free text you control — sent only when the contact already wrote to you before. Use {brand} and {count}.")}
                >
                  <textarea rows={3} value={remote.intro_template} onChange={(e) => set("intro_template", e.target.value)} className={`${inputCls} resize-none`} />
                </Field>
              ) : (
                <div className="rounded-lg border border-edge bg-ink p-3">
                  <p className="text-sm font-medium text-fg">{t("Se usa tu plantilla aprobada de Meta", "Your approved Meta template is used")}</p>
                  <p className="mt-1 text-xs leading-relaxed text-mist">
                    {t(
                      `Plantilla configurada: "${remote.invite_template_name || "—"}". Su texto es fijo — no se edita aquí, se edita/aprueba en tu Administrador de Meta. Esta pantalla solo le manda las variables {{nombre_cliente}} y {{nombre_encuesta}}.`,
                      `Configured template: "${remote.invite_template_name || "—"}". Its text is fixed — it's not edited here, it's edited/approved in your Meta Business Manager. This screen only sends it the {{nombre_cliente}} and {{nombre_encuesta}} variables.`
                    )}
                  </p>
                  <Link href="/dashboard/plantillas" className="mt-2 inline-block text-xs font-medium text-lime-text hover:text-fg">
                    {t("Ver mis plantillas →", "View my templates →")}
                  </Link>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t("Fecha de cierre de la encuesta", "Survey close date")}>
                  <input type="date" value={remote.close_date ?? ""} onChange={(e) => set("close_date", e.target.value || null)} className={inputCls} />
                </Field>
                <Field label={t("Activa", "Active")}>
                  <label className="flex h-[42px] items-center gap-2.5 rounded-lg border border-edge bg-ink px-3 text-sm text-fg">
                    <input type="checkbox" checked={remote.active} onChange={(e) => set("active", e.target.checked)} className="size-4 accent-lime" />
                    {remote.active ? t("Sí, respondiendo", "Yes, replying") : t("No (borrador)", "No (draft)")}
                  </label>
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t("Plantilla Meta — invitación", "Meta template — invite")} hint={t("Debe existir APROBADA en /dashboard/plantillas.", "Must exist APPROVED in /dashboard/plantillas.")}>
                  <input value={remote.invite_template_name} onChange={(e) => set("invite_template_name", e.target.value)} className={inputCls} />
                </Field>
                <Field label={t("Plantilla Meta — recordatorio", "Meta template — reminder")}>
                  <input value={remote.reminder_template_name} onChange={(e) => set("reminder_template_name", e.target.value)} className={inputCls} />
                </Field>
              </div>

              <InvitarPanel
                key={JSON.stringify(propuesta?.destinatarios ?? [])}
                phoneNumberId={phoneNumberId}
                accessToken={accessToken}
                contactosSugeridos={propuesta?.destinatarios ?? []}
              />
            </div>
          )}
        </div>
      </div>

      {/* WhatsApp preview */}
      <aside className="shrink-0 border-t border-edge lg:w-[340px] lg:border-l lg:border-t-0 xl:w-[360px]">
        <div className="p-4 lg:sticky lg:top-16 md:p-6 lg:p-4">
          <WhatsAppPreview
            businessName={remote.brand_name || numeroActual?.nombre_negocio}
            greeting={remote.intro_template.replace("{brand}", remote.brand_name).replace("{count}", String(questions.filter((q) => q.type !== "message").length))}
            questions={questions}
            selectedId={selectedId}
            onSelectScenario={(id) => setSelectedId(id)}
            onSendTest={() => setMostrarSimulador(true)}
          />
        </div>
      </aside>

      {/* Simulador */}
      {mostrarSimulador && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setMostrarSimulador(false)}>
          <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-end">
              <button onClick={() => setMostrarSimulador(false)} className="flex size-8 items-center justify-center rounded-lg bg-card text-mist hover:text-fg" aria-label={t("Cerrar", "Close")}>
                <X className="size-4" />
              </button>
            </div>
            <SurveySimulator config={toEngineConfig(remote)} questions={questions} />
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-edge bg-card px-4 py-2.5 text-sm text-fg shadow-xl" role="status">
          {toast}
        </div>
      )}

      {/* Confirmación antes de sobrescribir una encuesta activa con menos preguntas */}
      {confirmandoSobrescritura !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setConfirmandoSobrescritura(null)}
        >
          <div className="w-full max-w-md rounded-xl border border-edge bg-card p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-fg">
              {t("Esta encuesta ya está activa en producción", "This survey is already live in production")}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-mist">
              {t(
                `Ahora mismo tiene ${publicado?.preguntas ?? 0} preguntas y está respondiendo a clientes. Guardar así la dejará con ${questions.filter((q) => q.type !== "message").length} preguntas${confirmandoSobrescritura ? "" : " y la pasará a borrador (dejará de responder)"}. Esto no se puede deshacer.`,
                `Right now it has ${publicado?.preguntas ?? 0} questions and is replying to customers. Saving now will leave it with ${questions.filter((q) => q.type !== "message").length} questions${confirmandoSobrescritura ? "" : " and switch it to draft (it will stop replying)"}. This can't be undone.`
              )}
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmandoSobrescritura(null)}
                className="rounded-lg px-3.5 py-2 text-sm font-medium text-mist hover:text-fg"
              >
                {t("Cancelar", "Cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const activar = confirmandoSobrescritura;
                  setConfirmandoSobrescritura(null);
                  guardarReal(activar);
                }}
                className="rounded-lg bg-red-500/15 px-3.5 py-2 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/25"
              >
                {t("Sí, guardar así", "Yes, save anyway")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
