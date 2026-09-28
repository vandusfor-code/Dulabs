"""Bloque 31 — pruebas de mutación: notificaciones de estado de pedidos por WhatsApp. Se quita UNA
protección, alguna prueba DEBE fallar; luego se restaura el archivo.
Uso: python3 scripts/mutacion/b31.py (desde la raíz del repo; sin BD ni red)."""
import os
import subprocess
import sys

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
N = "lib/catalogo/pedidos/notificaciones.ts"
NP = "lib/catalogo/pedidos/notificaciones-produccion.ts"
G = "lib/catalogo/pedidos/gestion.ts"
T = "lib/catalogo/pedidos/notificaciones.test.ts"
M = [
    ("M1 un doble clic vuelve a enviar (sin candado pedido + tipo)", N,
     "    if (!reserva.creada) return resumen(reserva.registro, true);\n", ""),
    ("M2 se envía con la ventana de 24 h cerrada", N,
     "  if (!ventana.abierta) return cerrar({ estado: \"ventana_vencida\", motivo: \"ventana_vencida\" });\n", ""),
    ("M3 sin margen de seguridad al final de la ventana", N,
     "const venceEn = t + VENTANA_MS - MARGEN_VENTANA_MS;", "const venceEn = t + VENTANA_MS;"),
    ("M4 notifica negocios sin el módulo", N,
     "    if (!(await store.habilitado(input.tenantId))) return { estado: \"desactivada\" };\n", ""),
    ("M5 escribe sin comprobar que el número es del negocio", N,
     "  if (!canal) return cerrar({ estado: \"omitida\", motivo: \"sin_canal\" });\n", ""),
    ("M6 dos reintentos a la vez envían dos veces (sin compare-and-set)", N,
     "r.id, [r.estado], { estado: \"enviando\" });", "r.id, [r.estado, \"enviando\"], { estado: \"enviando\" });"),
    ("M7 reintentar una notificación ya enviada", N,
     "  if (r.estado === \"enviada\") return { estado: \"no_reintentable\", motivo: \"Esa notificación ya fue enviada.\" };\n", ""),
    ("M8 reintentar una notificación ya superada por otro estado", N,
     "export function sigueVigente(tipo: TipoNotificacion, o: Order): boolean {\n",
     "export function sigueVigente(tipo: TipoNotificacion, o: Order): boolean {\n  if (tipo) return true;\n"),
    ("M9 reintento inmediato de un envío incierto (posible duplicado)", N,
     "if (r.estado === \"desconocido\" && now() - Date.parse(r.updatedAt) < ESPERA_REINTENTO_INCIERTO_MS) {",
     "if (r.estado === \"desconocido\" && false) {"),
    ("M10 timeout tratado como fallo seguro (se reintenta a ciegas)", N,
     "estado: e.incierto ? \"desconocido\" : \"fallida\"", "estado: \"fallida\""),
    ("M11 131047 de Meta como fallo genérico", NP,
     "err.metaErrorCode === 131047);", "false);"),
    ("M12 el pedido en tienda dice 'enviado'", N,
     "  const tienda = d.entrega === \"tienda\";\n", "  const tienda = false;\n"),
    ("M13 el mensaje no queda en el Inbox", N,
     "    await enviador.registrar(canal, contacto.waId, texto, messageId).catch(() => undefined);\n", ""),
    ("M14 un error de la notificación rompe la acción del pedido", N,
     "err.message.slice(0, 120) : \"?\" });\n    return { estado: \"no_disponible\" };",
     "err.message.slice(0, 120) : \"?\" });\n    throw err;"),
    ("M15 se notifica antes de validar la transición", G,
     "    // Compare-and-set: la persona decidió sobre lo que VIO; si cambió, que lo vuelva a ver.\n",
     "    if (notificador) await notificarTransicion(notificador, { tenantId, tipo, antes: order, despues: order, miembroId: memberId });\n"),
    ("M16 se notifica con el pedido de antes del cambio", G,
     "{ tenantId, tipo, antes: order, despues, miembroId: memberId }", "{ tenantId, tipo, antes: order, despues: order, miembroId: memberId }"),
]
fallos = 0
for nombre, f, a, b in M:
    orig = open(f).read()
    if orig.count(a) != 1:
        print(f"{nombre}: NO APLICA (patrón {orig.count(a)} veces)")
        fallos += 1
        continue
    open(f, "w").write(orig.replace(a, b))
    try:
        r = subprocess.run(["npx", "tsx", "--test", T], capture_output=True, text=True, timeout=900)
        failed = [line for line in r.stdout.splitlines() if line.startswith("# fail")]
        det = r.returncode != 0
        print(f"{nombre}: {'DETECTADA' if det else 'NO DETECTADA'} ({failed[0] if failed else '?'})")
        if not det:
            fallos += 1
    finally:
        open(f, "w").write(orig)
print(f"\n{len(M) - fallos}/{len(M)} mutaciones detectadas")
sys.exit(1 if fallos else 0)
