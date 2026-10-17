"use client";

/**
 * Administración de tienda — el MÍNIMO de la compra inicial mayorista. Muestra el monto vigente y, a quien administra, deja cambiarlo.
 *
 * A diferencia de los textos, el monto NO se publica: se aplica de inmediato, porque es lo que el asistente exige en la primera compra de un mayorista y lo que muestran los textos que escriben
 * {{minimo_mayorista}}. Por eso cambiarlo pide confirmar, y la confirmación dice con palabras qué cambia (incluidos los textos del asistente que lo tienen escrito a mano, que se actualizan juntos
 * para no contradecir al pedido). La pantalla solo guía: el servidor vuelve a validar el rol, el rango y que el monto no haya cambiado mientras tanto, y la base lo cambia todo o nada.
 */
import { useEffect, useId, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { MINIMO_MAYORISTA_MAX, MINIMO_MAYORISTA_MIN, contarLugares, type GrupoDeLugar, type MinimoMayoristaVista } from "@/lib/cms-comercial/minimo-mayorista";
import { formatearPesos } from "@/lib/cms-comercial/variables";
import { useCatalogToast } from "@/components/dashboard/catalogo/ui";
import { useTienda } from "@/components/dashboard/tienda/contexto";
import { Aviso, BotonCargando, Campo, Cargando, Dialogo, Tarjeta, actionBtn, cn, dangerBtn, inputCls, primaryBtn } from "@/components/dashboard/tienda/ui";

type Vista = MinimoMayoristaVista & { disponible: boolean };

const NOMBRE_DEL_GRUPO: Readonly<Record<GrupoDeLugar, readonly [string, string]>> = {
  mayor: ["El mensaje que el asistente manda cuando el cliente elige comprar por mayor", "The message the assistant sends when the customer chooses to buy wholesale"],
  inicio: ["Otros mensajes de inicio del asistente", "Other opening messages of the assistant"],
  conocimiento: ["La información oficial que el asistente conoce de tu negocio", "The official information the assistant knows about your business"],
  pedido: ["Los textos del pedido del asistente", "The assistant's order texts"],
  reglas: ["La presentación y las reglas del asistente", "The assistant's introduction and rules"],
  otros: ["Otros textos del asistente", "Other assistant texts"],
};

export function MinimoMayorista() {
  const { t } = useI18n();
  const avisar = useCatalogToast();
  const { client, canWrite, recargarContexto } = useTienda();
  const idCampo = useId();
  const [vista, setVista] = useState<Vista | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const [texto, setTexto] = useState("");
  const [errorCampo, setErrorCampo] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [avisoCambio, setAvisoCambio] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void client.minimoMayorista().then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setVista(r.data);
        setErrorCarga(null);
      } else setErrorCarga(r.error.message);
    });
    return () => {
      vivo = false;
    };
  }, [client, intento]);

  // Solo dígitos (como el precio del catálogo): nunca un «NaN» en pantalla ni un decimal. Se muestra con puntos de miles.
  const nuevo = texto === "" ? undefined : Number(texto);
  const mostrado = nuevo === undefined ? "" : nuevo.toLocaleString("es-CO");
  const editable = Boolean(vista && canWrite && vista.disponible && vista.configurado && vista.uniforme);

  const revisar = () => {
    if (!vista || vista.minimo === null) return;
    setAvisoCambio(null);
    if (nuevo === undefined) return setErrorCampo(t("Escribe el monto en pesos.", "Enter the amount in pesos."));
    if (nuevo < MINIMO_MAYORISTA_MIN || nuevo > MINIMO_MAYORISTA_MAX) {
      return setErrorCampo(t(`El mínimo debe estar entre ${formatearPesos(MINIMO_MAYORISTA_MIN)} y ${formatearPesos(MINIMO_MAYORISTA_MAX)}.`, `The minimum must be between ${formatearPesos(MINIMO_MAYORISTA_MIN)} and ${formatearPesos(MINIMO_MAYORISTA_MAX)}.`));
    }
    if (nuevo === vista.minimo) return setErrorCampo(t("Ese ya es el monto actual.", "That is already the current amount."));
    setErrorCampo(null);
    setErrorGuardar(null);
    setConfirmando(nuevo);
  };

  const cerrar = () => {
    if (guardando) return;
    setConfirmando(null);
    setErrorGuardar(null);
  };

  const confirmar = async () => {
    if (!vista || vista.minimo === null || confirmando === null || guardando) return;
    setGuardando(true);
    setErrorGuardar(null);
    const r = await client.fijarMinimoMayorista(confirmando, vista.minimo);
    setGuardando(false);
    if (!r.ok) {
      if (r.error.status === 409) {
        // Cambió mientras se decidía (otra persona, o la configuración): se vuelve a leer el monto y el motivo queda a la vista.
        setConfirmando(null);
        setAvisoCambio(r.error.message);
        setIntento((n) => n + 1);
      } else setErrorGuardar(r.error.message);
      return;
    }
    setConfirmando(null);
    setTexto("");
    setErrorCampo(null);
    setAvisoCambio(null);
    setIntento((n) => n + 1);
    void recargarContexto();
    const textos = r.data.lugares.length;
    avisar(
      textos > 0
        ? t(`Mínimo actualizado a ${formatearPesos(r.data.despues)}. También se actualizó el monto escrito en ${textos} ${textos === 1 ? "texto" : "textos"} del asistente.`, `Minimum updated to ${formatearPesos(r.data.despues)}. The amount written in ${textos} assistant ${textos === 1 ? "text" : "texts"} was updated too.`)
        : t(`Mínimo actualizado a ${formatearPesos(r.data.despues)}.`, `Minimum updated to ${formatearPesos(r.data.despues)}.`),
    );
  };

  const grupos = vista ? contarLugares(vista.lugares) : [];

  return (
    <Tarjeta
      titulo={t("Monto mínimo de la compra mayorista", "Minimum amount of a wholesale purchase")}
      descripcion={t(
        "Es lo que el asistente exige en la PRIMERA compra de un mayorista y lo que muestran los textos que usan {{minimo_mayorista}} (como la introducción de esta página). Se aplica de inmediato: no hace falta publicar.",
        "It is what the assistant requires on a wholesaler's FIRST purchase and what the texts that use {{minimo_mayorista}} show (like this page's introduction). It applies right away: no need to publish.",
      )}
    >
      {errorCarga ? (
        <Aviso tono="danger" titulo={t("No pudimos cargar el monto", "We couldn't load the amount")}>
          {errorCarga}
          <button type="button" onClick={() => setIntento((n) => n + 1)} className={cn(actionBtn, "mt-2")}>
            {t("Reintentar", "Retry")}
          </button>
        </Aviso>
      ) : vista === null ? (
        <Cargando />
      ) : (
        <>
          <p data-testid="minimo-actual" className="text-2xl font-semibold tabular-nums text-fg">
            {vista.configurado && vista.minimo !== null ? formatearPesos(vista.minimo) : <span className="text-base font-normal text-mist">{t("Todavía no está configurado", "Not configured yet")}</span>}
          </p>

          {avisoCambio && (
            <Aviso tono="info" titulo={t("El monto cambió", "The amount changed")}>
              {avisoCambio}
            </Aviso>
          )}

          {!vista.disponible ? (
            <Aviso tono="info">{t("Cambiar el monto desde aquí todavía no está activo para tu negocio. Avísale al equipo de DuLabs.", "Changing the amount from here isn't active for your business yet. Let the DuLabs team know.")}</Aviso>
          ) : !vista.configurado ? (
            <Aviso tono="info">{t("Tu asistente todavía no tiene un mínimo configurado. Avísale al equipo de DuLabs para dejarlo listo.", "Your assistant doesn't have a minimum configured yet. Let the DuLabs team know so it gets set up.")}</Aviso>
          ) : !vista.uniforme ? (
            <Aviso tono="info">{t("Tus líneas de WhatsApp tienen montos mínimos distintos, así que no se puede cambiar uno solo desde aquí. Avísale al equipo de DuLabs.", "Your WhatsApp lines have different minimum amounts, so a single one can't be changed from here. Let the DuLabs team know.")}</Aviso>
          ) : !canWrite ? (
            <p className="text-xs text-mist">{t("Solo un administrador puede cambiarlo.", "Only an administrator can change it.")}</p>
          ) : null}

          {editable && (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                revisar();
              }}
            >
              <Campo id={idCampo} etiqueta={t("Nuevo monto mínimo", "New minimum amount")} ayuda={t("En pesos. Puedes escribirlo con o sin puntos.", "In pesos. You can type it with or without dots.")} error={errorCampo}>
                <div className="relative sm:max-w-xs">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-mist">$</span>
                  <input id={idCampo} type="text" inputMode="numeric" autoComplete="off" value={mostrado} onChange={(e) => setTexto(e.target.value.replace(/\D/g, "").slice(0, 10))} aria-invalid={errorCampo ? true : undefined} className={cn(inputCls, "pl-7 tabular-nums", errorCampo && "border-red-500/60")} />
                </div>
              </Campo>
              <button type="submit" className={primaryBtn} disabled={texto === ""}>
                {t("Cambiar monto", "Change amount")}
              </button>
            </form>
          )}
        </>
      )}

      <Dialogo
        abierto={confirmando !== null && vista !== null && vista.minimo !== null}
        titulo={vista?.minimo != null && confirmando !== null ? t(`Cambiar el mínimo de ${formatearPesos(vista.minimo)} a ${formatearPesos(confirmando)}`, `Change the minimum from ${formatearPesos(vista.minimo)} to ${formatearPesos(confirmando)}`) : ""}
        descripcion={t("Se aplica de inmediato. Revisa qué cambia:", "It applies right away. Check what changes:")}
        onCerrar={cerrar}
        acciones={
          <>
            <button type="button" onClick={cerrar} disabled={guardando} autoFocus className={actionBtn}>
              {t("Cancelar", "Cancel")}
            </button>
            <BotonCargando type="button" cargando={guardando} onClick={() => void confirmar()} className={confirmando !== null && vista?.minimo != null && confirmando < vista.minimo ? dangerBtn : primaryBtn}>
              {confirmando !== null ? t(`Sí, cambiar a ${formatearPesos(confirmando)}`, `Yes, change to ${formatearPesos(confirmando)}`) : ""}
            </BotonCargando>
          </>
        }
      >
        {confirmando !== null && (
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg" data-testid="efectos-minimo">
            <li>{t(`El asistente pedirá ${formatearPesos(confirmando)} como mínimo en la primera compra de un mayorista.`, `The assistant will require ${formatearPesos(confirmando)} as the minimum on a wholesaler's first purchase.`)}</li>
            <li>{t(`Los textos que usan {{minimo_mayorista}} mostrarán ${formatearPesos(confirmando)}.`, `The texts that use {{minimo_mayorista}} will show ${formatearPesos(confirmando)}.`)}</li>
            {grupos.length > 0 && (
              <li>
                {t(`El monto escrito a mano en ${vista?.lugares.length} ${vista?.lugares.length === 1 ? "texto" : "textos"} del asistente se actualiza igual, para que no diga otro número:`, `The amount written by hand in ${vista?.lugares.length} assistant ${vista?.lugares.length === 1 ? "text" : "texts"} is updated too, so none says a different number:`)}
                <ul className="mt-1 list-[circle] space-y-1 pl-5 text-mist" data-testid="textos-del-asistente">
                  {grupos.map((g) => (
                    <li key={g.grupo}>
                      {t(NOMBRE_DEL_GRUPO[g.grupo][0], NOMBRE_DEL_GRUPO[g.grupo][1])}
                      {g.n > 1 ? ` (${g.n})` : ""}
                    </li>
                  ))}
                </ul>
              </li>
            )}
          </ul>
        )}
        {errorGuardar && <Aviso tono="danger">{errorGuardar}</Aviso>}
      </Dialogo>
    </Tarjeta>
  );
}
