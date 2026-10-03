# Aprovisionamiento de Aquí Sí Lo Compras (Fase 3B.9A) — sin activar

Esta carpeta NO es de migraciones (vive fuera de `supabase/migrations` a propósito): son scripts que el dueño revisa y corre a mano en el SQL Editor de
Supabase. Ninguno se ejecutó en producción desde el código. Todos se probaron en un Postgres local efímero (pglite) con datos ficticios.

| Orden | Archivo | Qué hace | Escribe |
|---|---|---|---|
| 0 | `../migrations/20261208000000_dulabs_catalogo_pedido_notificaciones_aceptado.sql` | (solo si 01 dice que NO está aplicada) amplía el CHECK de `tipo` de las notificaciones con `aceptado`. Rollback: `../rollbacks/20261208000000_…down.sql`. | sí (CHECK) |
| 1 | `01_verificar_estado_solo_lectura.sql` | UNA consulta SELECT con el estado completo (identidad, pausa/restricción, agente, módulos, equipo, migraciones, catálogo). Se corre ANTES y DESPUÉS. Sin secretos. | no |
| 2 | `02_aprovisionar_sin_activar.sql` | Crea la fila del agente DESHABILITADA (con candado de activación) y habilita los módulos `catalogo`, `pedidos` y `pedidos_por_aceptar`. Generado por `scripts/generar-aprovisionamiento-aslc.ts`; no se edita a mano. | sí |
| 3 | `01_…` otra vez | Estado final: todas las `comprobaciones` en `true`; solo cambia la huella de módulos de ASLC. | no |
| — | `04_revertir_aprovisionamiento.sql` | Reversa del 02 (se niega a borrar una fila que alguien habilitó o cambió). | sí |
| — | `scripts/verificar-aslc-solo-lectura.mts` | Verificación de **solo lectura** desde el repo (service role, solo `select`): `npx tsx --env-file=.env.local scripts/verificar-aslc-solo-lectura.mts --etapa=inicial` (antes del 02) o `--etapa=aprovisionado` (después). Imprime el estado sin secretos, una huella de los demás negocios (no debe cambiar) y un checklist; termina con código 1 si falla. Reemplaza pegar el resultado del 01 cuando se corre desde el repo. | no |
| — | `textos-aprobados.json` | Lo único aprobado por el negocio en textos (el aviso, EXACTO) y lo que sigue pendiente (`null`). | no |

## Reglas

- El 02 identifica al negocio por su **tenant + phone_number_id + nombre** (verificados con una lectura de solo lectura el 2026-10-03; ver `IDENTIDAD_ASLC_PRODUCCION`);
  aborta si no hay exactamente UNA fila, si la IA no está pausada, si la credencial `env:GEMINI_KEY_ASLC` la usa otro número o si ya existe una fila de
  agente para el número. **No usa `telefono_negocio`**: en la base el número conectado a Meta figura con un teléfono distinto del que informó el negocio.
- No cambia `ia_pausada` ni `ia_restringida_a`, no activa el agente, no toca `notificaciones_pedidos`, no crea personas, no carga productos y no envía
  mensajes. Habilita `catalogo` porque sin ese módulo el negocio no puede cargar sus productos (panel, API, importación y publicación del catálogo).
- La fila queda con `habilitado = false` **y** `checkout_opciones.activacion_pendiente = true` (candado): aunque alguien habilite la fila por error,
  la configuración es inválida y el agente calla. Con la fila el webhook entrega todo mensaje al agente antes de Flow / Business Agent / legacy.
- La activación (fase posterior, con tu autorización expresa) reemplaza `checkout_opciones` por la configuración COMPLETA (sin el candado), carga la
  credencial `GEMINI_KEY_ASLC` en Vercel (solo producción), cambia `FUNCIONES_3B_IMPLEMENTADAS.cierre_aceptacion_humana` a `true` en el código,
  enciende `transcripcion_audio` si las pruebas reales salieron bien y, al final, `habilitado = true` y quita `ia_pausada`.
