"""Bloque 35 — pruebas de mutación: pestañas con contador del módulo Pedidos y ELIMINAR pedidos y
clientes. Se quita UNA protección, alguna prueba DEBE fallar; luego se restaura el archivo.
Uso: python3 scripts/mutacion/b35.py (desde la raíz del repo; sin BD ni red). Las funciones SQL tienen
su prueba en PostgreSQL real (supabase/tests/20261204000000_dulabs_catalogo_eliminar.test.sql) y la
matriz E2E (bloque Q)."""
import os
import subprocess
import sys

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
GE = "lib/catalogo/pedidos/gestion.ts"
RE = "lib/catalogo/pedidos/repositorio.ts"
CR = "lib/catalogo/clientes/repositorio.ts"
UI = "components/dashboard/pedidos/ui.tsx"
T = ["lib/catalogo/pedidos/pedidos-b35.test.ts", "lib/catalogo/clientes/eliminar-b35.test.ts"]
M = [
    ("M1 un pedido confirmado cuenta como cerrado (se podría eliminar con stock apartado)", RE,
     'export const CLOSED_STATUSES: readonly OrderStatus[] = ["completed", "cancelled", "rejected", "expired"];',
     'export const CLOSED_STATUSES: readonly OrderStatus[] = ["completed", "cancelled", "rejected", "expired", "confirmed"];'),
    ("M2 eliminar deja el historial huérfano", RE,
     "      for (let j = history.length - 1; j >= 0; j--) if (history[j].businessId === input.businessId && history[j].orderId === o.id) history.splice(j, 1);\n", ""),
    ("M3 eliminar sin copia en la auditoría", RE,
     "      deleted.push({ order: clone(o), memberId: input.memberId });\n", ""),
    ("M4 se eliminan propuestas del chat (nunca confirmadas)", GE,
     "    if (!found || !found.order.confirmedAt) return apiError(\"NOT_FOUND\", \"No encontramos ese pedido.\", 404);\n    if (!puedeEliminarse",
     "    if (!found) return apiError(\"NOT_FOUND\", \"No encontramos ese pedido.\", 404);\n    if (!puedeEliminarse"),
    ("M5 eliminar pedidos con rol de asesora", "app/api/dashboard/pedidos/[pedido]/route.ts",
     "  return withCatalog(\n    request,\n    \"write\",\n    async ({ supabase, actor, memberId }) => eliminarGestion",
     "  return withCatalog(\n    request,\n    \"orders\",\n    async ({ supabase, actor, memberId }) => eliminarGestion"),
    ("M6 'Cancelados' sin los rechazados", GE,
     'cancelados: { statuses: ["cancelled", "rejected", "expired"] },', 'cancelados: { statuses: ["cancelled", "expired"] },'),
    ("M7 'Pendientes' con cualquier confirmado", GE,
     'pendientes: { statuses: ["confirmed"], stages: ["confirmado"] },', 'pendientes: { statuses: ["confirmed"] },'),
    ("M8 los contadores ignoran los demás filtros", GE,
     "engine.panelCount(tenantId, { ...base, ...FILTRO_GRUPO[g] })", "engine.panelCount(tenantId, { ...FILTRO_GRUPO[g] })"),
    ("M9 contadores en cada página (cursor)", GE,
     "const conteos = cursor ? null : await contarGrupos", "const conteos = await contarGrupos"),
    ("M10 la pestaña no filtra", GE,
     "    Object.assign(f, FILTRO_GRUPO[grupo as GrupoPedidos]);\n", ""),
    ("M11 el pedido activo se marca como eliminable", GE,
     "    eliminable: CLOSED_STATUSES.includes(order.status),", "    eliminable: true,"),
    ("M12 eliminar cliente con pedidos activos", CR,
     "      if (activos > 0) return { resultado: \"pedidos_activos\", activos };\n", ""),
    ("M13 eliminar cliente deja su ficha", CR,
     "      fichas.delete(k(tenantId, pn, wa));\n", ""),
    ("M14 eliminar cliente sin auditoría", CR,
     "      eliminados.push({ tenantId, clave: `${pn}_${wa}`, miembroId, pedidos: suyos.length });\n", ""),
    ("M15 eliminar clientes con rol de asesora", "app/api/dashboard/clientes/[cliente]/route.ts",
     "  return withCatalog(\n    request,\n    \"write\",\n    async ({ supabase, actor, memberId }) => eliminarCliente",
     "  return withCatalog(\n    request,\n    \"orders\",\n    async ({ supabase, actor, memberId }) => eliminarCliente"),
    ("M16 'Hace' para lo que está por venir", UI,
     "(futuro ? t(`en ${es}`, `in ${en}`) : t(`Hace ${es}`, `${en} ago`))", "t(`Hace ${es}`, `${en} ago`)"),
    ("M17 periodo con un día de más", UI,
     "return dias ? { desde: diaBogota(ahora, dias - 1), hasta: diaBogota(ahora, 0) } : {};", "return dias ? { desde: diaBogota(ahora, dias), hasta: diaBogota(ahora, 0) } : {};"),
]
# (Sin mutante para "número de otro negocio" en el repositorio en memoria: es equivalente -- un negocio
# nunca tiene datos en un número ajeno; la regla real vive en la función SQL y su prueba en PostgreSQL.)
fallos = 0
for nombre, f, a, b in M:
    orig = open(f).read()
    if orig.count(a) != 1:
        print(f"{nombre}: NO APLICA (patrón {orig.count(a)} veces)")
        fallos += 1
        continue
    open(f, "w").write(orig.replace(a, b))
    try:
        r = subprocess.run(["npx", "tsx", "--test", *T], capture_output=True, text=True, timeout=900)
        failed = [line for line in r.stdout.splitlines() if line.startswith("# fail")]
        det = r.returncode != 0
        print(f"{nombre}: {'DETECTADA' if det else 'NO DETECTADA'} ({failed[0] if failed else '?'})")
        if not det:
            fallos += 1
    finally:
        open(f, "w").write(orig)
print(f"\n{len(M) - fallos}/{len(M)} mutaciones detectadas")
sys.exit(1 if fallos else 0)
