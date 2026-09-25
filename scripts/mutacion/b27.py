"""Bloque 27 — pruebas de mutación: se quita UNA protección, la prueba correspondiente debe FALLAR; luego se restaura.

Uso: python3 scripts/mutacion/b27.py  (la parte de BD necesita un PostgreSQL LOCAL con las migraciones; nunca Supabase)."""
import subprocess, sys, os, tempfile
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
CK="lib/agente/agente-checkout.test.ts"; PB="lib/catalogo/pedidos/pedidos-b27.test.ts"; F7="lib/catalogo/pedidos/pedidos-fase7.test.ts"; RS="lib/catalogo/pedidos/reservas-stock.test.ts"
M = [
 # --- precio / total / modalidad (el backend decide; nunca Gemini) ---
 ("M01 total: se suma 1 al subtotal", "lib/catalogo/pedidos/motor.ts", "subtotal: unitPrice === null ? null : unitPrice * item.quantity });", "subtotal: unitPrice === null ? null : unitPrice * item.quantity + 1 });", CK),
 ("M02 precio: el mayorista recibe precio detal", "lib/catalogo/pedidos/motor.ts", 'const unitPrice = channel === "wholesale" ? p.prices.wholesale : p.prices.retail;', "const unitPrice = p.prices.retail;", CK),
 ("M03 modalidad: el motor acepta otra modalidad", "lib/catalogo/pedidos/motor.ts", "if (input.expectedChannel && order.channel !== input.expectedChannel) {", "if (false && input.expectedChannel && order.channel !== input.expectedChannel) {", CK),
 # --- stock / reserva ---
 ("M04 stock: la reserva no revisa existencias", "lib/catalogo/pedidos/repositorio.ts", "      if (p.stock < delta) {", "      if (false && p.stock < delta) {", RS),
 ("M05 reserva: confirmar no reserva", "lib/catalogo/pedidos/repositorio.ts", '    if (after.status === "confirmed") reconcile(after);', '    if (after.status === "confirmed") void 0;', CK),
 ("M06 cambio de precio antes del resumen saca del checkout", "lib/agente/checkout.ts", 'if (order.status === "draft" && order.issues.length > 0 && order.issues.every((i) => i.code === "price_changed")) {', "if (false) {", CK),
 # --- confirmación ---
 ("M07 confirmación: 'si' confirma", "lib/agente/checkout.ts", 'b === "checkout_confirmar" || t === CONFIRM_TITLE ? "confirm" :', 'b === "checkout_confirmar" || t === CONFIRM_TITLE || t === "si" ? "confirm" :', CK),
 ("M08 el modelo recupera confirm_order", "lib/agente/runtime.ts", 'deps.config.tools.filter((t) => t !== "confirm_order")', 'deps.config.tools.filter((t) => t !== "__nada__")', CK),
 ("M09 resumen viejo sin barrera", "lib/agente/checkout.ts", "if (!data || !ck.summary || order.confirmation?.id !== ck.summary.confirmationId || order.confirmation.total !== ck.summary.total) {", "if (!data || !ck.summary) {", CK),
 ("M10 domicilio sin dirección", "lib/catalogo/pedidos/motor.ts", "if (!c.address || c.address.trim().length < 3 || c.address.length > 300) return false;", "", CK),
 ("M11 nombre = teléfono", "lib/agente/checkout.ts", "isTrustedName(known) ? known.trim() : null),", "known ? known.trim() : null),", CK),
 # --- método de pago ---
 ("M12 método de pago invertido", "lib/agente/lenguaje/interpretar.ts", '  return tienda ? "pago_en_tienda" : "transferencia";', '  return tienda ? "transferencia" : "pago_en_tienda";', CK),
 # --- asesora / pausa ---
 ("M13 sin asesora tras confirmar", "lib/agente/checkout.ts", 'const paused = await io.handOff("pedido confirmado").catch(() => false);', "const paused = false;", CK),
 ("M14 pausa de 24 h en vez de hasta liberar", "lib/agente/runtime.ts", 'requestId, pauseUntil: "released" });', "requestId });", CK),
 ("M15 el traspaso cambia el estado del pedido", "lib/catalogo/pedidos/motor.ts", 'if (order.status !== "handoff" && !order.checkout) {', 'if (order.status !== "handoff") {', PB),
 ("M16 abandono: no se recupera la selección", "lib/agente/runtime.ts", "if (previo && state.cart.length === 0) {", "if (false) {", CK),
 # --- idempotencia / duplicados ---
 ("M17 Meta reenvía: el mismo wamid se procesa dos veces", "lib/agente/runtime.ts", "if (wamids.every((w) => loaded.state.recentWamids.includes(w))) {", "if (false) {", CK),
 ("M18 botón viejo llega al modelo", "lib/agente/runtime.ts", '} else if (isCheckoutButton(input.text, input.buttonId) && !(', '} else if (false && isCheckoutButton(input.text, input.buttonId) && !(', CK),
 ("M19 reintento del panel aplica dos veces", "lib/catalogo/pedidos/gestion.ts", "if (yaAplicada(order, accion)) return apiOk", "if (false) return apiOk", PB),
 ("M20 creación duplicada: la misma clave crea otro pedido", "lib/catalogo/pedidos/repositorio.ts", "      if (existing) return { created: false, order: clone(existing) };", "", F7),
 ("M21 sin compare-and-set del panel", "lib/catalogo/pedidos/gestion.ts", "if (order.status !== esperadoEstado || (order.checkout?.stage ?? null) !== esperadaEtapa || (order.checkout?.paymentStatus ?? null) !== esperadoPago) {", "if (false) {", PB),
 # --- estados / cancelación / vencimiento ---
 ("M22 estado: completar sin pago", "lib/catalogo/pedidos/contrato.ts", 'return stage === "entregado" && payment === "recibido";', 'return stage === "entregado";', PB),
 ("M23 estado: 'enviado' en recoger", "lib/catalogo/pedidos/contrato.ts", 'if (stage === "en_preparacion") return delivery === "domicilio" ? "enviado" : "entregado";', 'if (stage === "en_preparacion") return "enviado";', PB),
 ("M24 cancelación: se cancela lo ya enviado", "lib/catalogo/pedidos/contrato.ts", 'return stage === "confirmado" || stage === "en_preparacion";', "return true;", PB),
 ("M25 vencimiento: vence aunque esté en gestión", "lib/catalogo/pedidos/contrato.ts", 'return stage === "confirmado" && payment === "pendiente";', 'return payment === "pendiente";', PB),
 ("M26 cancelar sin motivo", "lib/catalogo/pedidos/gestion.ts", 'if ((accion === "cancelar" || accion === "rechazar") && (motivo.length < 3 || motivo.length > 300)) {', "if (false) {", PB),
 ("M27 panel viejo opera pedidos del checkout", "lib/catalogo/pedidos/panel.ts", "if (actual?.order.checkout) return apiError", "if (false) return apiError", PB),
 # --- tenant / permisos ---
 ("M28 tenant: se lee un pedido de otro negocio", "lib/catalogo/pedidos/repositorio.ts", "const o = orders.find((x) => x.businessId === businessId && x.orderId === orderId);", "const o = orders.find((x) => x.orderId === orderId);", PB),
 ("M29 permisos: 'lectura' gestiona pedidos", "lib/catalogo/auth.ts", 'export const CATALOG_ORDER_ROLES: readonly Rol[] = ["admin", "agente"];', 'export const CATALOG_ORDER_ROLES: readonly Rol[] = ["admin", "agente", "lectura"];', PB),
 ("M30 permisos: el módulo pedidos no se exige", "lib/catalogo/auth.ts", "moduleEnabled = await deps.isModuleEnabled(auth.supabase, auth.member.tenantId, module);", "moduleEnabled = await deps.isModuleEnabled(auth.supabase, auth.member.tenantId, CATALOG_MODULE);", PB),
 ("M31 permisos: teléfono buscable sin permiso", "lib/catalogo/pedidos/repositorio.ts", 'return allowPhone ? { kind: "phone", value: digits.slice(-12) } : { kind: "none", value: "" };', 'return { kind: "phone", value: digits.slice(-12) };', PB),
]
fallos = 0
for nombre, f, a, b, test in M:
    orig = open(f).read()
    if orig.count(a) != 1:
        print(f"{nombre}: NO APLICA (patrón {orig.count(a)} veces)"); fallos += 1; continue
    open(f, "w").write(orig.replace(a, b))
    try:
        r = subprocess.run(["npx", "tsx", "--test", test], capture_output=True, text=True, timeout=600)
        out = r.stdout
        failed = [l for l in out.splitlines() if l.startswith("# fail")]
        ok = r.returncode != 0
        print(f"{nombre}: {'DETECTADA' if ok else 'NO DETECTADA'} ({failed[0] if failed else '?'})")
        if not ok: fallos += 1
    finally:
        open(f, "w").write(orig)
# --- Mutaciones en la BD: migración mutada -> la prueba SQL debe fallar -> se reaplica la original.
MIG = "supabase/migrations/20261122000000_dulabs_catalogo_pedidos_checkout.sql"
SQLT = "supabase/tests/20261122000000_dulabs_catalogo_pedidos_checkout.test.sql"
# PostgreSQL LOCAL efímero con las migraciones del catálogo (nunca Supabase). Ajustable por entorno.
PSQL = ["psql", "-h", os.environ.get("PGHOST", "/var/tmp/pgsock"), "-p", os.environ.get("PGPORT", "55432"), "-U", os.environ.get("PGUSER", "postgres"), "-d", os.environ.get("PGDATABASE", "piloto"), "-v", "ON_ERROR_STOP=1", "-q"]
SQLM = [
 ("S1 BD: vence aunque esté en gestión", "       and (p.etapa is null or p.etapa = 'confirmado')\n", ""),
 ("S2 BD: el sistema confirma", "('pending_confirmation', 'confirmed', 'agent'), ('pending_confirmation', 'confirmed', 'human'),", "('pending_confirmation', 'confirmed', 'agent'), ('pending_confirmation', 'confirmed', 'human'), ('pending_confirmation', 'confirmed', 'system'),"),
 ("S3 BD: confirmado editable", "  if (new.checkout, new.lineas, new.total,", "  if false and (new.checkout, new.lineas, new.total,"),
 ("S4 BD: completar sin entregar/pagar", "    if new.estado = 'completed' and not (old.etapa = 'entregado' and old.estado_pago = 'recibido') then", "    if false then"),
 ("S5 BD: un pedido del checkout pasa a handoff", "  if new.estado = 'handoff' and old.estado is distinct from 'handoff' then", "  if false then"),
 ("S6 BD: se cancela lo ya enviado", "    if new.estado in ('cancelled', 'rejected') and old.estado = 'confirmed' and old.etapa not in ('confirmado', 'en_preparacion') then", "    if false then"),
 ("S7 BD: el pago vuelve atrás", "     and not (old.estado_pago = 'pendiente' and new.estado_pago = 'recibido' and old.estado = 'confirmed' and new.estado = 'confirmed') then", "     and false then"),
 ("S8 BD: domicilio entregado sin enviar", "            or (old.etapa = 'en_preparacion' and new.etapa = 'entregado' and old.tipo_entrega = 'tienda')", "            or (old.etapa = 'en_preparacion' and new.etapa = 'entregado')"),
]
orig_mig = open(MIG).read()
for nombre, a, b in SQLM:
    if orig_mig.count(a) != 1:
        print(f"{nombre}: NO APLICA ({orig_mig.count(a)})"); fallos += 1; continue
    tmp = os.path.join(tempfile.gettempdir(), "b27-mig-mutada.sql")
    open(tmp, "w").write(orig_mig.replace(a, b))
    try:
        subprocess.run(PSQL + ["-f", tmp], check=True, capture_output=True)
        r = subprocess.run(PSQL + ["-f", SQLT], capture_output=True, text=True)
        det = r.returncode != 0
        falla = [l for l in (r.stderr + r.stdout).splitlines() if "FAIL" in l or "ERROR" in l][:1]
        print(f"{nombre}: {'DETECTADA' if det else 'NO DETECTADA'} {falla[0][-90:] if falla else ''}")
        if not det: fallos += 1
    finally:
        subprocess.run(PSQL + ["-f", MIG], check=True, capture_output=True)
r = subprocess.run(PSQL + ["-f", SQLT], capture_output=True, text=True)
print("BD restaurada:", "OK" if r.returncode == 0 and r.stderr.count("PASS") == 12 else "REVISAR")
print("RESULTADO:", "todas detectadas" if fallos == 0 else f"{fallos} sin detectar")
sys.exit(1 if fallos else 0)
