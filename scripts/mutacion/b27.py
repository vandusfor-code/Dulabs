"""Bloque 27 — pruebas de mutación: se quita UNA protección, la prueba correspondiente debe FALLAR; luego se restaura.

Uso: python3 scripts/mutacion/b27.py  (la parte de BD necesita un PostgreSQL LOCAL con las migraciones; nunca Supabase)."""
import subprocess, sys, os, tempfile
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
CK="lib/agente/agente-checkout.test.ts"; PB="lib/catalogo/pedidos/pedidos-b27.test.ts"
M = [
 ("M1 confirmación estricta: 'ok' confirma", "lib/agente/checkout.ts", 'const CONFIRM_WORDS = new Set(["confirmar pedido",', 'const CONFIRM_WORDS = new Set(["ok", "dale", "confirmar pedido",', CK),
 ("M2 el modelo recupera confirm_order", "lib/agente/runtime.ts", 'deps.config.tools.filter((t) => t !== "confirm_order")', 'deps.config.tools.filter((t) => t !== "__nada__")', CK),
 ("M3 el motor acepta otra modalidad", "lib/catalogo/pedidos/motor.ts", 'if (input.expectedChannel && order.channel !== input.expectedChannel) {', 'if (false && input.expectedChannel && order.channel !== input.expectedChannel) {', CK),
 ("M4 domicilio sin dirección", "lib/catalogo/pedidos/motor.ts", 'if (!c.address || c.address.trim().length < 3 || c.address.length > 300) return false;', '', CK),
 ("M5 nombre = teléfono", "lib/agente/checkout.ts", 'customerName: isTrustedName(known) ? known.trim() : null,', 'customerName: known ? known.trim() : null,', CK),
 ("M6 resumen viejo sin barrera", "lib/agente/checkout.ts", 'if (!data || !ck.summary || order.confirmation?.id !== ck.summary.confirmationId || order.confirmation.total !== ck.summary.total) {', 'if (!data || !ck.summary) {', CK),
 ("M7 sin asesora tras confirmar", "lib/agente/checkout.ts", 'const paused = await io.handOff("pedido confirmado").catch(() => false);', 'const paused = false;', CK),
 ("M8 botón viejo llega al modelo", "lib/agente/runtime.ts", '} else if (isCheckoutButton(input.text, input.buttonId) && !(', '} else if (false && isCheckoutButton(input.text, input.buttonId) && !(', CK),
 ("M9 'enviado' en recoger", "lib/catalogo/pedidos/gestion.ts", 'if (stage === "en_preparacion" && delivery === "domicilio") out.push("enviado");', 'if (stage === "en_preparacion") out.push("enviado");', PB),
 ("M10 sin compare-and-set del panel", "lib/catalogo/pedidos/gestion.ts", 'if (order.status !== esperadoEstado || (order.checkout?.stage ?? null) !== esperadaEtapa) {', 'if (false) {', PB),
 ("M11 pagado vence", "lib/catalogo/pedidos/repositorio.ts", 'if (o.checkout?.paymentStatus === "recibido") continue;', '', PB),
 ("M12 confirmado editable", "lib/catalogo/pedidos/repositorio.ts", 'if (!after.checkout || frozen(before) !== frozen(after)) throw', 'if (false) throw', PB),
 ("M13 teléfono buscable sin permiso", "lib/catalogo/pedidos/repositorio.ts", 'return allowPhone ? { kind: "phone", value: digits.slice(-12) } : { kind: "none", value: "" };', 'return { kind: "phone", value: digits.slice(-12) };', PB),
 ("M14 cancelar sin motivo", "lib/catalogo/pedidos/gestion.ts", 'if ((accion === "cancelar" || accion === "rechazar") && (motivo.length < 3 || motivo.length > 300)) {', 'if (false) {', PB),
 ("M15 módulo pedidos no se exige", "lib/catalogo/auth.ts", 'moduleEnabled = await deps.isModuleEnabled(auth.supabase, auth.member.tenantId, module);', 'moduleEnabled = await deps.isModuleEnabled(auth.supabase, auth.member.tenantId, CATALOG_MODULE);', PB),
 ("M16 reintento aplica dos veces", "lib/catalogo/pedidos/gestion.ts", 'if (yaAplicada(order, accion)) return apiOk', 'if (false) return apiOk', PB),
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
MIG = "supabase/migrations/20261121000000_dulabs_catalogo_pedidos_checkout.sql"
SQLT = "supabase/tests/20261121000000_dulabs_catalogo_pedidos_checkout.test.sql"
# PostgreSQL LOCAL efímero con las migraciones del catálogo (nunca Supabase). Ajustable por entorno.
PSQL = ["psql", "-h", os.environ.get("PGHOST", "/var/tmp/pgsock"), "-p", os.environ.get("PGPORT", "55432"), "-U", os.environ.get("PGUSER", "postgres"), "-d", os.environ.get("PGDATABASE", "piloto"), "-v", "ON_ERROR_STOP=1", "-q"]
SQLM = [
 ("S1 BD: pagado vence", "       and p.estado_pago is distinct from 'recibido'\n", ""),
 ("S2 BD: el sistema confirma", "('pending_confirmation', 'confirmed', 'agent'), ('pending_confirmation', 'confirmed', 'human'),", "('pending_confirmation', 'confirmed', 'agent'), ('pending_confirmation', 'confirmed', 'human'), ('pending_confirmation', 'confirmed', 'system'),"),
 ("S3 BD: confirmado editable", "  if (new.checkout, new.lineas, new.total,", "  if false and (new.checkout, new.lineas, new.total,"),
 ("S4 BD: completar sin terminar", "  if new.estado = 'completed' and old.estado is distinct from 'completed'", "  if false and new.estado = 'completed' and old.estado is distinct from 'completed'"),
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
print("BD restaurada:", "OK" if r.returncode == 0 and r.stderr.count("PASS") == 11 else "REVISAR")
print("RESULTADO:", "todas detectadas" if fallos == 0 else f"{fallos} sin detectar")
sys.exit(1 if fallos else 0)
