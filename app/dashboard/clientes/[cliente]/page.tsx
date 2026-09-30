"use client";

// Bloque 33 — ficha de un cliente: datos, modalidad (con quién y por qué cambió), pedidos (cada uno
// abre su detalle en Pedidos) y la nota interna del equipo (compare-and-set: nadie pisa a nadie).
// Bloque 34: editar nombre, modalidad (con motivo si cambia) y "ya es cliente".
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, MessageCircle, RefreshCw, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";
import { NOTA_MAX, esMayoristaNuevo, type ClienteDetalle, type Modalidad } from "@/lib/catalogo/clientes/modelo";
import { CField, actionBtn, cn, formatPrice, inputCls, primaryBtn, useCatalogAccess, useCatalogToast } from "@/components/dashboard/catalogo/ui";
import { Badge, MODALIDAD, ORIGEN, estadoPedido, fechaCorta, telefonoVisible } from "@/components/dashboard/clientes/ui";

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-edge py-2 text-sm last:border-0">
      <dt className="text-mist">{label}</dt>
      <dd className="text-right text-fg">{children}</dd>
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-edge bg-card p-4 sm:p-5">
      <h2 className="mb-3 text-sm font-semibold text-fg">{titulo}</h2>
      {children}
    </section>
  );
}

const MODALIDAD_DE_CANAL = { retail: "detal", wholesale: "mayorista" } as const;

/** Nombre, modalidad y "ya es cliente": lo que el asistente usa cuando el cliente escribe. */
function EditarCliente({ clave, d, onSaved }: { clave: string; d: ClienteDetalle; onSaved: () => void }) {
  const { t } = useI18n();
  const { client } = useCatalogAccess();
  const toast = useCatalogToast();
  const guardada: Modalidad | null = d.modalidad ? MODALIDAD_DE_CANAL[d.modalidad.canal] : null;
  const [nombre, setNombre] = useState(d.cliente.nombre ?? "");
  const [modalidad, setModalidad] = useState<Modalidad | null>(guardada);
  const [motivo, setMotivo] = useState("");
  const [yaCompro, setYaCompro] = useState(d.cliente.yaCompro);
  const [enviando, setEnviando] = useState(false);

  const cambiaNombre = nombre.trim() !== "" && nombre.trim() !== (d.cliente.nombre ?? "");
  const cambiaModalidad = modalidad !== null && modalidad !== guardada;
  const cambiaYa = yaCompro !== d.cliente.yaCompro;
  const pideMotivo = cambiaModalidad && guardada !== null;
  const listo = (cambiaNombre || cambiaModalidad || cambiaYa) && (!pideMotivo || motivo.trim().length >= 3);

  async function guardar() {
    if (!client || enviando || !listo) return;
    setEnviando(true);
    const r = await client.updateClient(clave, {
      ...(cambiaNombre ? { nombre } : {}),
      ...(cambiaModalidad ? { modalidad: modalidad!, esperado: d.modalidad?.canal ?? null, ...(motivo.trim() ? { motivo } : {}) } : {}),
      ...(cambiaYa ? { yaCompro } : {}),
    });
    setEnviando(false);
    if (!r.ok) {
      toast(r.error.message, "error");
      if (r.error.status === 409) onSaved();
      return;
    }
    setMotivo("");
    toast(t("✓ Cliente actualizado.", "✓ Customer updated."));
    onSaved();
  }

  return (
    <div className="space-y-3">
      <CField label={t("Nombre", "Name")} htmlFor="edit-nombre" hint={t("Así lo saluda el asistente.", "The assistant greets them by this name.")}>
        <input id="edit-nombre" value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} className={inputCls} autoComplete="off" />
      </CField>
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-mist">{t("Modalidad", "Customer type")}</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["detal", t("🛍️ Detal", "🛍️ Retail")],
              ["mayorista", t("📦 Mayorista", "📦 Wholesale")],
            ] as const
          ).map(([id, texto]) => (
            <label key={id} className={cn("cursor-pointer rounded-xl border px-4 py-2 text-sm transition-colors", modalidad === id ? "border-fg bg-ink font-medium text-fg" : "border-edge text-mist hover:text-fg")}>
              <input type="radio" name="edit-modalidad" value={id} checked={modalidad === id} onChange={() => setModalidad(id)} className="sr-only" />
              {texto}
            </label>
          ))}
        </div>
      </fieldset>
      {pideMotivo && (
        <CField label={t("¿Por qué cambias la modalidad?", "Why are you changing the type?")} htmlFor="edit-motivo" required>
          <input id="edit-motivo" value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} placeholder={t("Ej.: ahora compra por cantidad para su tienda", "E.g.: now buys in bulk for their store")} className={inputCls} />
        </CField>
      )}
      <label className="flex items-start gap-2 text-sm text-fg">
        <input type="checkbox" checked={yaCompro} onChange={(e) => setYaCompro(e.target.checked)} className="mt-0.5" />
        <span>
          {t("Ya es cliente (ha comprado antes)", "Existing customer (has bought before)")}
          <span className="block text-xs text-mist">{t("Si es mayorista, no se le exige el mínimo de la primera compra.", "If wholesale, the first-purchase minimum doesn't apply.")}</span>
        </span>
      </label>
      <div className="flex justify-end">
        <button type="button" disabled={!listo || enviando} onClick={() => void guardar()} className={cn(primaryBtn, "disabled:opacity-50")}>
          {enviando ? t("Guardando…", "Saving…") : t("Guardar cambios", "Save changes")}
        </button>
      </div>
    </div>
  );
}

/** Bloque 35 — eliminar el cliente (solo administradores): todo lo suyo en el negocio, menos el chat. */
function EliminarCliente({ clave, d }: { clave: string; d: ClienteDetalle }) {
  const { t } = useI18n();
  const { client } = useCatalogAccess();
  const toast = useCatalogToast();
  const router = useRouter();
  const [enCurso, setEnCurso] = useState(false);
  const nombre = d.cliente.nombre ?? telefonoVisible(d.cliente.waId);
  const activos = d.pedidos.filter((p) => ["confirmed", "handoff"].includes(p.estado)).length;

  async function eliminar() {
    if (!client || enCurso) return;
    const ok = window.confirm(
      t(
        `¿Eliminar a ${nombre}? Se borran su modalidad, su nombre, su nota, su ficha y sus ${d.pedidos.length} pedido(s). El chat del Inbox se conserva y, si vuelve a escribir, el asistente empieza de cero. No se puede deshacer.`,
        `Delete ${nombre}? Their type, name, note, profile and ${d.pedidos.length} order(s) are removed. The Inbox chat is kept and, if they write again, the assistant starts from scratch. This cannot be undone.`,
      ),
    );
    if (!ok) return;
    setEnCurso(true);
    const r = await client.deleteClient(clave);
    setEnCurso(false);
    if (!r.ok) return toast(r.error.message, "error");
    toast(t(`✓ Cliente eliminado.`, `✓ Customer deleted.`));
    router.push("/dashboard/clientes");
  }

  return (
    <div>
      {activos > 0 && (
        <p className="mb-3 text-xs text-amber-500">
          {t(
            `Tiene ${activos} pedido(s) activo(s): cancélalos primero en Pedidos (el stock apartado vuelve) para poder eliminarlo.`,
            `Has ${activos} active order(s): cancel them first in Orders (reserved stock returns) to delete it.`,
          )}
        </p>
      )}
      <button type="button" disabled={enCurso || activos > 0} onClick={() => void eliminar()} className={cn(actionBtn, "text-red-400 hover:text-red-300 disabled:opacity-50")}>
        <Trash2 className="size-4" />
        {enCurso ? t("Eliminando…", "Deleting…") : t("Eliminar cliente", "Delete customer")}
      </button>
      <p className="mt-2 text-xs text-mist">
        {t(
          "Borra su modalidad, nombre, nota, ficha y pedidos cerrados. El chat del Inbox se conserva. No se puede deshacer.",
          "Removes their type, name, note, profile and closed orders. The Inbox chat is kept. This cannot be undone.",
        )}
      </p>
    </div>
  );
}

export default function ClienteFichaPage() {
  const { t } = useI18n();
  const params = useParams<{ cliente: string }>();
  const clave = decodeURIComponent(params.cliente ?? "");
  const { client, canWrite } = useCatalogAccess();
  const toast = useCatalogToast();
  const [d, setD] = useState<ClienteDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(() => {
    if (!client) return;
    void client.getClient(clave).then((r) => {
      if (r.ok) {
        setD(r.data);
        setNota(r.data.nota?.texto ?? "");
        setError(null);
      } else setError(r.error.message);
    });
  }, [client, clave]);
  useEffect(cargar, [cargar]);

  async function guardarNota() {
    if (!client || !d || guardando) return;
    setGuardando(true);
    const r = await client.saveClientNote(clave, nota, d.nota?.version ?? 0);
    setGuardando(false);
    if (!r.ok) {
      toast(r.error.message, "error");
      // Conflicto: se recarga la versión actual (lo escrito sigue en el cuadro para no perderlo).
      if (r.error.status === 409 && client) {
        const actual = await client.getClient(clave);
        if (actual.ok) setD(actual.data);
      }
      return;
    }
    setD({ ...d, nota: r.data.nota, cliente: { ...d.cliente, tieneNota: r.data.nota.texto !== "" } });
    toast(t("✓ Nota guardada.", "✓ Note saved."));
  }

  if (error) {
    return (
      <div className="px-4 pt-6 md:px-8">
        <Link href="/dashboard/clientes" className={actionBtn}>
          <ArrowLeft className="size-4" />
          {t("Clientes", "Customers")}
        </Link>
        <p className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>
      </div>
    );
  }
  if (!d) return <div className="mx-4 mt-6 h-48 animate-pulse rounded-2xl bg-card md:mx-8" aria-hidden />;

  const c = d.cliente;
  const chat = `/dashboard/mensajes?${new URLSearchParams({ phone_number_id: c.phoneNumberId, telefono_cliente: c.waId })}`;
  const cambioNota = nota.trim() !== (d.nota?.texto ?? "");

  return (
    <div className="pb-16">
      <PageHeader eyebrow={t("Cliente", "Customer")} title={c.nombre ?? t("Sin nombre", "No name")}>
        <Link href="/dashboard/clientes" className={actionBtn}>
          <ArrowLeft className="size-4" />
          {t("Clientes", "Customers")}
        </Link>
        <Link href={chat} className={actionBtn}>
          <MessageCircle className="size-4" />
          {t("Abrir chat", "Open chat")}
        </Link>
        <button type="button" onClick={cargar} className={actionBtn}>
          <RefreshCw className="size-4" />
          {t("Actualizar", "Refresh")}
        </button>
      </PageHeader>

      <div className="grid gap-4 px-4 pt-6 md:px-8 lg:grid-cols-2">
        <Seccion titulo={t("Datos del cliente", "Customer details")}>
          <div className="mb-3 flex flex-wrap gap-2">
            {c.canal && <Badge tone={MODALIDAD[c.canal].tone}>{t(MODALIDAD[c.canal].es, MODALIDAD[c.canal].en)}</Badge>}
            {c.yaCompro && <Badge tone="bg-teal-500/15 text-teal-400">{t("Cliente antiguo", "Existing customer")}</Badge>}
            {c.registrado && <Badge tone="bg-sky-500/15 text-sky-400">{t("Registrado por el equipo", "Registered by team")}</Badge>}
            {esMayoristaNuevo(c) && <Badge tone="bg-amber-500/15 text-amber-500">{t("Mayorista nuevo: su primera compra debe llegar al mínimo", "New wholesale: first purchase must reach the minimum")}</Badge>}
          </div>
          <dl>
            <Dato label={t("Teléfono", "Phone")}>
              <a className="text-lime-text hover:underline" href={`https://wa.me/${c.waId}`} target="_blank" rel="noreferrer">
                {telefonoVisible(c.waId)}
              </a>
            </Dato>
            <Dato label={t("Compras", "Purchases")}>{c.compras}</Dato>
            <Dato label={t("Total comprado", "Total purchased")}>{formatPrice(c.totalComprado)}</Dato>
            <Dato label={t("Pedidos", "Orders")}>{c.pedidos}</Dato>
            <Dato label={t("Ciudad", "City")}>{c.ciudad ?? "—"}</Dato>
            <Dato label={t("Primer contacto", "First contact")}>{fechaCorta(c.primerContacto)}</Dato>
            <Dato label={t("Último contacto", "Last contact")}>{fechaCorta(c.ultimoContacto)}</Dato>
          </dl>
        </Seccion>

        <Seccion titulo={t("Nota interna del equipo", "Internal team note")}>
          <textarea
            value={nota}
            maxLength={NOTA_MAX}
            onChange={(e) => setNota(e.target.value)}
            rows={5}
            placeholder={t("Ej.: cliente VIP, paga siempre por Nequi, prefiere piezas en plata.", "E.g.: VIP customer, always pays by Nequi, prefers silver.")}
            className="w-full rounded-xl border border-edge bg-ink px-3 py-2 text-sm text-fg"
            aria-label={t("Nota interna", "Internal note")}
          />
          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-mist">
            <span>
              {nota.length}/{NOTA_MAX}
              {d.nota && ` · ${t("Actualizada", "Updated")} ${fechaCorta(d.nota.actualizadoAt)}`}
            </span>
            <button type="button" disabled={!cambioNota || guardando} onClick={() => void guardarNota()} className={cn(primaryBtn, "disabled:opacity-50")}>
              {guardando ? t("Guardando…", "Saving…") : t("Guardar nota", "Save note")}
            </button>
          </div>
          <p className="mt-2 text-xs text-mist">{t("Solo la ve el equipo; el cliente y el asistente no la ven.", "Only the team sees it; the customer and the assistant don't.")}</p>
        </Seccion>

        <Seccion titulo={t("Pedidos", "Orders")}>
          {d.pedidos.length === 0 ? (
            <p className="text-sm text-mist">{t("Todavía no tiene pedidos.", "No orders yet.")}</p>
          ) : (
            <ul className="divide-y divide-edge">
              {d.pedidos.map((p) => {
                const e = estadoPedido(p.estado, p.etapa, t);
                const fila = (
                  <div className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="font-mono text-fg">{p.pedido}</span>
                    <Badge tone={e.tone}>{e.texto}</Badge>
                    <span className="text-xs text-mist">{fechaCorta(p.creado)}</span>
                    <span className="ml-auto font-semibold tabular-nums text-fg">{formatPrice(p.total)}</span>
                  </div>
                );
                // Solo los pedidos confirmados existen en el módulo Pedidos.
                return <li key={p.pedido}>{p.confirmado ? <Link href={`/dashboard/pedidos/${p.pedido}`} className="block hover:bg-ink">{fila}</Link> : fila}</li>;
              })}
            </ul>
          )}
        </Seccion>

        <Seccion titulo={t("Editar cliente", "Edit customer")}>
          {/* key: al recargar la ficha, el formulario arranca de lo guardado. */}
          <EditarCliente key={`${c.nombre}|${d.modalidad?.canal ?? ""}|${c.yaCompro}`} clave={clave} d={d} onSaved={cargar} />
        </Seccion>

        <Seccion titulo={t("Modalidad", "Customer type")}>
          {!d.modalidad ? (
            <p className="text-sm text-mist">{t("Aún no eligió detal o por mayor (su modalidad sale de su pedido).", "Hasn't chosen retail or wholesale yet (type comes from their order).")}</p>
          ) : (
            <>
              <p className="text-sm text-fg">
                {t(MODALIDAD[d.modalidad.canal].es, MODALIDAD[d.modalidad.canal].en)} · <span className="text-mist">{t(ORIGEN[d.modalidad.origen]?.es ?? "", ORIGEN[d.modalidad.origen]?.en ?? "")}</span>
              </p>
              {d.modalidad.historial.length > 0 && (
                <ol className="mt-3 space-y-1.5 text-xs text-mist">
                  {d.modalidad.historial.map((h, i) => (
                    <li key={i}>
                      {fechaCorta(h.at)} · {h.from ? `${t(MODALIDAD[h.from].es, MODALIDAD[h.from].en)} → ` : ""}
                      {t(MODALIDAD[h.to].es, MODALIDAD[h.to].en)} · {t(ORIGEN[h.origin]?.es ?? "", ORIGEN[h.origin]?.en ?? "")}
                      {h.reason ? ` · “${h.reason}”` : ""}
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </Seccion>

        {canWrite && (
          <Seccion titulo={t("Eliminar cliente", "Delete customer")}>
            <EliminarCliente clave={clave} d={d} />
          </Seccion>
        )}
      </div>
    </div>
  );
}
