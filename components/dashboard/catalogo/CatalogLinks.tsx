"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, Lock, RefreshCw, Store } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { CatalogClient, PublicationView } from "@/lib/catalogo-client";
import { cn, useCatalogToast } from "@/components/dashboard/catalogo/ui";

function useOrigin(): string {
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    // El origen solo existe en el navegador (preview de Vercel o dulabs.co).
    let vivo = true;
    void Promise.resolve().then(() => vivo && setOrigin(window.location.origin));
    return () => {
      vivo = false;
    };
  }, []);
  return origin;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          window.setTimeout(() => setOk(false), 1500);
        } catch {
          // Portapapeles no disponible: el link sigue visible para copiarlo a mano.
        }
      }}
      className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-fg transition-colors hover:border-white/30"
      aria-label={label}
    >
      {ok ? <Check className="size-4 text-lime-text" /> : <Copy className="size-4 text-mist" />}
      <span className="hidden sm:inline">{ok ? "Copiado" : "Copiar"}</span>
    </button>
  );
}

/** Links públicos del catálogo: la vitrina vive FUERA del dashboard. */
export function CatalogLinks({ client, canWrite }: { client: CatalogClient | null; canWrite: boolean }) {
  const { t } = useI18n();
  const toast = useCatalogToast();
  const origin = useOrigin();
  const [publication, setPublication] = useState<PublicationView | null | undefined>(undefined);
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    if (!client) return;
    let vivo = true;
    void client.getPublication().then((r) => {
      if (vivo) setPublication(r.ok ? r.data.publication : null);
    });
    return () => {
      vivo = false;
    };
  }, [client]);

  const regenerar = async () => {
    if (!client) return;
    const ok = window.confirm(
      t(
        "¿Regenerar el link mayorista? El link actual dejará de funcionar y tendrás que enviar el nuevo a tus mayoristas.",
        "Regenerate the wholesale link? The current link will stop working and you will need to send the new one to your wholesalers.",
      ),
    );
    if (!ok) return;
    setRotating(true);
    const r = await client.rotateWholesaleLink();
    setRotating(false);
    if (!r.ok) {
      toast(r.error.message, "error");
      return;
    }
    setPublication(r.data.publication);
    toast(t("Link mayorista regenerado", "Wholesale link regenerated"));
  };

  if (publication === undefined) {
    return <div className="h-[132px] animate-pulse rounded-2xl border border-edge bg-card" aria-hidden />;
  }

  if (publication === null) {
    return (
      <div className="rounded-2xl border border-edge bg-card p-5 text-sm text-mist">
        {t("Los links del catálogo aún no están creados. Un administrador los crea al abrir esta sección.", "Catalog links are not created yet. An admin creates them by opening this section.")}
      </div>
    );
  }

  const detal = `${origin}${publication.retailPath}`;
  const mayor = publication.wholesalePath ? `${origin}${publication.wholesalePath}` : null;

  return (
    <section className="rounded-2xl border border-edge bg-card" aria-label={t("Links del catálogo", "Catalog links")}>
      <div className="flex items-center justify-between gap-3 border-b border-edge px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-fg">{t("Links del catálogo", "Catalog links")}</h2>
          <p className="mt-0.5 text-xs text-mist">{t("Tus clientes ven los productos activos en estos links. Aquí solo cargas y administras.", "Your customers see active products on these links. Here you only load and manage.")}</p>
        </div>
      </div>

      <div className="divide-y divide-edge">
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink-2 text-fg">
              <Store className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">{t("Catálogo detal", "Retail catalog")}</p>
              <p className="truncate font-mono text-xs text-mist">{detal}</p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <CopyButton text={detal} label={t("Copiar link detal", "Copy retail link")} />
            <a href={detal} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg bg-lime px-4 py-2 text-sm font-medium text-lime-fg transition-opacity hover:opacity-90">
              {t("Ver productos", "View products")}
              <ExternalLink className="size-4" />
            </a>
          </div>
        </div>

        {canWrite && mayor && (
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink-2 text-amber-300">
                <Lock className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">
                  {t("Catálogo mayorista", "Wholesale catalog")} <span className="ml-1 text-xs font-normal text-mist">{t("· link privado", "· private link")}</span>
                </p>
                {/* El secreto no se muestra en pantalla: se copia o se abre. */}
                <p className="truncate font-mono text-xs text-mist">{`${origin}/catalogo/${publication.slug}/mayor/••••••••`}</p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <CopyButton text={mayor} label={t("Copiar link mayorista", "Copy wholesale link")} />
              <a href={mayor} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-fg transition-colors hover:border-white/30">
                <ExternalLink className="size-4 text-mist" />
                <span className="hidden sm:inline">{t("Abrir", "Open")}</span>
              </a>
              <button
                type="button"
                onClick={regenerar}
                disabled={rotating}
                className={cn("flex items-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-mist transition-colors hover:border-white/30 hover:text-fg", rotating && "opacity-60")}
                title={t("Regenerar link mayorista", "Regenerate wholesale link")}
              >
                {rotating ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                <span className="hidden lg:inline">{t("Regenerar", "Regenerate")}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
