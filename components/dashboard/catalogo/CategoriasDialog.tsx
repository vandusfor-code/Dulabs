"use client";

/**
 * Administrador de categorías del Catálogo: lista cada categoría con cuántos productos usa y deja ELIMINARLAS. Una categoría con productos no se borra a ciegas: la
 * persona elige primero a qué categoría pasan sus productos o si quedan sin categoría. La pantalla solo guía; el servidor vuelve a validar todo (rol, negocio,
 * destino) y la base de datos impide borrar una categoría que todavía tenga productos.
 */
import { useEffect, useId, useState } from "react";
import { Tag, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { CATEGORY_MOVE_NONE, type CatalogCategoryWithCount, type CategoryDeleteResult } from "@/lib/catalogo/domain";
import type { CatalogClient } from "@/lib/catalogo-client";
import { BotonCargando, Dialogo, actionBtn, dangerBtn, inputCls } from "@/components/dashboard/tienda/ui";
import { useCatalogToast } from "@/components/dashboard/catalogo/ui";

export interface CategoriasDialogProps {
  abierto: boolean;
  client: CatalogClient | null;
  onCerrar: () => void;
  /** Se eliminó una categoría: la pantalla del catálogo refresca sus categorías y su listado (los productos pudieron cambiar de categoría). */
  onEliminada: (id: string, resultado: CategoryDeleteResult) => void;
}

export function CategoriasDialog({ abierto, client, onCerrar, onEliminada }: CategoriasDialogProps) {
  const { t } = useI18n();
  const aviso = useCatalogToast();
  const idDestino = useId();
  const [categorias, setCategorias] = useState<CatalogCategoryWithCount[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [pendiente, setPendiente] = useState<CatalogCategoryWithCount | null>(null);
  const [destino, setDestino] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (!abierto || !client) return;
    let vivo = true;
    void client.listCategoriesWithCounts().then((r) => {
      if (!vivo) return; // respuesta vieja: nunca pisa a la actual
      if (r.ok) {
        setCategorias(r.data.categories);
        setErrorCarga(null);
      } else {
        setErrorCarga(r.error.message);
      }
    });
    return () => {
      vivo = false;
    };
  }, [abierto, client, intento]);

  const cuenta = (n: number) =>
    n === 0 ? t("Sin productos", "No products") : n === 1 ? t("1 producto", "1 product") : t(`${n.toLocaleString("es-CO")} productos`, `${n.toLocaleString("en-US")} products`);

  const cerrar = () => {
    if (ocupado) return;
    setPendiente(null);
    setDestino("");
    setErrorAccion(null);
    setCategorias(null);
    setErrorCarga(null);
    onCerrar();
  };

  const volverALista = () => {
    setPendiente(null);
    setDestino("");
    setErrorAccion(null);
  };

  const recargar = () => {
    setCategorias(null);
    setErrorCarga(null);
    setIntento((n) => n + 1);
  };

  const eliminar = async () => {
    if (!client || !pendiente || ocupado) return;
    setOcupado(true);
    setErrorAccion(null);
    const r = await client.deleteCategory(pendiente.id, pendiente.productCount > 0 ? destino : undefined);
    setOcupado(false);
    if (!r.ok) {
      if (r.error.status === 404 || r.error.status === 409) {
        // Cambió mientras la persona decidía (otra persona la borró, o entró un producto nuevo): se vuelve a la lista con los números al día y el motivo a la vista.
        volverALista();
        setErrorAccion(r.error.message);
        recargar();
      } else {
        setErrorAccion(r.error.message);
      }
      return;
    }
    const { moved, movedTo } = r.data;
    const nombre = pendiente.name;
    const uno = moved === 1;
    aviso(
      moved === 0
        ? t(`Categoría «${nombre}» eliminada.`, `Category “${nombre}” deleted.`)
        : movedTo
          ? t(`Categoría «${nombre}» eliminada. ${cuenta(moved)} ${uno ? "pasó" : "pasaron"} a «${movedTo.name}».`, `Category “${nombre}” deleted. ${cuenta(moved)} moved to “${movedTo.name}”.`)
          : t(`Categoría «${nombre}» eliminada. ${cuenta(moved)} ${uno ? "quedó" : "quedaron"} sin categoría.`, `Category “${nombre}” deleted. ${cuenta(moved)} left without a category.`),
    );
    onEliminada(pendiente.id, r.data);
    volverALista();
    recargar();
  };

  const otras = pendiente ? (categorias ?? []).filter((c) => c.id !== pendiente.id) : [];
  const faltaDestino = pendiente !== null && pendiente.productCount > 0 && destino === "";

  return (
    <Dialogo
      abierto={abierto}
      titulo={pendiente ? t(`Eliminar «${pendiente.name}»`, `Delete “${pendiente.name}”`) : t("Categorías", "Categories")}
      descripcion={pendiente ? t("Esta acción no se puede deshacer.", "This cannot be undone.") : t("Estas son las categorías de tu catálogo. Elimina las que ya no uses.", "These are your catalog categories. Delete the ones you no longer use.")}
      onCerrar={cerrar}
      acciones={
        pendiente ? (
          <>
            <button type="button" onClick={volverALista} disabled={ocupado} autoFocus={pendiente.productCount === 0} className={actionBtn}>
              {t("Cancelar", "Cancel")}
            </button>
            <BotonCargando type="button" cargando={ocupado} disabled={faltaDestino} onClick={() => void eliminar()} className={dangerBtn}>
              {t("Eliminar categoría", "Delete category")}
            </BotonCargando>
          </>
        ) : (
          <button type="button" onClick={cerrar} className={actionBtn}>
            {t("Cerrar", "Close")}
          </button>
        )
      }
    >
      {pendiente ? (
        <>
          {pendiente.productCount > 0 ? (
            <div>
              <label htmlFor={idDestino} className="mb-1.5 block text-xs font-medium text-fg">
                {t(`«${pendiente.name}» tiene ${cuenta(pendiente.productCount)}. ¿Qué hacemos con ellos?`, `“${pendiente.name}” has ${cuenta(pendiente.productCount)}. What should we do with them?`)}
              </label>
              <select id={idDestino} autoFocus value={destino} disabled={ocupado} onChange={(e) => setDestino(e.target.value)} className={inputCls}>
                <option value="">{t("Elige una opción…", "Choose an option…")}</option>
                {otras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {t(`Pasarlos a «${c.name}»`, `Move them to “${c.name}”`)}
                  </option>
                ))}
                <option value={CATEGORY_MOVE_NONE}>{t("Dejarlos sin categoría", "Leave them without a category")}</option>
              </select>
            </div>
          ) : (
            <p className="text-sm text-mist">{t("No tiene productos. Si la necesitas más adelante, la vuelves a crear.", "It has no products. If you need it later, you can create it again.")}</p>
          )}
          <p className="rounded-lg border border-edge bg-ink p-3 text-xs leading-relaxed text-mist">
            {t(
              "Si esta categoría estaba elegida en la sección Tienda (destacadas, ofertas, pie de página o fotos del inicio), deja de mostrarse allí. Antes de volver a publicar, quítala de esos lugares.",
              "If this category was chosen in the Store section (featured, offers, footer or home photos), it stops showing there. Remove it from those places before publishing again.",
            )}
          </p>
          {errorAccion && (
            <p role="alert" className="text-sm text-red-400">
              {errorAccion}
            </p>
          )}
        </>
      ) : (
        <>
          {errorAccion && (
            <p role="alert" className="text-sm text-red-400">
              {errorAccion}
            </p>
          )}
          {errorCarga ? (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-red-400">
                {errorCarga}
              </p>
              <button type="button" onClick={recargar} className={actionBtn}>
                {t("Reintentar", "Try again")}
              </button>
            </div>
          ) : categorias === null ? (
            <p className="text-sm text-mist">{t("Cargando categorías…", "Loading categories…")}</p>
          ) : categorias.length === 0 ? (
            <p className="text-sm text-mist">{t("Todavía no tienes categorías. Las creas al agregar un producto.", "You have no categories yet. You create them when adding a product.")}</p>
          ) : (
            <ul aria-label={t("Categorías del catálogo", "Catalog categories")} className="divide-y divide-edge rounded-lg border border-edge bg-ink">
              {categorias.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Tag className="size-4 shrink-0 text-mist" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">{c.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-mist">{cuenta(c.productCount)}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorAccion(null);
                      setDestino("");
                      setPendiente(c);
                    }}
                    aria-label={t(`Eliminar la categoría ${c.name}`, `Delete the category ${c.name}`)}
                    className="shrink-0 rounded-md p-1.5 text-mist transition-colors hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Dialogo>
  );
}
