"use client";

/**
 * Administración de tienda — PREGUNTAS FRECUENTES de la página «Mayoristas»: lo mismo que se edita en «Contenido» (tema «Mayoristas»), pero a la vista como la ve el cliente: la introducción, las preguntas
 * en su orden, lo que se suma al final de la página (envíos, pagos…) y lo que NO se muestra en ella. Agregar una pregunta pide solo dos cosas —la pregunta y la respuesta—, la deja como borrador y abre el editor
 * para revisarla y publicarla. Todo lo que se publica aquí es lo mismo que usa ARIA: se escribe una sola vez.
 */
import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { ETIQUETAS_TEMA, type TemaContenido } from "@/lib/cms-comercial/contrato";
import type { EntidadResumen } from "@/lib/cms-comercial-client";
import { borradorInicial } from "@/components/dashboard/tienda/borrador";
import { useTienda } from "@/components/dashboard/tienda/contexto";
import { chipsDe, fechaHora } from "@/components/dashboard/tienda/formato";
import { MinimoMayorista } from "@/components/dashboard/tienda/minimo-mayorista";
import { Aviso, BotonCargando, CampoArea, CampoTexto, Cargando, ChipUi, Dialogo, actionBtn, cn, primaryBtn } from "@/components/dashboard/tienda/ui";

const TEMA_PREGUNTAS: TemaContenido = "mayoristas";
/** De cuánto en cuánto se numera el orden de las preguntas (deja espacio para meter una en medio sin renumerar). */
const PASO_ORDEN = 10;
const MAX_ORDEN = 1000;

const sinAcentos = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const porOrden = (a: EntidadResumen, b: EntidadResumen) => (a.orden ?? 0) - (b.orden ?? 0) || sinAcentos(a.nombre).localeCompare(sinAcentos(b.nombre)) || a.clave.localeCompare(b.clave);

function Fila({ item, nota, onAbrir }: { item: EntidadResumen; nota?: string; onAbrir: (id: string) => void }) {
  const { t } = useI18n();
  return (
    <li>
      <button type="button" onClick={() => onAbrir(item.id)} className="flex w-full flex-col gap-1.5 px-4 py-3.5 text-left transition-colors hover:bg-ink focus-visible:bg-ink sm:flex-row sm:items-center sm:gap-4" aria-label={`${t("Abrir", "Open")} ${item.nombre}`}>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-fg">{item.nombre}</span>
          <span className="mt-0.5 block text-xs text-mist">{[nota, `${t("Editado", "Edited")} ${fechaHora(item.updatedAt)}`].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          {chipsDe(item).map((c) => (
            <ChipUi key={c.texto} chip={c} />
          ))}
        </span>
      </button>
    </li>
  );
}

function Grupo({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-fg">{titulo}</h3>
        {ayuda && <p className="mt-0.5 max-w-2xl text-xs text-mist">{ayuda}</p>}
      </div>
      <ul className="divide-y divide-edge overflow-hidden rounded-xl border border-edge bg-card">{children}</ul>
    </section>
  );
}

export function ListaPreguntas({ onAbrir }: { onAbrir: (id: string) => void }) {
  const { t } = useI18n();
  const { client, canWrite, contexto } = useTienda();
  const pagina = contexto?.tienda?.paginaMayoristas ?? null;

  const [items, setItems] = useState<EntidadResumen[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [creando, setCreando] = useState(false);
  const [pregunta, setPregunta] = useState("");
  const [respuesta, setRespuesta] = useState("");
  const [errorCrear, setErrorCrear] = useState<{ pregunta?: string; respuesta?: string; general?: string }>({});
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void client.listar({ tipo: "contenido" }).then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setItems(r.data.items);
        setError(null);
      } else setError(r.error.message);
    });
    return () => {
      vivo = false;
    };
  }, [client, recarga]);

  const grupos = useMemo(() => {
    const todos = items ?? [];
    const intro = pagina?.intro ? (todos.find((i) => i.clave === pagina.intro) ?? null) : null;
    const omitidas = new Set(pagina?.omitir ?? []);
    const preguntas = todos.filter((i) => i.tema === TEMA_PREGUNTAS && i.clave !== intro?.clave && !omitidas.has(i.clave)).sort(porOrden);
    const yaVistas = new Set([intro?.clave, ...preguntas.map((p) => p.clave)]);
    const alFinal = (pagina?.tambien ?? []).flatMap((clave) => {
      const e = todos.find((i) => i.clave === clave);
      return e && !yaVistas.has(e.clave) && !omitidas.has(e.clave) ? [e] : [];
    });
    const noSeMuestran = todos.filter((i) => omitidas.has(i.clave));
    return { intro, preguntas, alFinal, noSeMuestran };
  }, [items, pagina]);

  const siguienteOrden = Math.min(MAX_ORDEN, (grupos.preguntas.reduce((m, p) => Math.max(m, p.orden ?? 0), 0) || 0) + PASO_ORDEN);

  const cerrarCrear = () => {
    if (enviando) return;
    setCreando(false);
    setPregunta("");
    setRespuesta("");
    setErrorCrear({});
  };

  const crear = async () => {
    const q = pregunta.trim();
    const a = respuesta.trim();
    if (q === "" || a === "") {
      setErrorCrear({ ...(q === "" ? { pregunta: t("Escribe la pregunta.", "Write the question.") } : {}), ...(a === "" ? { respuesta: t("Escribe la respuesta.", "Write the answer.") } : {}) });
      return;
    }
    setEnviando(true);
    setErrorCrear({});
    const r = await client.crear("contenido", { ...borradorInicial("contenido"), tema: TEMA_PREGUNTAS, audiencia: "todos", titulo: q, texto: a, orden: siguienteOrden });
    setEnviando(false);
    if (!r.ok) {
      setErrorCrear({ general: r.error.message });
      return;
    }
    onAbrir(r.data.entidad.id);
  };

  const vacio = items !== null && grupos.intro === null && grupos.preguntas.length === 0 && grupos.alFinal.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-sm text-mist">
          {t(
            "Estas son las preguntas de la página «Mayoristas» de tu tienda, en el orden en que las ve el cliente. Lo que publiques aquí también lo usa ARIA para responder: se escribe una sola vez.",
            "These are the questions on the “Wholesale” page of your store, in the order customers see them. What you publish here is also used by ARIA to answer: you write it only once.",
          )}
        </p>
        {canWrite && (
          <button type="button" onClick={() => setCreando(true)} className={cn(primaryBtn, "shrink-0")}>
            <Plus className="size-4" aria-hidden /> {t("Nueva pregunta", "New question")}
          </button>
        )}
      </div>

      <MinimoMayorista />

      {error ? (
        <Aviso tono="danger" titulo={t("No pudimos cargar las preguntas", "We couldn't load the questions")}>
          {error}
          <button type="button" onClick={() => setRecarga((n) => n + 1)} className={cn(actionBtn, "mt-2")}>
            {t("Reintentar", "Retry")}
          </button>
        </Aviso>
      ) : items === null ? (
        <Cargando />
      ) : (
        <>
          {grupos.intro && (
            <Grupo titulo={t("Introducción", "Introduction")} ayuda={t("El texto que va bajo el título de la página. Si no hay uno publicado, la página usa una frase de la tienda.", "The text under the page title. If none is published, the page uses a line from the store.")}>
              <Fila item={grupos.intro} onAbrir={onAbrir} />
            </Grupo>
          )}

          <Grupo titulo={t("Preguntas", "Questions")} ayuda={t("Solo aparecen las publicadas. El orden lo manda el número «Orden» de cada una (los menores primero).", "Only published ones show. The order follows each one's “Order” number (lower first).")}>
            {grupos.preguntas.length === 0 ? (
              <li className="px-4 py-8 text-center">
                <p className="text-sm font-medium text-fg">{t("Todavía no hay preguntas", "There are no questions yet")}</p>
                <p className="mx-auto mt-1 max-w-sm text-xs text-mist">{canWrite ? t("Agrega la primera: se guarda como borrador y no se ve en la tienda hasta que la publiques.", "Add the first one: it is saved as a draft and doesn't show in the store until you publish it.") : t("Cuando un administrador agregue alguna, la verás aquí.", "When an administrator adds one, you'll see it here.")}</p>
              </li>
            ) : (
              grupos.preguntas.map((p) => <Fila key={p.id} item={p} nota={`${t("Orden", "Order")} ${p.orden ?? 0}`} onAbrir={onAbrir} />)
            )}
          </Grupo>

          {grupos.alFinal.length > 0 && (
            <Grupo titulo={t("Se suman al final de la página", "Added at the bottom of the page")} ayuda={t("Son textos de otros temas (envíos, medios de pago…) que la página muestra después de las preguntas. Se editan igual.", "These are texts from other topics (shipping, payment methods…) that the page shows after the questions. They are edited the same way.")}>
              {grupos.alFinal.map((e) => (
                <Fila key={e.id} item={e} nota={e.tema ? ETIQUETAS_TEMA[e.tema as TemaContenido] : undefined} onAbrir={onAbrir} />
              ))}
            </Grupo>
          )}

          {grupos.noSeMuestran.length > 0 && (
            <Grupo titulo={t("No se muestran en la página", "Not shown on the page")} ayuda={t("Son guías para ARIA, no están escritas para clientes. Siguen disponibles para ARIA.", "These are guidance for ARIA, not written for customers. They remain available to ARIA.")}>
              {grupos.noSeMuestran.map((e) => (
                <Fila key={e.id} item={e} onAbrir={onAbrir} />
              ))}
            </Grupo>
          )}
          {vacio && <p className="sr-only">{t("Todavía no hay contenido para esta página.", "There is no content for this page yet.")}</p>}
        </>
      )}

      <Dialogo
        abierto={creando}
        titulo={t("Nueva pregunta", "New question")}
        descripcion={t("Se guarda como borrador: aparece en la página «Mayoristas» cuando la publiques.", "It is saved as a draft: it shows on the “Wholesale” page when you publish it.")}
        onCerrar={cerrarCrear}
        acciones={
          <>
            <button type="button" onClick={cerrarCrear} disabled={enviando} className={actionBtn}>
              {t("Cancelar", "Cancel")}
            </button>
            <BotonCargando type="button" cargando={enviando} onClick={() => void crear()} className={primaryBtn}>
              {t("Crear y revisar", "Create and review")}
            </BotonCargando>
          </>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void crear();
          }}
        >
          <CampoTexto etiqueta={t("Pregunta", "Question")} ayuda={t("Como la haría un cliente: «¿Cuál es la compra mínima?»", "As a customer would ask it: “What is the minimum order?”")} valor={pregunta} onCambio={setPregunta} maxLength={160} error={errorCrear.pregunta} requerido />
          <CampoArea etiqueta={t("Respuesta", "Answer")} ayuda={t("Solo información que ya tengas definida. Si algo no está definido, escribe que una asesora lo confirma.", "Only information you already have defined. If something isn't defined, say an advisor will confirm it.")} valor={respuesta} onCambio={setRespuesta} maxLength={1500} filas={5} error={errorCrear.respuesta} requerido />
          {errorCrear.general && <Aviso tono="danger">{errorCrear.general}</Aviso>}
        </form>
      </Dialogo>
    </div>
  );
}
