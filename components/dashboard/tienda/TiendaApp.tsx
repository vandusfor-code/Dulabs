"use client";

/**
 * Administración de tienda — pantalla principal: pestañas (página principal, ofertas, combos, campañas, contenido, historial) y el editor de cada elemento.
 * Recibe el cliente de la API y el permiso de escritura (la página los saca de la sesión); así se puede probar sin red.
 */
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { CmsClient } from "@/lib/cms-comercial-client";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { borradorInicial } from "@/components/dashboard/tienda/borrador";
import { TiendaProvider, useTienda } from "@/components/dashboard/tienda/contexto";
import { EditorEntidad } from "@/components/dashboard/tienda/editor";
import { ListaEntidades, type TipoLista } from "@/components/dashboard/tienda/lista";
import { PanelHistorial } from "@/components/dashboard/tienda/paneles";
import { actionBtn, Aviso, BotonCargando, Cargando, cn, primaryBtn } from "@/components/dashboard/tienda/ui";

type Pestana = "home" | TipoLista | "historial";

// ---------------------------------------------------------------------------
// Página principal: hay una sola; se edita directamente (sin lista)
// ---------------------------------------------------------------------------

type EstadoHome = { fase: "cargando" } | { fase: "error"; mensaje: string } | { fase: "vacio" } | { fase: "listo"; id: string };

function PestanaHome() {
  const { t } = useI18n();
  const { client, canWrite } = useTienda();
  const [estado, setEstado] = useState<EstadoHome>({ fase: "cargando" });
  const [recarga, setRecarga] = useState(0);
  const [creando, setCreando] = useState(false);
  const [errorCrear, setErrorCrear] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void client.listar({ tipo: "home" }).then((r) => {
      if (!vivo) return;
      if (!r.ok) setEstado({ fase: "error", mensaje: r.error.message });
      else if (r.data.items[0]) setEstado({ fase: "listo", id: r.data.items[0].id });
      else setEstado({ fase: "vacio" });
    });
    return () => {
      vivo = false;
    };
  }, [client, recarga]);

  const crear = async () => {
    setCreando(true);
    setErrorCrear(null);
    const r = await client.crear("home", borradorInicial("home"));
    setCreando(false);
    if (!r.ok) {
      setErrorCrear(r.error.message);
      return;
    }
    setEstado({ fase: "listo", id: r.data.entidad.id });
  };

  if (estado.fase === "cargando") {
    return (
      <div className="px-4 pt-6 md:px-8">
        <Cargando />
      </div>
    );
  }
  if (estado.fase === "error") {
    return (
      <div className="px-4 pt-6 md:px-8">
        <Aviso tono="danger" titulo={t("No pudimos cargar la página principal", "We couldn't load the home page")}>
          {estado.mensaje}
          <button type="button" onClick={() => setRecarga((n) => n + 1)} className="mt-2 block text-sm underline underline-offset-2">
            {t("Reintentar", "Retry")}
          </button>
        </Aviso>
      </div>
    );
  }
  if (estado.fase === "vacio") {
    return (
      <div className="px-4 pt-6 md:px-8">
        <div className="rounded-2xl border border-dashed border-edge bg-card px-6 py-14 text-center">
          <p className="text-base font-semibold text-fg">{t("Todavía no configuraste la página principal", "You haven't set up the home page yet")}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-mist">
            {canWrite ? t("Aquí eliges la portada, el banner, las categorías y los productos destacados. Se guarda como borrador hasta que la publiques.", "Here you choose the cover, banner, featured categories and products. It is saved as a draft until you publish it.") : t("Cuando un administrador la configure, la verás aquí.", "When an administrator sets it up, you'll see it here.")}
          </p>
          {errorCrear && (
            <div className="mx-auto mt-4 max-w-md text-left">
              <Aviso tono="danger">{errorCrear}</Aviso>
            </div>
          )}
          {canWrite && (
            <BotonCargando type="button" cargando={creando} onClick={() => void crear()} className={cn(primaryBtn, "mx-auto mt-5")}>
              {t("Crear la página principal", "Create the home page")}
            </BotonCargando>
          )}
        </div>
      </div>
    );
  }
  return <EditorEntidad key={estado.id} id={estado.id} />;
}

// ---------------------------------------------------------------------------

function Contenido() {
  const { t } = useI18n();
  const { contexto } = useTienda();
  const [pestana, setPestana] = useState<Pestana>("home");
  const [editando, setEditando] = useState<string | null>(null);

  const pestanas: Array<{ id: Pestana; etiqueta: string }> = [
    { id: "home", etiqueta: t("Página principal", "Home page") },
    { id: "oferta", etiqueta: t("Ofertas", "Offers") },
    { id: "combo", etiqueta: t("Combos", "Combos") },
    { id: "campana", etiqueta: t("Campañas", "Campaigns") },
    { id: "contenido", etiqueta: t("Contenido", "Content") },
    { id: "historial", etiqueta: t("Historial", "History") },
  ];

  const enEditorDeLista = editando !== null && pestana !== "home" && pestana !== "historial";

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow={t("Tienda", "Store")}
        title={t("Administrar tienda", "Manage store")}
        description={t(
          "Cambia la portada, las ofertas, los combos y la información de tu tienda sin depender de nadie. Lo que publiques aquí es lo que ven tus clientes y lo que ARIA les informa; nada se publica hasta que tú lo apruebas.",
          "Change your cover, offers, combos and store information without depending on anyone. What you publish here is what your customers see and what ARIA tells them; nothing is published until you approve it.",
        )}
      >
        {/* La tienda se abre en otra pestaña: se ve tal como la ven los clientes (lo publicado; los borradores no aparecen). */}
        {contexto?.rutaTienda && (
          <a href={contexto.rutaTienda} target="_blank" rel="noopener noreferrer" className={cn(actionBtn, "text-[13px]")}>
            <ExternalLink className="size-4" aria-hidden /> {t("Ver mi tienda", "View my store")}
          </a>
        )}
      </PageHeader>

      {!enEditorDeLista && (
        <div className="px-4 pt-5 md:px-8">
          <div role="tablist" aria-label={t("Secciones de la tienda", "Store sections")} className="flex gap-1 overflow-x-auto rounded-lg border border-edge bg-card p-1 sm:inline-flex">
            {pestanas.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                id={`tienda-tab-${p.id}`}
                aria-selected={pestana === p.id}
                aria-controls={`tienda-panel-${p.id}`}
                onClick={() => {
                  setPestana(p.id);
                  setEditando(null);
                }}
                className={cn("shrink-0 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors", pestana === p.id ? "bg-lime text-lime-fg" : "text-mist hover:text-fg")}
              >
                {p.etiqueta}
              </button>
            ))}
          </div>
        </div>
      )}

      <div role="tabpanel" id={`tienda-panel-${pestana}`} aria-labelledby={`tienda-tab-${pestana}`} className={cn(!enEditorDeLista && "mt-5")}>
        {pestana === "home" && <PestanaHome />}
        {pestana === "historial" && (
          <div className="px-4 md:px-8">
            <p className="mb-3 max-w-2xl text-sm text-mist">{t("Todo lo que se creó, editó, publicó, pausó o restauró en tu tienda: quién lo hizo y cuándo.", "Everything created, edited, published, paused or restored in your store: who did it and when.")}</p>
            <PanelHistorial />
          </div>
        )}
        {pestana !== "home" && pestana !== "historial" &&
          (editando ? (
            <EditorEntidad key={editando} id={editando} onVolver={() => setEditando(null)} />
          ) : (
            <div className="px-4 md:px-8">
              <ListaEntidades key={pestana} tipo={pestana} onAbrir={setEditando} />
            </div>
          ))}
      </div>
    </div>
  );
}

export function TiendaApp({ client, canWrite }: { client: CmsClient; canWrite: boolean }) {
  return (
    <TiendaProvider client={client} canWrite={canWrite}>
      <Contenido />
    </TiendaProvider>
  );
}
