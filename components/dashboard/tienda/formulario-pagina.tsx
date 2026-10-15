"use client";

/**
 * Administración de tienda — el formulario de una PÁGINA propia de la tienda (política de privacidad, términos y condiciones, cambios y garantías…): su título y su texto.
 *
 * El texto se escribe como un mensaje: una línea en blanco separa los párrafos, «## » al principio de una línea hace un subtítulo y «- » un elemento de lista. Lo que se guarda son BLOQUES
 * (lib/cms-comercial/pagina.ts convierte en los dos sentidos). Edita un BORRADOR con `poner(ruta, valor)` como los demás formularios; no guarda ni valida por su cuenta: lo hace el editor
 * (las mismas reglas de lib/cms-comercial/esquemas.ts y validacion.ts). Mientras escribe muestra los problemas del texto con el mismo esquema, para no esperar a «Revisar».
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { caracteresDePagina, MAX_BLOQUES_PAGINA, MAX_CARACTERES_PAGINA } from "@/lib/cms-comercial/esquemas";
import { bloquesDeBorrador, bloquesDeTexto, inicioDeBloque, mismosBloques, problemasDeBloques, textoDeBloques } from "@/lib/cms-comercial/pagina";
import { leer, type Draft } from "@/components/dashboard/tienda/borrador";
import type { FormProps } from "@/components/dashboard/tienda/formularios";
import { Campo, CampoTexto, Tarjeta, actionBtn, cn, inputCls } from "@/components/dashboard/tienda/ui";

const texto = (b: Draft, ruta: string): string => {
  const v = leer(b, ruta);
  return typeof v === "string" ? v : "";
};

const EJEMPLO = "Escribe aquí el texto de tu página.\n\n## Un subtítulo\nUn párrafo de texto. Deja una línea en blanco para empezar otro párrafo.\n\n- Un elemento de una lista\n- Otro elemento";

export function FormPagina(p: FormProps) {
  const { t } = useI18n();
  const { borrador, poner, disabled, problemas } = p;
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);

  const bloques = useMemo(() => bloquesDeBorrador(leer(borrador, "bloques")), [borrador]);
  const delBorrador = useMemo(() => textoDeBloques(bloques), [bloques]);

  // El texto se edita como texto: esta copia es lo que se ve en el campo y, al escribir, se vuelve bloques en el borrador. Si el borrador cambia por otra causa (descartar, restaurar una versión, recargar)
  // el campo adopta ese texto; lo que ella escribe no se pisa, porque sus bloques ya son los del borrador (así tampoco se le «arreglan» los espacios mientras teclea).
  const [escrito, setEscrito] = useState(delBorrador);
  const escritoAhora = useRef(escrito);
  useEffect(() => {
    escritoAhora.current = escrito;
  }, [escrito]);
  useEffect(() => {
    if (!mismosBloques(bloquesDeTexto(escritoAhora.current), bloques)) setEscrito(delBorrador);
  }, [bloques, delBorrador]);

  const cambiar = (valor: string) => {
    setEscrito(valor);
    poner("bloques", bloquesDeTexto(valor));
  };

  /** Agrega un subtítulo o una lista al final, con el cursor listo para escribir. */
  const agregar = (marca: string) => {
    const base = escrito.replace(/\s+$/, "");
    const nuevo = base === "" ? marca : `${base}\n\n${marca}`;
    cambiar(nuevo);
    setTimeout(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nuevo.length, nuevo.length);
    }, 0);
  };

  // Los problemas del texto: los que se ven escribiendo (mismo esquema que al publicar) y los que devolvió la última revisión, cada uno con el comienzo del bloque que lo causa.
  const delServidor = problemas
    .filter((x) => x.severidad === "error" && /^bloques(\.|$)/.test(x.campo))
    .map((x) => {
      const indice = /^bloques\.(\d+)/.exec(x.campo)?.[1];
      const bloque = indice === undefined ? undefined : bloques[Number(indice)];
      return bloque ? `«${inicioDeBloque(bloque)}»: ${x.mensaje}` : x.mensaje;
    });
  const erroresTexto = [...new Set([...problemasDeBloques(bloques), ...delServidor])];
  const caracteres = caracteresDePagina(bloques);
  const errorTitulo = problemas.find((x) => x.severidad === "error" && x.campo === "titulo")?.mensaje ?? null;

  return (
    <div className="space-y-5">
      <Tarjeta
        titulo={t("Tu página", "Your page")}
        descripcion={t(
          "Escribe aquí una política, unos términos o cualquier información que quieras darle a tus clientes. Al publicarla tiene su propia dirección dentro de tu tienda; para que tus clientes la encuentren, agrégale un enlace desde el «Pie de página».",
          "Write a policy, terms or any information you want to give your customers. Once published it has its own address inside your store; so your customers can find it, add a link to it from the “Footer”.",
        )}
      >
        <CampoTexto etiqueta={t("Título de la página", "Page title")} ayuda={t("Por ejemplo «Política de privacidad». Es lo primero que ve el cliente.", "For example “Privacy policy”. It is the first thing the customer sees.")} valor={texto(borrador, "titulo")} onCambio={(v) => poner("titulo", v)} maxLength={80} disabled={disabled} requerido error={errorTitulo} />

        <Campo
          id={id}
          etiqueta={t("Texto de la página", "Page text")}
          ayuda={t(
            "Deja una línea en blanco para empezar un párrafo nuevo. Empieza una línea con «## » para un subtítulo y con «- » para un elemento de una lista.",
            "Leave a blank line to start a new paragraph. Start a line with “## ” for a subtitle and with “- ” for a list item.",
          )}
          requerido
        >
          <textarea
            id={id}
            ref={area}
            value={escrito}
            onChange={(e) => cambiar(e.target.value)}
            rows={20}
            placeholder={t(EJEMPLO, "Write the text of your page here.\n\n## A subtitle\nA paragraph of text. Leave a blank line to start another paragraph.\n\n- A list item\n- Another item")}
            disabled={disabled}
            aria-invalid={erroresTexto.length > 0 ? true : undefined}
            aria-describedby={erroresTexto.length > 0 ? `${id}-errores` : undefined}
            className={cn(inputCls, "min-h-[22rem] resize-y leading-relaxed", erroresTexto.length > 0 && "border-red-500/60")}
          />
        </Campo>

        {erroresTexto.length > 0 && (
          <ul id={`${id}-errores`} role="alert" className="space-y-1 text-[12px] text-red-400">
            {erroresTexto.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {!disabled ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => agregar("## ")} className={cn(actionBtn, "text-[13px]")}>
                <Plus className="size-4" aria-hidden /> {t("Agregar un subtítulo", "Add a subtitle")}
              </button>
              <button type="button" onClick={() => agregar("- ")} className={cn(actionBtn, "text-[13px]")}>
                <Plus className="size-4" aria-hidden /> {t("Agregar una lista", "Add a list")}
              </button>
            </div>
          ) : (
            <span />
          )}
          <p className="text-[11px] text-mist/80">
            {t(`${caracteres.toLocaleString("es-CO")} de ${MAX_CARACTERES_PAGINA.toLocaleString("es-CO")} caracteres · ${bloques.length} de ${MAX_BLOQUES_PAGINA} bloques`, `${caracteres.toLocaleString("en-US")} of ${MAX_CARACTERES_PAGINA.toLocaleString("en-US")} characters · ${bloques.length} of ${MAX_BLOQUES_PAGINA} blocks`)}
          </p>
        </div>
      </Tarjeta>
    </div>
  );
}
