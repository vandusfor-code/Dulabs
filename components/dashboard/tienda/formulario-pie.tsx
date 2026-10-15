"use client";

/**
 * Administración de tienda — el formulario del PIE DE PÁGINA: descripción, columnas de enlaces (a páginas de la tienda o a otras direcciones), categorías, contacto, redes sociales y derechos.
 * Edita un BORRADOR con `poner(ruta, valor)` como los demás formularios; no guarda ni valida por su cuenta: lo hace el editor (las mismas reglas de lib/cms-comercial/esquemas.ts y validacion.ts).
 */
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { ETIQUETAS_RED, REDES_SOCIALES, type RedSocial } from "@/lib/cms-comercial/contrato";
import { urlDesdeUsuario } from "@/lib/cms-comercial/enlaces";
import type { EntidadResumen } from "@/lib/cms-comercial-client";
import type { DestinoPie } from "@/lib/cms-comercial/esquemas";
import { leer, mover, type Draft } from "@/components/dashboard/tienda/borrador";
import { useTienda } from "@/components/dashboard/tienda/contexto";
import type { FormProps } from "@/components/dashboard/tienda/formularios";
import { usePaginas } from "@/components/dashboard/tienda/usar-paginas";
import { CampoArea, CampoSelect, CampoTexto, Interruptor, Tarjeta, actionBtn, cn } from "@/components/dashboard/tienda/ui";

type TipoDestinoPie = DestinoPie["tipo"];
type DestinoBorrador = { tipo?: string; categoria_id?: string; url?: string; clave?: string };
type EnlaceBorrador = { texto?: string; destino?: DestinoBorrador };
type ColumnaBorrador = { titulo?: string; enlaces?: EnlaceBorrador[] };
type RedBorrador = { red?: string; url?: string };
type ContactoBorrador = { titulo?: string; whatsapp?: boolean; email?: string; telefono?: string; direccion?: string; horario?: string };

const MAX_COLUMNAS = 3;
const MAX_ENLACES = 10;
const MAX_REDES = 8;

const objetos = <T,>(v: unknown): T[] => (Array.isArray(v) ? v.filter((x) => typeof x === "object" && x !== null && !Array.isArray(x)) : []) as T[];
const texto = (b: Draft, ruta: string): string => {
  const v = leer(b, ruta);
  return typeof v === "string" ? v : "";
};
const errorEn = (problemas: FormProps["problemas"], campo: string): string | null => problemas.find((p) => p.severidad === "error" && p.campo === campo)?.mensaje ?? null;

const OPCIONES_DESTINO: ReadonlyArray<{ valor: TipoDestinoPie; es: string; en: string }> = [
  { valor: "inicio", es: "Inicio de la tienda", en: "Store home" },
  { valor: "catalogo", es: "Todo el catálogo", en: "The whole catalog" },
  { valor: "mayoristas", es: "Mayoristas", en: "Wholesale" },
  { valor: "categoria", es: "Una categoría", en: "A category" },
  { valor: "pagina", es: "Una de mis páginas", en: "One of my pages" },
  { valor: "whatsapp", es: "WhatsApp de la tienda", en: "Store WhatsApp" },
  { valor: "externo", es: "Otra página (un enlace)", en: "Another page (a link)" },
];

/** Subir, bajar y quitar un elemento de una lista, con el nombre del elemento para lectores de pantalla. */
function AccionesFila({ nombre, indice, total, onMover, onQuitar }: { nombre: string; indice: number; total: number; onMover: (delta: -1 | 1) => void; onQuitar: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button type="button" aria-label={`${t("Subir", "Move up")} ${nombre}`} disabled={indice === 0} onClick={() => onMover(-1)} className="rounded p-1.5 text-mist hover:text-fg disabled:opacity-30">
        <ArrowUp className="size-4" aria-hidden />
      </button>
      <button type="button" aria-label={`${t("Bajar", "Move down")} ${nombre}`} disabled={indice === total - 1} onClick={() => onMover(1)} className="rounded p-1.5 text-mist hover:text-fg disabled:opacity-30">
        <ArrowDown className="size-4" aria-hidden />
      </button>
      <button type="button" aria-label={`${t("Quitar", "Remove")} ${nombre}`} onClick={onQuitar} className="rounded p-1.5 text-mist hover:text-red-400">
        <Trash2 className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/**
 * A dónde lleva un enlace: una página de la propia tienda (lista cerrada), una de las páginas que escribió la administradora o una dirección externa. «Mayoristas» solo se ofrece si la tienda tiene
 * mayoristas y «Una de mis páginas» solo si ya creó alguna.
 */
function SelectorDestinoPie({
  destino,
  onCambio,
  disabled,
  paginas,
  errorTipo,
  errorUrl,
  errorCategoria,
  errorPagina,
}: {
  destino: DestinoBorrador | undefined;
  onCambio: (d: DestinoBorrador) => void;
  disabled: boolean;
  paginas: EntidadResumen[] | null;
  errorTipo: string | null;
  errorUrl: string | null;
  errorCategoria: string | null;
  errorPagina: string | null;
}) {
  const { t } = useI18n();
  const { contexto } = useTienda();
  const tipo = (destino?.tipo as TipoDestinoPie | undefined) ?? "inicio";
  const hayMayoristas = contexto?.tienda?.mayoristas === true || tipo === "mayoristas";
  const hayPaginas = (paginas?.length ?? 0) > 0 || tipo === "pagina";
  const opciones = OPCIONES_DESTINO.filter((o) => (o.valor !== "mayoristas" || hayMayoristas) && (o.valor !== "pagina" || hayPaginas)).map((o) => ({ valor: o.valor, etiqueta: t(o.es, o.en) }));
  const cambiarTipo = (nuevo: TipoDestinoPie) => {
    if (nuevo === "categoria") onCambio({ tipo: "categoria", categoria_id: contexto?.categorias[0]?.id ?? "" });
    else if (nuevo === "pagina") onCambio({ tipo: "pagina", clave: (paginas?.find((x) => x.estado === "publicada") ?? paginas?.[0])?.clave ?? "" });
    else if (nuevo === "externo") onCambio({ tipo: "externo", url: "" });
    else onCambio({ tipo: nuevo });
  };
  const estadoDe = (e: EntidadResumen) => (e.estado === "publicada" ? "" : e.estado === "pausada" ? ` (${t("pausada", "paused")})` : ` (${t("sin publicar", "not published")})`);
  const opcionesPagina = [
    ...(paginas ?? []).map((x) => ({ valor: x.clave, etiqueta: `${x.nombre}${estadoDe(x)}` })),
    // Una página que ya no está en la lista (se archivó): se muestra para poder cambiarla, no se esconde.
    ...(destino?.clave && !(paginas ?? []).some((x) => x.clave === destino.clave) ? [{ valor: destino.clave, etiqueta: `${destino.clave} (${t("ya no existe", "no longer exists")})` }] : []),
  ];
  const paginaElegida = (paginas ?? []).find((x) => x.clave === destino?.clave);
  return (
    <div className="space-y-3">
      <CampoSelect etiqueta={t("¿A dónde lleva?", "Where does it lead?")} valor={tipo} onCambio={cambiarTipo} opciones={opciones} disabled={disabled} error={errorTipo} />
      {destino?.tipo === "categoria" && <CampoSelect etiqueta={t("Categoría", "Category")} valor={destino.categoria_id ?? ""} onCambio={(v) => onCambio({ tipo: "categoria", categoria_id: v })} opciones={(contexto?.categorias ?? []).map((c) => ({ valor: c.id, etiqueta: c.nombre }))} disabled={disabled} error={errorCategoria} />}
      {destino?.tipo === "pagina" && (
        <>
          <CampoSelect etiqueta={t("Página", "Page")} valor={destino.clave ?? ""} onCambio={(v) => onCambio({ tipo: "pagina", clave: v })} opciones={opcionesPagina} disabled={disabled} error={errorPagina} />
          {paginaElegida && paginaElegida.estado !== "publicada" && (
            <p className="text-[11px] text-mist/80">{t("Esta página todavía no está publicada: el enlace no aparecerá en tu tienda hasta que la publiques.", "This page isn't published yet: the link won't show in your store until you publish it.")}</p>
          )}
        </>
      )}
      {destino?.tipo === "externo" && (
        <CampoTexto
          etiqueta={t("Dirección de la página", "Page address")}
          ayuda={t("Una dirección completa que empiece por https:// (por ejemplo https://www.mitienda.com/privacidad). Se abre en una pestaña nueva.", "A full address starting with https:// (for example https://www.mystore.com/privacy). It opens in a new tab.")}
          valor={destino.url ?? ""}
          onCambio={(v) => onCambio({ tipo: "externo", url: v })}
          maxLength={300}
          placeholder="https://"
          disabled={disabled}
          requerido
          error={errorUrl}
        />
      )}
    </div>
  );
}

/** El título de la página con ese código, como texto de un enlace (el texto de un enlace admite 40 caracteres). */
const tituloDePagina = (paginas: EntidadResumen[] | null, clave: string | undefined): string => (paginas?.find((x) => x.clave === clave)?.nombre ?? "").slice(0, 40).trim();

export function FormPie(p: FormProps) {
  const { t } = useI18n();
  const { borrador, poner, disabled, problemas } = p;
  const paginas = usePaginas();
  const columnas = objetos<ColumnaBorrador>(leer(borrador, "columnas"));
  const redes = objetos<RedBorrador>(leer(borrador, "redes"));
  const contacto = leer(borrador, "contacto") as ContactoBorrador | undefined;
  const hayContacto = typeof contacto === "object" && contacto !== null;

  const ponerColumnas = (nuevas: ColumnaBorrador[]) => poner("columnas", nuevas);
  const cambiarColumna = (i: number, parcial: Partial<ColumnaBorrador>) => ponerColumnas(columnas.map((c, k) => (k === i ? { ...c, ...parcial } : c)));
  const enlacesDe = (i: number) => objetos<EnlaceBorrador>(columnas[i]?.enlaces);
  const cambiarEnlace = (i: number, j: number, parcial: Partial<EnlaceBorrador>) => cambiarColumna(i, { enlaces: enlacesDe(i).map((e, k) => (k === j ? { ...e, ...parcial } : e)) });

  const ponerRedes = (nuevas: RedBorrador[]) => poner("redes", nuevas);
  const cambiarRed = (i: number, parcial: Partial<RedBorrador>) => ponerRedes(redes.map((r, k) => (k === i ? { ...r, ...parcial } : r)));
  /** Al salir del campo: si escribió solo «@usuario», se completa con la dirección de su perfil en esa red. */
  const completarRed = (i: number) => {
    const r = redes[i];
    if (!r?.red || !r.url) return;
    const url = urlDesdeUsuario(r.red as RedSocial, r.url);
    if (url && url !== r.url) cambiarRed(i, { url });
  };
  const siguienteRed = (): RedSocial => REDES_SOCIALES.find((r) => !redes.some((x) => x.red === r)) ?? "instagram";

  return (
    <div className="space-y-5">
      <Tarjeta titulo={t("Descripción", "Description")} descripcion={t("La frase que aparece bajo el nombre de tu marca, al final de cada página de tu tienda.", "The line shown under your brand name at the bottom of every page of your store.")}>
        <CampoArea etiqueta={t("Frase", "Line")} valor={texto(borrador, "descripcion")} onCambio={(v) => poner("descripcion", v)} maxLength={240} filas={3} disabled={disabled} error={errorEn(problemas, "descripcion")} />
      </Tarjeta>

      <Tarjeta
        titulo={t("Enlaces", "Links")}
        descripcion={t("Hasta 3 columnas de enlaces (por ejemplo «Navegar» y «Legal»). Cada enlace lleva a una página de tu tienda o a otra dirección.", "Up to 3 link columns (for example “Browse” and “Legal”). Each link leads to a page of your store or to another address.")}
      >
        {columnas.length === 0 && <p className="rounded-lg border border-dashed border-edge px-3 py-4 text-center text-sm text-mist">{t("Todavía no hay columnas de enlaces.", "There are no link columns yet.")}</p>}
        {columnas.map((col, i) => {
          const nombreColumna = col.titulo?.trim() || `${t("columna", "column")} ${i + 1}`;
          const enlaces = enlacesDe(i);
          return (
            <div key={i} role="group" aria-label={`${t("Columna", "Column")} ${i + 1}`} className="space-y-3 rounded-xl border border-edge p-3.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <CampoTexto etiqueta={t("Título de la columna", "Column title")} valor={col.titulo ?? ""} onCambio={(v) => cambiarColumna(i, { titulo: v })} maxLength={30} disabled={disabled} requerido error={errorEn(problemas, `columnas.${i}.titulo`)} />
                </div>
                {!disabled && <AccionesFila nombre={nombreColumna} indice={i} total={columnas.length} onMover={(d) => ponerColumnas(mover(columnas, i, d))} onQuitar={() => ponerColumnas(columnas.filter((_, k) => k !== i))} />}
              </div>
              {errorEn(problemas, `columnas.${i}.enlaces`) && (
                <p role="alert" className="text-[12px] text-red-400">
                  {errorEn(problemas, `columnas.${i}.enlaces`)}
                </p>
              )}
              <ul className="space-y-3">
                {enlaces.map((enlace, j) => (
                  <li key={j} role="group" aria-label={`${t("Enlace", "Link")} ${j + 1} · ${nombreColumna}`} className="rounded-lg border border-edge bg-ink/40 p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1 space-y-3">
                        <CampoTexto etiqueta={t("Texto del enlace", "Link text")} valor={enlace.texto ?? ""} onCambio={(v) => cambiarEnlace(i, j, { texto: v })} maxLength={40} disabled={disabled} requerido error={errorEn(problemas, `columnas.${i}.enlaces.${j}.texto`)} />
                        <SelectorDestinoPie
                          destino={enlace.destino}
                          // Al elegir una página, si el enlace aún no tiene texto, se le pone el título de la página (se puede cambiar).
                          onCambio={(d) => cambiarEnlace(i, j, { destino: d, ...(d.tipo === "pagina" && !enlace.texto?.trim() ? { texto: tituloDePagina(paginas, d.clave) } : {}) })}
                          disabled={disabled}
                          paginas={paginas}
                          errorTipo={errorEn(problemas, `columnas.${i}.enlaces.${j}.destino.tipo`) ?? errorEn(problemas, `columnas.${i}.enlaces.${j}.destino`)}
                          errorUrl={errorEn(problemas, `columnas.${i}.enlaces.${j}.destino.url`)}
                          errorCategoria={errorEn(problemas, `columnas.${i}.enlaces.${j}.destino.categoria_id`)}
                          errorPagina={errorEn(problemas, `columnas.${i}.enlaces.${j}.destino.clave`)}
                        />
                      </div>
                      {!disabled && (
                        <AccionesFila
                          nombre={enlace.texto?.trim() || `${t("enlace", "link")} ${j + 1}`}
                          indice={j}
                          total={enlaces.length}
                          onMover={(d) => cambiarColumna(i, { enlaces: mover(enlaces, j, d) })}
                          onQuitar={() => cambiarColumna(i, { enlaces: enlaces.filter((_, k) => k !== j) })}
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {!disabled && enlaces.length < MAX_ENLACES && (
                <button type="button" onClick={() => cambiarColumna(i, { enlaces: [...enlaces, { texto: "", destino: { tipo: "inicio" } }] })} className={cn(actionBtn, "text-[13px]")}>
                  <Plus className="size-4" aria-hidden /> {t("Agregar un enlace", "Add a link")}
                </button>
              )}
            </div>
          );
        })}
        {errorEn(problemas, "columnas") && (
          <p role="alert" className="text-[12px] text-red-400">
            {errorEn(problemas, "columnas")}
          </p>
        )}
        {!disabled && columnas.length < MAX_COLUMNAS && (
          <button type="button" onClick={() => ponerColumnas([...columnas, { titulo: "", enlaces: [{ texto: "", destino: { tipo: "inicio" } }] }])} className={cn(actionBtn, "text-[13px]")}>
            <Plus className="size-4" aria-hidden /> {t("Agregar una columna", "Add a column")}
          </button>
        )}
      </Tarjeta>

      <Tarjeta titulo={t("Categorías", "Categories")} descripcion={t("Una columna con las categorías de tu catálogo. Se arma sola: si agregas o quitas una categoría, el pie se actualiza.", "A column with your catalog categories. It builds itself: when you add or remove a category, the footer updates.")}>
        <Interruptor etiqueta={t("Mostrar las categorías", "Show the categories")} valor={leer(borrador, "mostrar_categorias") !== false} onCambio={(v) => poner("mostrar_categorias", v)} disabled={disabled} />
      </Tarjeta>

      <Tarjeta titulo={t("Contacto", "Contact")} descripcion={t("Cómo te encuentran tus clientes. Lo que dejes vacío no se muestra.", "How your customers reach you. Anything left empty is not shown.")}>
        <Interruptor etiqueta={t("Mostrar un bloque de contacto", "Show a contact block")} valor={hayContacto} onCambio={(v) => poner("contacto", v ? { whatsapp: true } : undefined)} disabled={disabled} />
        {hayContacto && (
          <>
            <CampoTexto etiqueta={t("Título del bloque (opcional)", "Block title (optional)")} ayuda={t("Si lo dejas vacío dice «Contacto».", "If left empty it says “Contact”.")} valor={texto(borrador, "contacto.titulo")} onCambio={(v) => poner("contacto.titulo", v)} maxLength={30} disabled={disabled} error={errorEn(problemas, "contacto.titulo")} />
            <Interruptor
              etiqueta={t("Enlace «Escríbenos por WhatsApp»", "“Write to us on WhatsApp” link")}
              ayuda={t("Usa el número de WhatsApp de tu tienda; no hace falta escribirlo aquí.", "It uses your store's WhatsApp number; there's no need to type it here.")}
              valor={contacto?.whatsapp !== false}
              onCambio={(v) => poner("contacto.whatsapp", v)}
              disabled={disabled}
            />
            <CampoTexto etiqueta={t("Correo electrónico", "Email")} tipo="email" valor={texto(borrador, "contacto.email")} onCambio={(v) => poner("contacto.email", v)} maxLength={120} disabled={disabled} error={errorEn(problemas, "contacto.email")} />
            <CampoTexto etiqueta={t("Teléfono", "Phone")} tipo="tel" valor={texto(borrador, "contacto.telefono")} onCambio={(v) => poner("contacto.telefono", v)} maxLength={30} placeholder="+57 300 123 4567" disabled={disabled} error={errorEn(problemas, "contacto.telefono")} />
            <CampoArea etiqueta={t("Dirección", "Address")} ayuda={t("Hasta 3 líneas (por ejemplo el centro comercial, la dirección y la ciudad).", "Up to 3 lines (for example the mall, the street address and the city).")} valor={texto(borrador, "contacto.direccion")} onCambio={(v) => poner("contacto.direccion", v)} maxLength={200} filas={3} disabled={disabled} error={errorEn(problemas, "contacto.direccion")} />
            <CampoTexto etiqueta={t("Horario de atención", "Opening hours")} valor={texto(borrador, "contacto.horario")} onCambio={(v) => poner("contacto.horario", v)} maxLength={120} disabled={disabled} error={errorEn(problemas, "contacto.horario")} />
          </>
        )}
      </Tarjeta>

      <Tarjeta titulo={t("Redes sociales", "Social networks")} descripcion={t("Aparecen como iconos en el pie. Pega la dirección de tu perfil o escribe solo tu @usuario (en Instagram, TikTok, X, YouTube, Facebook, Pinterest o Telegram).", "They show as icons in the footer. Paste your profile address or just type your @username (on Instagram, TikTok, X, YouTube, Facebook, Pinterest or Telegram).")}>
        {redes.length === 0 && <p className="rounded-lg border border-dashed border-edge px-3 py-4 text-center text-sm text-mist">{t("Todavía no hay redes sociales.", "There are no social networks yet.")}</p>}
        <ul className="space-y-3">
          {redes.map((r, i) => {
            const nombre = r.red && (REDES_SOCIALES as readonly string[]).includes(r.red) ? ETIQUETAS_RED[r.red as RedSocial] : `${t("red", "network")} ${i + 1}`;
            return (
              <li key={i} role="group" aria-label={`${t("Red social", "Social network")} ${i + 1}`} className="rounded-lg border border-edge p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1 space-y-3">
                    <CampoSelect etiqueta={t("Red", "Network")} valor={(r.red ?? "") as RedSocial | ""} onCambio={(v) => cambiarRed(i, { red: v })} opciones={REDES_SOCIALES.map((x) => ({ valor: x, etiqueta: ETIQUETAS_RED[x] }))} disabled={disabled} error={errorEn(problemas, `redes.${i}.red`)} />
                    <CampoTexto
                      etiqueta={t("Dirección del perfil o @usuario", "Profile address or @username")}
                      valor={r.url ?? ""}
                      onCambio={(v) => cambiarRed(i, { url: v })}
                      onSalir={() => completarRed(i)}
                      maxLength={300}
                      placeholder="@tu.usuario"
                      disabled={disabled}
                      requerido
                      error={errorEn(problemas, `redes.${i}.url`)}
                    />
                  </div>
                  {!disabled && <AccionesFila nombre={nombre} indice={i} total={redes.length} onMover={(d) => ponerRedes(mover(redes, i, d))} onQuitar={() => ponerRedes(redes.filter((_, k) => k !== i))} />}
                </div>
              </li>
            );
          })}
        </ul>
        {errorEn(problemas, "redes") && (
          <p role="alert" className="text-[12px] text-red-400">
            {errorEn(problemas, "redes")}
          </p>
        )}
        {!disabled && redes.length < MAX_REDES && (
          <button type="button" onClick={() => ponerRedes([...redes, { red: siguienteRed() }])} className={cn(actionBtn, "text-[13px]")}>
            <Plus className="size-4" aria-hidden /> {t("Agregar una red social", "Add a social network")}
          </button>
        )}
      </Tarjeta>

      <Tarjeta titulo={t("Derechos", "Rights")} descripcion={t("La línea de derechos al final del pie. El año se pone solo.", "The rights line at the bottom of the footer. The year is added automatically.")}>
        <CampoTexto
          etiqueta={t("Texto después del «© año» (opcional)", "Text after “© year” (optional)")}
          ayuda={t("Por ejemplo «Mi Empresa S.A.S. NIT 900.123.456-7. Todos los derechos reservados.». Si lo dejas vacío dice «{tu marca}. Todos los derechos reservados.».", "For example “My Company LLC. All rights reserved.”. If left empty it says “{your brand}. All rights reserved.”.")}
          valor={texto(borrador, "derechos")}
          onCambio={(v) => poner("derechos", v)}
          maxLength={160}
          disabled={disabled}
          error={errorEn(problemas, "derechos")}
        />
      </Tarjeta>
    </div>
  );
}
