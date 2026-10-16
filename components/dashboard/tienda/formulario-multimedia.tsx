"use client";

/**
 * Administración de tienda — el formulario de las FOTOS Y VIDEOS del inicio: los videos de la portada, la colección, la marca y los mayoristas, y la imagen de presentación de cada categoría.
 *
 * Cada video se revisa EN EL NAVEGADOR antes de subirlo (peso, formato, medidas, duración, sonido…: las mismas reglas que vuelve a aplicar el servidor) y la lista de lo que cumple y lo que no se
 * muestra regla por regla, con qué hacer para arreglarlo. Un video que no cumple no se puede usar. Lo que no se cambia se sigue viendo como siempre. Edita un BORRADOR con `poner(ruta, valor)`
 * como los demás formularios: no guarda ni valida por su cuenta (lo hace el editor).
 */
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Film, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Problema } from "@/lib/cms-comercial/contrato";
import type { Imagen } from "@/lib/cms-comercial/esquemas";
import type { EtapaSubidaVideo } from "@/lib/cms-comercial-client";
import { revisarArchivo, type RevisionVideo } from "@/lib/cms-comercial/video-navegador";
import {
  ARCHIVOS_VIDEO,
  ESPACIOS_VIDEO,
  ESPECIFICACIONES,
  IDEAL_BYTES_VIDEO,
  MAX_BYTES_VIDEO,
  MAX_DURACION_SEG,
  MIN_DURACION_SEG,
  REQUISITOS_GENERALES,
  archivoDe,
  comandoFfmpeg,
  pesoLegible,
  type ArchivoVideoId,
  type EspacioVideo,
} from "@/lib/cms-comercial/video-requisitos";
import { leer } from "@/components/dashboard/tienda/borrador";
import { useTienda } from "@/components/dashboard/tienda/contexto";
import type { FormProps } from "@/components/dashboard/tienda/formularios";
import { useHerramientasVideo } from "@/components/dashboard/tienda/herramientas-video";
import { SelectorImagen } from "@/components/dashboard/tienda/selectores";
import { Aviso, BotonCargando, Tarjeta, actionBtn, cn, dangerBtn, primaryBtn } from "@/components/dashboard/tienda/ui";

type ReferenciaVideo = { video: string; poster: string };

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const referenciaDe = (b: FormProps["borrador"], archivo: ArchivoVideoId): ReferenciaVideo | undefined => {
  const [espacio, orientacion] = archivo.split(".");
  const v = leer(b, `videos.${espacio}.${orientacion}`);
  return esObjeto(v) && typeof v.video === "string" && typeof v.poster === "string" ? { video: v.video, poster: v.poster } : undefined;
};
const errorDeVideo = (problemas: FormProps["problemas"], archivo: ArchivoVideoId): string | null => {
  const [espacio, orientacion] = archivo.split(".");
  const prefijo = `videos.${espacio}.${orientacion}`;
  return problemas.find((p) => p.severidad === "error" && (p.campo === prefijo || p.campo.startsWith(`${prefijo}.`)))?.mensaje ?? null;
};

const TITULOS_ESPACIO: Readonly<Record<EspacioVideo, { es: string; en: string; donde: [string, string] }>> = {
  portada: { es: "Portada", en: "Cover", donde: ["El video de fondo de lo primero que ve el cliente al entrar a tu tienda.", "The background video of the first thing customers see when they open your store."] },
  coleccion: { es: "Colección", en: "Collection", donde: ["El video a pantalla completa que aparece al bajar de la portada, con un título y un botón encima.", "The full-screen video that shows below the cover, with a title and a button on top."] },
  marca: { es: "Marca", en: "Brand", donde: ["El video de la tarjeta que acompaña el texto de presentación de tu marca.", "The video on the card next to your brand's introduction."] },
  mayoristas: { es: "Mayoristas", en: "Wholesale", donde: ["El video de fondo de la banda «Compra al por mayor» y de la página de mayoristas.", "The background video of the “Buy wholesale” band and the wholesale page."] },
};

// ---------------------------------------------------------------------------
// La guía: qué video sirve
// ---------------------------------------------------------------------------

const ETIQUETAS_REQUISITO: ReadonlyArray<{ clave: keyof typeof REQUISITOS_GENERALES; es: string; en: string }> = [
  { clave: "formato", es: "Formato", en: "Format" },
  { clave: "pesoMaximo", es: "Peso", en: "Weight" },
  { clave: "duracion", es: "Duración", en: "Length" },
  { clave: "fotogramas", es: "Fotogramas", en: "Frame rate" },
  { clave: "sonido", es: "Sonido", en: "Sound" },
  { clave: "contenido", es: "Contenido", en: "Content" },
  { clave: "derechos", es: "Derechos", en: "Rights" },
];

function BotonCopiar({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const { t } = useI18n();
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(texto);
            setCopiado(true);
          } catch {
            setCopiado(false); // sin permiso para copiar: la persona puede seleccionar el texto a mano
          }
        })();
      }}
      className={cn(actionBtn, "text-[12px]")}
      aria-label={etiqueta}
    >
      <Copy className="size-3.5" aria-hidden /> {copiado ? t("Copiado", "Copied") : t("Copiar", "Copy")}
    </button>
  );
}

export function GuiaVideos() {
  const { t } = useI18n();
  const [archivoFfmpeg, setArchivoFfmpeg] = useState<ArchivoVideoId>("portada.horizontal");
  const idSelect = useId();
  return (
    <details className="group rounded-xl border border-edge bg-card" data-testid="guia-videos">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-fg">
        <span>{t("¿Qué video sirve? Medidas, peso y formato", "Which video works? Size, weight and format")}</span>
        <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-5 border-t border-edge px-5 py-4 text-[13px] leading-relaxed text-mist">
        <p>
          {t(
            "Un video de tu tienda va detrás del texto, sin sonido y en bucle, y lo descargan los celulares de tus clientes. Por eso no sirve cualquier video: tiene que ser liviano y estar en el formato que se ve en todos los navegadores. Cuando eliges un video, lo revisamos al instante y te decimos qué cumple y qué no.",
            "A video in your store plays behind the text, without sound and on a loop, and your customers' phones download it. That's why not just any video works: it must be light and in the format every browser can play. When you pick a video we check it right away and tell you what passes and what doesn't.",
          )}
        </p>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg">{t("Para todos los videos", "For every video")}</p>
          <dl className="space-y-1.5">
            {ETIQUETAS_REQUISITO.map((e) => (
              <div key={e.clave} className="grid gap-x-3 sm:grid-cols-[7rem_1fr]">
                <dt className="font-medium text-fg">{t(e.es, e.en)}</dt>
                <dd>{REQUISITOS_GENERALES[e.clave]}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg">{t("Medidas de cada espacio", "Size for each space")}</p>
          <div className="overflow-x-auto rounded-lg border border-edge">
            <table className="w-full min-w-[34rem] text-left text-[12.5px]">
              <thead className="bg-ink text-fg">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">{t("Espacio", "Space")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("Medidas ideales (px)", "Ideal size (px)")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("Se acepta entre (px)", "Accepted between (px)")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("Proporción", "Ratio")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {ARCHIVOS_VIDEO.map((id) => {
                  const e = ESPECIFICACIONES[id];
                  return (
                    <tr key={id} data-testid={`fila-${id}`}>
                      <th scope="row" className="px-3 py-2 font-medium text-fg">
                        {e.titulo}
                      </th>
                      <td className="px-3 py-2 tabular-nums text-fg">
                        {e.ideal.ancho} × {e.ideal.alto}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {e.minimo.ancho} × {e.minimo.alto} — {e.maximo.ancho} × {e.maximo.alto}
                      </td>
                      <td className="px-3 py-2">{e.proporcion}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[12px]">
            {t(
              `Todos: hasta ${pesoLegible(MAX_BYTES_VIDEO)} (lo ideal, ${pesoLegible(IDEAL_BYTES_VIDEO)} o menos), de ${MIN_DURACION_SEG} a ${MAX_DURACION_SEG} segundos (lo ideal, 6 a 10), hasta 30 fotogramas por segundo y sin sonido.`,
              `All of them: up to ${pesoLegible(MAX_BYTES_VIDEO)} (ideally ${pesoLegible(IDEAL_BYTES_VIDEO)} or less), ${MIN_DURACION_SEG} to ${MAX_DURACION_SEG} seconds (ideally 6 to 10), up to 30 frames per second and no sound.`,
            )}
          </p>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg">{t("Cómo preparar tu video", "How to prepare your video")}</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <span className="font-medium text-fg">HandBrake</span> ({t("gratis, para computador", "free, for computers")}): {t("elige el ajuste «Fast 720p30», formato MP4, calidad (RF) 28, marca «Optimizado para web» y borra la pista de audio.", "pick the “Fast 720p30” preset, MP4 format, quality (RF) 28, tick “Web optimized” and delete the audio track.")}
            </li>
            <li>
              <span className="font-medium text-fg">CapCut, Canva, Clipchamp o Adobe Express</span>: {t("exporta a 720p y 30 fotogramas, con el sonido silenciado, y recorta el video a 6–10 segundos.", "export at 720p and 30 frames, with the sound muted, and trim the video to 6–10 seconds.")}
            </li>
            <li>
              {t("Si grabaste con un iPhone: Ajustes › Cámara › Formatos › «Más compatible» (así graba en H.264 y no en HEVC).", "If you recorded with an iPhone: Settings › Camera › Formats › “Most Compatible” (so it records in H.264, not HEVC).")}
            </li>
            <li>{t("No pongas texto dentro del video: el texto de tu tienda se escribe encima y se lee mejor.", "Don't put text inside the video: your store's text is written on top and reads better.")}</li>
          </ul>
        </div>

        <div className="rounded-lg border border-edge bg-ink p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg">{t("Para quien usa ffmpeg", "For ffmpeg users")}</p>
          <label htmlFor={idSelect} className="mb-1 block text-[12px]">
            {t("Comando para preparar el video de:", "Command to prepare the video for:")}
          </label>
          <select id={idSelect} value={archivoFfmpeg} onChange={(e) => setArchivoFfmpeg(e.target.value as ArchivoVideoId)} className="mb-2 w-full rounded-lg border border-edge bg-card px-3 py-2 text-sm text-fg">
            {ARCHIVOS_VIDEO.map((id) => (
              <option key={id} value={id}>
                {ESPECIFICACIONES[id].titulo}
              </option>
            ))}
          </select>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-edge bg-card p-2 font-mono text-[11.5px] text-fg" data-testid="comando-ffmpeg">
            {comandoFfmpeg(archivoFfmpeg)}
          </pre>
          <div className="mt-2">
            <BotonCopiar texto={comandoFfmpeg(archivoFfmpeg)} etiqueta={t("Copiar el comando", "Copy the command")} />
          </div>
        </div>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// La revisión de un video elegido
// ---------------------------------------------------------------------------

function ResultadoRevision({ revision }: { revision: RevisionVideo }) {
  const { t } = useI18n();
  const r = revision.resultado;
  const nFallos = r.fallos.length;
  return (
    <div data-testid="revision-video" className="space-y-3 rounded-lg border border-edge bg-ink p-3">
      <p role="status" className={cn("text-sm font-medium", r.cumple ? "text-lime-text" : "text-red-400")}>
        {r.cumple
          ? t(`«${revision.nombre}» cumple todos los requisitos.`, `“${revision.nombre}” meets every requirement.`)
          : t(`«${revision.nombre}» no se puede usar: no cumple ${nFallos === 1 ? "1 requisito" : `${nFallos} requisitos`}.`, `“${revision.nombre}” can't be used: it fails ${nFallos === 1 ? "1 requirement" : `${nFallos} requirements`}.`)}
      </p>
      <ul className="space-y-2">
        {r.comprobaciones.map((c) => (
          <li key={c.id} data-id={c.id} data-ok={c.ok} className="flex items-start gap-2 text-[13px]">
            {c.ok ? <Check className="mt-0.5 size-4 shrink-0 text-lime-text" aria-label={t("Cumple", "Passes")} /> : <X className="mt-0.5 size-4 shrink-0 text-red-400" aria-label={t("No cumple", "Fails")} />}
            <div className="min-w-0">
              <p className={cn(c.ok ? "text-fg" : "font-medium text-red-400")}>{c.titulo}</p>
              <p className="text-mist">{c.detalle}</p>
              {!c.ok && c.arreglo && <p className="mt-0.5 text-amber-400">{c.arreglo}</p>}
            </div>
          </li>
        ))}
      </ul>
      {r.seCorrigeSolo.map((mensaje) => (
        <Aviso key={mensaje} tono="info" titulo={t("Lo arreglamos por ti", "We fix this for you")}>
          {mensaje}
        </Aviso>
      ))}
      {r.recomendaciones.length > 0 && (
        <Aviso tono="warning" titulo={t("Se acepta, pero conviene mejorarlo", "Accepted, but worth improving")}>
          <ul className="list-disc space-y-1 pl-4">
            {r.recomendaciones.map((rec) => (
              <li key={rec}>{rec}</li>
            ))}
          </ul>
        </Aviso>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Un archivo de video (un espacio + su orientación)
// ---------------------------------------------------------------------------

type Fase =
  | { fase: "reposo" }
  | { fase: "revisando"; nombre: string; url: string }
  | { fase: "revisado"; archivo: File; revision: RevisionVideo; url: string }
  | { fase: "subiendo"; etapa: EtapaSubidaVideo; archivo: File; revision: RevisionVideo; url: string }
  | { fase: "error"; mensaje: string; problemas: Problema[]; archivo: File; revision: RevisionVideo; url: string }
  | { fase: "hecho"; revision: RevisionVideo; seCorrigio: string[]; recomendaciones: string[] };

function ratio(archivo: ArchivoVideoId): number {
  const { ideal } = ESPECIFICACIONES[archivo];
  return ideal.ancho / ideal.alto;
}

/** Un reproductor con la forma del espacio donde se verá (así se nota cómo se recorta). */
function Reproductor({ src, poster, archivo, etiqueta }: { src: string; poster?: string | null; archivo: ArchivoVideoId; etiqueta: string }) {
  const { ideal } = ESPECIFICACIONES[archivo];
  const r = ratio(archivo);
  const anchoMax = r < 0.7 ? 170 : r < 1 ? 240 : 360;
  return (
    <div className="w-full overflow-hidden rounded-lg border border-edge bg-ink" style={{ aspectRatio: `${ideal.ancho} / ${ideal.alto}`, maxWidth: anchoMax }}>
      <video src={src} poster={poster ?? undefined} muted loop playsInline controls preload="metadata" aria-label={etiqueta} className="size-full object-cover" />
    </div>
  );
}

const ETAPAS: Record<EtapaSubidaVideo, [string, string]> = {
  "imagen-fija": ["Guardando la imagen fija…", "Saving the still image…"],
  subiendo: ["Subiendo el video…", "Uploading the video…"],
  verificando: ["Verificando el video…", "Checking the video…"],
};

function SlotVideo({
  archivo,
  valor,
  original,
  onCambio,
  onQuitar,
  disabled,
  bloqueadoPor,
  error,
}: {
  archivo: ArchivoVideoId;
  valor: ReferenciaVideo | undefined;
  original: { src: string; poster: string } | undefined;
  onCambio: (nuevo: ReferenciaVideo) => void;
  /** Quitar el video elegido de ESTE archivo (solo se ofrece donde se puede: el vertical). */
  onQuitar?: () => void;
  disabled: boolean;
  /** Por qué todavía no se puede subir uno aquí (por ejemplo, falta el horizontal). */
  bloqueadoPor?: string;
  error: string | null;
}) {
  const { t } = useI18n();
  const espec = ESPECIFICACIONES[archivo];
  const herramientas = useHerramientasVideo();
  const { videoPorId, imagenPorId, videos, imagenes, cargarVideos, cargarImagenes, subirVideo } = useTienda();
  const entrada = useRef<HTMLInputElement>(null);
  const contador = useRef(0);
  const urlLocal = useRef<string | null>(null);
  const [fase, setFase] = useState<Fase>({ fase: "reposo" });
  const idEntrada = useId();

  // Lo ya subido se muestra con su dirección y su imagen fija: se cargan las listas la primera vez que hace falta.
  useEffect(() => {
    if (valor && videos === null) void cargarVideos();
    if (valor && imagenes === null) void cargarImagenes();
  }, [valor, videos, imagenes, cargarVideos, cargarImagenes]);
  // La dirección temporal del archivo elegido se libera al salir.
  useEffect(
    () => () => {
      if (urlLocal.current) herramientas.liberar(urlLocal.current);
    },
    [herramientas],
  );

  const soltarUrl = () => {
    if (urlLocal.current) herramientas.liberar(urlLocal.current);
    urlLocal.current = null;
  };

  const elegir = async (archivoElegido: File | undefined) => {
    if (!archivoElegido) return;
    soltarUrl();
    const url = herramientas.urlTemporal(archivoElegido);
    urlLocal.current = url;
    const n = ++contador.current;
    setFase({ fase: "revisando", nombre: archivoElegido.name, url });
    const revision = await revisarArchivo(archivoElegido, archivo, herramientas);
    if (n !== contador.current) return; // eligió otro mientras tanto
    setFase({ fase: "revisado", archivo: archivoElegido, revision, url });
  };

  const cancelar = () => {
    contador.current++;
    soltarUrl();
    setFase({ fase: "reposo" });
  };

  const usar = async () => {
    if (fase.fase !== "revisado" && fase.fase !== "error") return;
    const { archivo: elegido, revision, url } = fase;
    if (!revision.resultado.cumple || !revision.imagenFija) return;
    const n = ++contador.current;
    setFase({ fase: "subiendo", etapa: "imagen-fija", archivo: elegido, revision, url });
    const r = await subirVideo(elegido, archivo, revision.imagenFija, (etapa) => setFase((f) => (f.fase === "subiendo" ? { ...f, etapa } : f)));
    if (n !== contador.current) return;
    if (!r.ok) {
      setFase({ fase: "error", mensaje: r.error.message, problemas: r.error.problemas ?? [], archivo: elegido, revision, url });
      return;
    }
    soltarUrl();
    onCambio({ video: r.data.video.id, poster: r.data.imagen.id });
    setFase({ fase: "hecho", revision, seCorrigio: r.data.seCorrigio, recomendaciones: r.data.recomendaciones });
  };

  const subiendo = fase.fase === "subiendo";
  const revisando = fase.fase === "revisando";
  const puedeUsar = (fase.fase === "revisado" || fase.fase === "error") && fase.revision.resultado.cumple && fase.revision.imagenFija !== null;
  const propio = valor ? videoPorId(valor.video) : undefined;
  const fijaPropia = valor ? imagenPorId(valor.poster) : undefined;
  const local = fase.fase === "revisando" || fase.fase === "revisado" || fase.fase === "subiendo" || fase.fase === "error" ? fase.url : null;
  const mensajeProblema = error;

  return (
    <div className="space-y-3 rounded-lg border border-edge p-4" data-testid={`slot-${archivo}`}>
      <div>
        <h4 className="text-sm font-semibold text-fg">{espec.titulo}</h4>
        <p className="mt-0.5 text-[12px] leading-relaxed text-mist">{espec.descripcion}</p>
        <p className="mt-1 text-[12px] text-fg" data-testid={`medidas-${archivo}`}>
          {t("Medidas ideales", "Ideal size")}: <span className="tabular-nums">{espec.ideal.ancho} × {espec.ideal.alto} px</span> · {espec.proporcion} · {t("hasta", "up to")} {pesoLegible(MAX_BYTES_VIDEO)} · {MIN_DURACION_SEG}–{MAX_DURACION_SEG} s · {t("sin sonido", "no sound")}
        </p>
      </div>

      {mensajeProblema && (
        <p role="alert" className="text-[12px] text-red-400">
          {mensajeProblema}
        </p>
      )}

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="space-y-1.5 sm:w-[min(100%,22rem)] sm:shrink-0">
          {local ? (
            <>
              <p className="text-[11px] font-medium uppercase tracking-wide text-mist">{t("El video que elegiste", "The video you picked")}</p>
              <Reproductor src={local} archivo={archivo} etiqueta={t("Vista previa del video elegido", "Preview of the picked video")} />
              <p className="text-[11px] text-mist/80">{t("Así se recortaría en este espacio.", "This is how it would be cropped in this space.")}</p>
            </>
          ) : valor ? (
            <>
              <p className="text-[11px] font-medium uppercase tracking-wide text-lime-text">{t("Tu video", "Your video")}</p>
              {propio ? <Reproductor src={propio.url} poster={fijaPropia?.url} archivo={archivo} etiqueta={t("Tu video", "Your video")} /> : <p className="text-[12px] text-mist">{t("Cargando tu video…", "Loading your video…")}</p>}
            </>
          ) : original ? (
            <>
              <p className="text-[11px] font-medium uppercase tracking-wide text-mist">{t("El video de siempre", "The usual video")}</p>
              <Reproductor src={original.src} poster={original.poster} archivo={archivo} etiqueta={t("El video de siempre", "The usual video")} />
            </>
          ) : (
            <p className="text-[12px] text-mist">{t("Sin video: la pantalla vertical usa el horizontal, recortado.", "No video: vertical screens use the horizontal one, cropped.")}</p>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          {bloqueadoPor && !disabled && <p className="text-[12px] text-mist">{bloqueadoPor}</p>}
          {!disabled && !bloqueadoPor && (
            <div className="flex flex-wrap gap-2">
              <input
                ref={entrada}
                id={idEntrada}
                type="file"
                accept="video/mp4,video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi"
                className="sr-only"
                aria-label={`${t("Archivo de video", "Video file")} · ${espec.titulo}`}
                data-testid={`archivo-${archivo}`}
                onChange={(e) => {
                  void elegir(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <button type="button" disabled={subiendo || revisando} onClick={() => entrada.current?.click()} className={cn(actionBtn, "text-[13px]")}>
                <Upload className="size-4" aria-hidden /> {valor ? t("Cambiar el video", "Change the video") : t("Elegir un video", "Pick a video")}
              </button>
              {valor && onQuitar && (
                <button type="button" disabled={subiendo || revisando} onClick={onQuitar} className={cn(dangerBtn, "text-[13px]")}>
                  <Trash2 className="size-4" aria-hidden /> {t("Quitar mi video", "Remove my video")}
                </button>
              )}
            </div>
          )}

          {revisando && (
            <p role="status" className="text-sm text-mist">
              {t(`Revisando «${fase.nombre}»…`, `Checking “${fase.nombre}”…`)}
            </p>
          )}

          {(fase.fase === "revisado" || fase.fase === "subiendo" || fase.fase === "error") && <ResultadoRevision revision={fase.revision} />}

          {fase.fase === "error" && (
            <Aviso tono="danger" titulo={t("El servidor no aceptó el video", "The server didn't accept the video")}>
              <p>{fase.mensaje}</p>
              {fase.problemas.length > 0 && (
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {fase.problemas.map((p) => (
                    <li key={`${p.codigo}|${p.mensaje}`}>{p.mensaje}</li>
                  ))}
                </ul>
              )}
            </Aviso>
          )}

          {fase.fase === "hecho" && (
            <div className="space-y-2" data-testid="video-listo">
              <Aviso tono="success" titulo={t("Listo: este es tu video", "Done: this is your video")}>
                {t("Quedó elegido para este espacio. Falta guardar el borrador y publicar para que lo vean tus clientes.", "It's picked for this space. Save the draft and publish for your customers to see it.")}
              </Aviso>
              {fase.seCorrigio.map((m) => (
                <Aviso key={m} tono="info" titulo={t("Lo arreglamos por ti", "We fixed this for you")}>
                  {m}
                </Aviso>
              ))}
              {fase.recomendaciones.length > 0 && (
                <Aviso tono="warning" titulo={t("Se acepta, pero conviene mejorarlo", "Accepted, but worth improving")}>
                  <ul className="list-disc space-y-1 pl-4">
                    {fase.recomendaciones.map((rec) => (
                      <li key={rec}>{rec}</li>
                    ))}
                  </ul>
                </Aviso>
              )}
            </div>
          )}

          {subiendo && (
            <p role="status" className="text-sm text-mist" data-testid="etapa-subida">
              {t(ETAPAS[fase.etapa][0], ETAPAS[fase.etapa][1])}
            </p>
          )}

          {(fase.fase === "revisado" || fase.fase === "subiendo" || fase.fase === "error") && (
            <div className="flex flex-wrap gap-2">
              <BotonCargando type="button" cargando={subiendo} disabled={!puedeUsar || subiendo} onClick={() => void usar()} className={primaryBtn}>
                {t("Usar este video", "Use this video")}
              </BotonCargando>
              <button type="button" disabled={subiendo} onClick={cancelar} className={actionBtn}>
                {t("Elegir otro", "Pick another")}
              </button>
            </div>
          )}
          {(fase.fase === "revisado" || fase.fase === "error") && !puedeUsar && (
            <p className="text-[12px] text-amber-400">{t("Arregla lo marcado en rojo y vuelve a elegir el video. No hace falta que subas nada hasta que cumpla.", "Fix what's marked in red and pick the video again. There's nothing to upload until it passes.")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Un espacio (portada, colección, marca o mayoristas)
// ---------------------------------------------------------------------------

function TarjetaEspacio({ espacio, formulario }: { espacio: EspacioVideo; formulario: FormProps }) {
  const { t } = useI18n();
  const { contexto } = useTienda();
  const { borrador, poner, disabled, problemas } = formulario;
  const siempre = contexto?.tienda?.videosDeSiempre?.[espacio];
  const titulo = TITULOS_ESPACIO[espacio];
  const horizontal = archivoDe(espacio, "horizontal");
  const vertical = archivoDe(espacio, "vertical");
  const refH = horizontal ? referenciaDe(borrador, horizontal) : undefined;
  const refV = vertical ? referenciaDe(borrador, vertical) : undefined;
  const personalizado = Boolean(refH || refV);

  return (
    <Tarjeta
      titulo={t(titulo.es, titulo.en)}
      descripcion={t(titulo.donde[0], titulo.donde[1])}
      accion={
        personalizado && !disabled ? (
          <button type="button" onClick={() => poner(`videos.${espacio}`, undefined)} className={cn(actionBtn, "text-[12px]")}>
            <RotateCcw className="size-3.5" aria-hidden /> {t("Volver al video de siempre", "Back to the usual video")}
          </button>
        ) : undefined
      }
    >
      {horizontal && (
        <SlotVideo
          archivo={horizontal}
          valor={refH}
          original={siempre?.horizontal}
          onCambio={(v) => poner(`videos.${espacio}.horizontal`, v)}
          disabled={disabled}
          error={errorDeVideo(problemas, horizontal)}
        />
      )}
      {vertical && (
        <SlotVideo
          archivo={vertical}
          valor={refV}
          original={refH ? undefined : siempre?.vertical}
          onCambio={(v) => poner(`videos.${espacio}.vertical`, v)}
          onQuitar={() => poner(`videos.${espacio}.vertical`, undefined)}
          disabled={disabled}
          bloqueadoPor={refH ? undefined : t("Primero elige el video horizontal de este espacio: el vertical es opcional y va con él.", "Pick this space's horizontal video first: the vertical one is optional and goes with it.")}
          error={errorDeVideo(problemas, vertical)}
        />
      )}
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------
// Imágenes de las categorías
// ---------------------------------------------------------------------------

type EntradaCategoria = { categoria_id?: string; imagen?: Imagen };

function ImagenesDeCategorias({ borrador, poner, disabled, problemas }: FormProps) {
  const { t } = useI18n();
  const { contexto } = useTienda();
  const categorias = contexto?.categorias ?? [];
  const crudas = leer(borrador, "categorias");
  const entradas: EntradaCategoria[] = Array.isArray(crudas) ? crudas.filter(esObjeto) : [];
  const indiceDe = (id: string) => entradas.findIndex((e) => e.categoria_id === id);
  const errorDe = (i: number) => problemas.find((p) => p.severidad === "error" && p.campo.startsWith(`categorias.${i}.`))?.mensaje ?? null;

  const guardar = (lista: EntradaCategoria[]) => poner("categorias", lista.length === 0 ? undefined : lista);
  const cambiar = (id: string, imagen: Imagen | undefined) => {
    const i = indiceDe(id);
    if (!imagen) return guardar(entradas.filter((e) => e.categoria_id !== id));
    const nueva: EntradaCategoria = { categoria_id: id, imagen };
    if (i < 0) return guardar([...entradas, nueva]);
    const copia = [...entradas];
    copia[i] = nueva;
    return guardar(copia);
  };

  const conocidas = new Set(categorias.map((c) => c.id));
  const eliminadas = entradas.filter((e) => typeof e.categoria_id === "string" && !conocidas.has(e.categoria_id));

  return (
    <Tarjeta
      titulo={t("Imagen de cada categoría", "Image for each category")}
      descripcion={t(
        "Es la foto que ve el cliente en el carrusel de categorías del inicio. Si no eliges una, la tienda usa la foto de uno de los productos de esa categoría (y si la categoría no tiene productos con foto, muestra solo su inicial).",
        "This is the photo customers see in the home page's category carousel. If you don't pick one, the store uses a photo of one of the category's products (and if none has a photo, it shows just its initial).",
      )}
    >
      <p className="text-[12px] text-fg" data-testid="medidas-categoria">
        {t("Medidas ideales: 960 × 1200 px (vertical, proporción 4:5), mínimo 600 × 750 px.", "Ideal size: 960 × 1200 px (vertical, 4:5 ratio), at least 600 × 750 px.")}{" "}
        <span className="text-mist">{t("En pantallas grandes se ve hasta a unos 480 px de ancho (el doble de nítida en las de alta definición). Si tu foto es más grande, se reduce sola a 1200 px en su lado más largo al subirla.", "On large screens it shows up to about 480 px wide (twice as sharp on high-definition ones). If your photo is bigger, its longest side is reduced to 1200 px when you upload it.")}</span>
      </p>
      <p className="text-[12px] text-mist" data-testid="consejo-categoria">
        {t("Elige una foto limpia, sin texto ni collage de varias fotos: la tienda la recorta a 4:5 y escribe encima el nombre de la categoría.", "Pick a clean photo, with no text or multi-photo collage: the store crops it to 4:5 and writes the category name on top.")}
      </p>
      {contexto && categorias.length === 0 && <Aviso tono="info">{t("Tu catálogo todavía no tiene categorías. Cuando las crees, aquí les pones su imagen.", "Your catalog has no categories yet. Once you create them, you set their image here.")}</Aviso>}
      <ul className="space-y-4">
        {categorias.map((c) => {
          const i = indiceDe(c.id);
          const entrada = i >= 0 ? entradas[i] : undefined;
          return (
            <li key={c.id} className="rounded-lg border border-edge p-4" data-testid={`categoria-${c.id}`}>
              <SelectorImagen
                etiqueta={c.nombre}
                ayuda={entrada?.imagen ? undefined : t("Sin imagen elegida: se usa la foto de uno de sus productos.", "No image picked: a photo of one of its products is used.")}
                imagen={entrada?.imagen}
                onCambio={(nueva) => cambiar(c.id, nueva)}
                disabled={disabled}
                ladoMaximo={1200}
                vertical
                altSugerido={t(`Imagen de la categoría ${c.nombre}`, `Image of the ${c.nombre} category`)}
                problema={i >= 0 ? errorDe(i) : null}
              />
            </li>
          );
        })}
        {eliminadas.map((e) => (
          <li key={e.categoria_id} className="flex items-center justify-between gap-3 rounded-lg border border-red-500/40 p-4" data-testid="categoria-eliminada">
            <p className="text-sm text-red-400">{t("Esta categoría ya no existe en tu catálogo.", "This category no longer exists in your catalog.")}</p>
            {!disabled && e.categoria_id && (
              <button type="button" onClick={() => cambiar(e.categoria_id as string, undefined)} className={dangerBtn}>
                <Trash2 className="size-4" aria-hidden /> {t("Quitar", "Remove")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------

export function FormMultimedia(p: FormProps) {
  const { t } = useI18n();
  const { contexto } = useTienda();
  const tiene = contexto?.tienda?.videosDeSiempre ?? {};
  const espacios = ESPACIOS_VIDEO.filter((e) => tiene[e]);

  return (
    <div className="space-y-5">
      <Aviso tono="info" titulo={t("Cambia los videos y las imágenes de tu inicio", "Change your home page's videos and images")}>
        {t(
          "Lo que no cambies se sigue viendo como siempre, y nada se ve en tu tienda hasta que lo publiques. Antes de subir un video lo revisamos y, si no sirve, te decimos exactamente por qué y cómo arreglarlo.",
          "What you don't change keeps looking as usual, and nothing shows in your store until you publish it. Before a video is uploaded we check it and, if it doesn't work, we tell you exactly why and how to fix it.",
        )}
      </Aviso>

      <GuiaVideos />

      {!contexto && (
        <p role="status" className="text-sm text-mist">
          <Film className="mr-1.5 inline size-4" aria-hidden /> {t("Cargando tu tienda…", "Loading your store…")}
        </p>
      )}
      {espacios.map((e) => (
        <TarjetaEspacio key={e} espacio={e} formulario={p} />
      ))}

      <ImagenesDeCategorias {...p} />

      <Tarjeta titulo={t("Productos y categorías destacados", "Featured products and categories")}>
        <p className="text-[13px] leading-relaxed text-mist" data-testid="aviso-destacados">
          {t(
            "Los productos destacados, las categorías que aparecen en el inicio (y su orden), la foto de la portada, el banner y el orden de las secciones se eligen en la pestaña «Página principal».",
            "The featured products, the categories that show on the home page (and their order), the cover photo, the banner and the section order are set in the “Home page” tab.",
          )}
        </p>
      </Tarjeta>
    </div>
  );
}

