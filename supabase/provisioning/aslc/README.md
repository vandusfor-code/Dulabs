# Aprovisionamiento y activación de Aquí Sí Lo Compras (Fases 3B.9A y 3B.9D)

Esta carpeta NO es de migraciones (vive fuera de `supabase/migrations` a propósito): son scripts que el dueño revisa y corre a mano en el SQL Editor de
Supabase. Ninguno se ejecutó en producción desde el código. Todos se probaron en un Postgres local efímero (pglite) con datos ficticios.

**Estado en producción (2026-10-05):** aplicados la migración `20261208`, el `02`, el `03`, el `05` y el `11`: el agente está habilitado con el estilo, las políticas y los textos del negocio, y la IA **activa pero restringida** a un número de
prueba (`06`, abrir al público, NO está aplicado). Runbook completo, QA de 16 casos y límites conocidos: `docs/CATALOG_SALES_FASE_3B9D.md`. Orden de la activación: `08`
(opcional) → `03` → desplegar el código → catálogo → `05` → QA → `06`. Siempre disponibles: `07` (freno), `10` (reanudar tras el freno), `09` (cambiar responsable) y `11`
(ajustar el comportamiento con la IA ya corriendo: estilo, políticas e información oficial; no necesita desplegar).

### Activación (3B.9D) — paso a paso

| Paso | Archivo | Qué hace | Escribe |
|---|---|---|---|
| 1 (opcional) | `08_ver_equipo_solo_lectura.sql` | Lista al equipo de ASLC y marca quién sirve como responsable (activo + rol admin/agente). Sin correos. | no |
| 2 | `03_configurar_completo_sin_activar.sql` | Carga la configuración COMPLETA (sin el candado) y las políticas del negocio, y enciende el checkout conversacional. **Se editan solo 2 líneas** (`v_responsable`, `v_respaldo`). La fila sigue deshabilitada y la IA pausada. Verifica el aviso obligatorio byte a byte (SHA-256) dentro de la base. | sí |
| 3 | (código) | Desplegar el código con `cierre_aceptacion_humana = true` (merge a `main`). Las variables de Vercel solo aplican a despliegues nuevos. | — |
| 4 | `05_activacion_controlada.sql` | Habilita el agente, enciende el audio y quita la pausa, **solo si la IA sigue restringida** a números de prueba. Se niega si `notificaciones_pedidos` está encendido. | sí |
| 5 | `06_abrir_al_publico.sql` | Quita la restricción (abre al público). Solo con la etapa controlada en marcha, tras el QA. | sí |
| siempre | `07_freno_de_emergencia.sql` | Pausa la IA al instante (una sentencia). | sí |
| siempre | `10_reanudar_tras_freno.sql` | Quita SOLO la pausa; la restricción queda como estaba (controlado o público). Nunca es la primera activación. | sí |
| siempre | `09_cambiar_responsable.sql` | Cambia el responsable con la fila ya habilitada. | sí |
| siempre | `11_ajustar_comportamiento.sql` | Con la fila **ya habilitada** (y la IA corriendo): deja el comportamiento que pidió el negocio sin pausar ni redesplegar. Escribe SOLO `negocio` (estilo, políticas e información oficial: ubicación, qué responder a quien desconfía, horario) y, dentro de `checkout_opciones`, la respuesta tras el "sí" (nombra a la responsable), la ortografía de la transportadora (Interrapidísimo) y los textos de los tiempos de envío (Bogotá antes y después de las 11:30, fin de semana y resto de ciudades: el modelo los repite tal cual y el candado de envíos debe aceptarlos). **No toca** `ia_pausada`, `ia_restringida_a`, `habilitado`, el audio, el responsable ni el aviso (verifica su SHA-256 antes de escribir). Idempotente. | sí |
| siempre | `12_avisos_de_decision.sql` | **Fase 3B.9E.** Con la configuración completa cargada: guarda los textos de **aceptado / rechazado / cancelado** (propuesta de DuLabs, sin nombres ni promesas; léelos en el archivo antes de correrlo) y enciende el módulo `avisos_decision_pedidos`: el cliente recibe un mensaje cuando una persona del equipo acepta, rechaza o cancela su pedido (dentro de las 24 h de WhatsApp, una sola vez por pedido y decisión). **No** enciende `notificaciones_pedidos` (avisos genéricos de cada etapa, con plantillas de otro negocio) y se niega si alguien lo encendió. Idempotente. | sí |
| siempre | `13_aviso_por_correo.sql` | **Fase 3B.9E.** Además del panel, un **correo a la persona responsable** cuando un pedido espera su aceptación (solo el número de pedido y el enlace; nada del cliente). Se niega si la responsable no está activa, no tiene rol que decida o **no tiene un correo válido** (sin correo la configuración quedaría inválida y el agente callaría). Idempotente. | sí |

Los archivos `03` y `05` a `13` los GENERA `lib/agente/activacion-aslc.ts` (`npx tsx scripts/generar-aprovisionamiento-aslc.ts`); no se editan a mano y una prueba verifica
que cada archivo es exactamente la salida del generador. Los textos del negocio (aviso, respuesta tras el "sí", ubicación y qué responder a quien desconfía) salen de
`textos-aprobados.json`: el código no trae ninguno.

### Aprovisionamiento (3B.9A) — ya aplicado

| Orden | Archivo | Qué hace | Escribe |
|---|---|---|---|
| 0 | `../migrations/20261208000000_dulabs_catalogo_pedido_notificaciones_aceptado.sql` | (solo si 01 dice que NO está aplicada) amplía el CHECK de `tipo` de las notificaciones con `aceptado`. Rollback: `../rollbacks/20261208000000_…down.sql`. | sí (CHECK) |
| 1 | `01_verificar_estado_solo_lectura.sql` | UNA consulta SELECT con el estado completo (identidad, pausa/restricción, agente, módulos, equipo, migraciones, catálogo). Se corre ANTES y DESPUÉS. Sin secretos. | no |
| 2 | `02_aprovisionar_sin_activar.sql` | Crea la fila del agente DESHABILITADA (con candado de activación) y habilita los módulos `catalogo`, `pedidos` y `pedidos_por_aceptar`. Generado por `scripts/generar-aprovisionamiento-aslc.ts`; no se edita a mano. | sí |
| 3 | `01_…` otra vez | Estado final: todas las `comprobaciones` en `true`; solo cambia la huella de módulos de ASLC. | no |
| — | `04_revertir_aprovisionamiento.sql` | Reversa del 02 (se niega a borrar una fila que alguien habilitó o cambió). | sí |
| — | `scripts/verificar-aslc-solo-lectura.mts` | Verificación de **solo lectura** desde el repo (service role, solo `select`): `npx tsx --env-file=.env.local scripts/verificar-aslc-solo-lectura.mts --etapa=inicial` (antes del 02), `aprovisionado` (después del 02), `configurado` (después del 03), `controlado` (después del 05) o `publico` (después del 06). Imprime el estado sin secretos, una huella de los demás negocios (no debe cambiar) y un checklist; termina con código 1 si falla. Juzga la fila con el parser y las compuertas REALES del runtime. Reemplaza pegar el resultado del 01 cuando se corre desde el repo. | no |
| — | `textos-aprobados.json` | Lo que el negocio definió en textos: el aviso (EXACTO, byte a byte), la respuesta tras el "sí", la ubicación y qué responder a quien desconfía. Lo demás sigue pendiente (`null`). | no |

## Reglas

- El 02 identifica al negocio por su **tenant + phone_number_id + nombre** (verificados con una lectura de solo lectura el 2026-10-03; ver `IDENTIDAD_ASLC_PRODUCCION`);
  aborta si no hay exactamente UNA fila, si la IA no está pausada, si la credencial `env:GEMINI_KEY_ASLC` la usa otro número o si ya existe una fila de
  agente para el número. **No usa `telefono_negocio`**: en la base el número conectado a Meta figura con un teléfono distinto del que informó el negocio.
- No cambia `ia_pausada` ni `ia_restringida_a`, no activa el agente, no toca `notificaciones_pedidos`, no crea personas, no carga productos y no envía
  mensajes. Habilita `catalogo` porque sin ese módulo el negocio no puede cargar sus productos (panel, API, importación y publicación del catálogo).
- La fila queda con `habilitado = false` **y** `checkout_opciones.activacion_pendiente = true` (candado): aunque alguien habilite la fila por error,
  la configuración es inválida y el agente calla. Con la fila el webhook entrega todo mensaje al agente antes de Flow / Business Agent / legacy.
- La activación (con la autorización expresa del dueño) es: `03` (configuración COMPLETA, sin el candado), `GEMINI_KEY_ASLC` en Vercel (solo producción; aplica al
  siguiente despliegue), `FUNCIONES_3B_IMPLEMENTADAS.cierre_aceptacion_humana = true` en el código (3B.9D), y `05` (`habilitado = true`, `transcripcion_audio = true` y quita
  `ia_pausada`, sin tocar `ia_restringida_a`); al final `06` abre al público tras el QA.
