# AMORE — Reservas solo por enlace y «Mi cita»

Rama `feat/amore-reservas-por-enlace`. Negocio: AMORE (`ed6ae77f-8a0c-483e-a5d9-8ede68eca50f`), canal WhatsApp-QR, Google Calendar vía Nylas,
portal `https://www.dulabs.co/reservar/amore`.

> **Estado de producción al escribir esto: NADA de esto está aplicado ni desplegado.** La migración `20261209000000_dulabs_cita_enlaces.sql` y los scripts
> de `supabase/provisioning/amore/` los corre el dueño. El bot **no** se reactivó para tráfico general. Ver §13 y §15.

## 1. Qué estaba mal

Hallazgos con causa raíz (no parches):

1. **El portal `/reservar/amore` no usaba el motor real de agenda.** Creaba la cita con el motor genérico: no revalidaba contra Google Calendar ni creaba el
   evento, así que una hora ocupada en Google (pero libre para DuLabs) se podía reservar dos veces. La disponibilidad que mostraba tampoco era la real.
2. **Las citas del portal eran invisibles para el bot.** Quedaban con el `phone_number_id` legacy de Meta («pendiente-amore-…») y el teléfono tal como lo
   escribió la clienta («314 812 7388»). El chat busca por `whatsapp-qr:<negocio>` y el teléfono normalizado (`573148127388`): al pedir «cancelar mi cita» o
   «cambiar mi cita» el bot decía que no había citas.
3. **El «código» de confirmación del portal era el id de la cita en base 36** (reversible: revelaba cuántas citas hay y permitía enumerarlas).
4. **El chat reservaba citas nuevas** (servicio → profesional → día → hora → confirmar), contra la nueva regla del negocio.
5. **Cancelar desde el panel de la profesional dejaba el evento de Google Calendar huérfano**, y ese evento seguía bloqueando el horario.
6. **No existía una forma segura de gestionar la cita desde un enlace** (ni la confirmación ni los recordatorios traían uno).

## 2. Qué pidió la clienta

- Las citas **nuevas solo por el enlace** de reserva; el bot no inicia el flujo de reserva por chat.
- **Cancelar, modificar/reprogramar y consultar** siguen funcionando **por chat y también por un enlace personal «Mi cita»**.
- La confirmación (servicio, profesional, fecha, hora) y los recordatorios llevan el enlace personal con el texto
  «Si necesitas modificar o cancelar tu cita, puedes hacerlo desde este enlace».
- El bot sigue contestando preguntas informativas (p. ej. «¿Cristal trabaja los sábados?») y pasa a una persona cuando se lo piden.
- Mensajes naturales, en el tono de AMORE.

## 3. Qué cambié

| Pieza | Archivos |
|---|---|
| Enlace personal (token, hash, cifrado, vigencia, revocación) | `lib/mi-cita/enlaces.ts`, migración `20261209000000_dulabs_cita_enlaces.sql` (+ rollback + test SQL) |
| Gestión (ver, cancelar, horarios, reprogramar) | `lib/mi-cita/gestion.ts`, `lib/mi-cita/rutas.ts`, `app/api/mi-cita/[token]/{,cancelar,horarios,reprogramar}/route.ts` |
| Página «Mi cita» | `app/mi-cita/[token]/page.tsx`, `components/mi-cita/MiCitaAmore.tsx` |
| Reserva del portal sobre el motor real (Nylas) | `lib/mi-cita/reserva-portal.ts`, `app/api/reservar/[tenant]/route.ts`, `…/disponibilidad/route.ts` (solo la rama de AMORE) |
| Pantalla de éxito del portal con «Ver o modificar mi cita» | `components/reservar-amore/PasoExitoAmore.tsx`, `app/reservar/amore/page.tsx` |
| Confirmación y recordatorio con el enlace | `lib/reserva-notificaciones-whatsapp.ts`, `lib/amore-recordatorio-citas.ts`, `app/api/cron/recordatorios-citas/route.ts` |
| Chat de WhatsApp | `lib/agenda-v2/router.ts` (desvío al enlace en el único punto de entrada de la reserva nueva), `lib/amore-entrada-router.ts`, `lib/amore-entrada-gemini.ts`, `lib/mi-cita/chat.ts`, `lib/mi-cita/mensajes.ts` |
| Cancelar desde el panel libera el evento de Google | `app/api/agenda/[token]/citas/[id]/route.ts` (solo la acción «cancelar» y solo AMORE) |
| Límite de tasa | `lib/rate-limit.ts` (categoría `miCita`: 60/min por enlace) |
| Infraestructura de pruebas (aditiva) | `lib/test-helpers/supabase-en-memoria.ts` (restricciones tipo Postgres opcionales), `lib/mi-cita/testing/mundo-amore.ts` |
| Producción (los corre el dueño) | `supabase/provisioning/amore/01_diagnostico_citas_solo_lectura.sql`, `02_reparar_identidad_citas_portal.sql`, `PENDING_MIGRATIONS.md` |

## 4. Qué NO cambié

- No borré el motor antiguo de agenda, ni Nylas, ni la cancelación, ni la reprogramación: el flujo guiado antiguo sigue en el código (la reprogramación por
  chat reutiliza sus pasos) pero **no se puede iniciar para AMORE** (`permitirReservaPorChat` existe solo para las pruebas y nunca se activa en producción).
- No hay una segunda fuente de verdad ni una agenda paralela: las citas siguen en `dulabs_citas_especialista`, el evento en Google Calendar vía Nylas y su
  mapeo en `dulabs_agenda_v2_citas_nylas`.
- No toqué Delacour, ASLC ni ningún otro negocio (ramas con compuerta por `AMORE_TENANT_ID`; hay pruebas que lo demuestran), ni DNS, ni infraestructura, ni
  credenciales nuevas, ni la activación del bot.
- ~~El panel de edición/«reagendar» de la profesional no se modificó~~ — **corregido en el PR de seguimiento «panel ↔ Google»** (ver §14).

## 5. Cómo funciona la nueva reserva

1. La clienta pide una cita por WhatsApp → recibe **un solo mensaje** con el enlace del portal (no se le pregunta servicio, profesional, día ni hora; no se
   consulta disponibilidad ni se toca Nylas).
2. En el portal elige servicio, profesional y horario con la **disponibilidad real** (jornada + bloqueos + citas + Google Calendar).
3. Al confirmar, `reservarPorPortalAmore` revalida contra Google Calendar, crea la cita (restricción EXCLUDE de Postgres contra solapes) y su evento, guarda la
   clienta con la **misma identidad que el chat** (`whatsapp-qr:<negocio>` + teléfono normalizado), emite el enlace personal y envía la confirmación por
   WhatsApp con el enlace. **Falla cerrado**: sin Google Calendar confirmado no se reserva a ciegas (503).
4. Es idempotente: un doble clic o un reintento de red devuelve lo mismo sin crear otra cita, otro evento ni otro WhatsApp.
5. Si el profesional exige aprobación la cita queda `pendiente` y **no** se le dice «confirmada».

## 6. Cómo funciona modificar y cancelar

- **Por el enlace «Mi cita»** (`/mi-cita/<token>`): ver la cita, cancelarla (con confirmación), o elegir otro día/horario de la **misma profesional** y con la
  misma duración (horizonte 30 días). Reprogramar revalida contra Google Calendar y hace el UPDATE atómico (`actualizarCitaConNylas`): la misma cita (mismo
  id), el evento viejo se borra y se crea el nuevo, el enlace se extiende y se avisa por WhatsApp con el nuevo horario. Cancelar borra el evento de Google y
  avisa. Ambas son idempotentes.
- **Por el chat**: «quiero cancelar mi cita», «quiero cambiar mi cita» y consultar siguen igual; los mensajes del bot además ofrecen el enlace personal.
  Si la clienta no tiene citas a ese número, el bot lo dice y ofrece el enlace de reserva.
- **Desde el panel**: cancelar ahora también borra el evento de Google (mejor esfuerzo; nunca deshace la cancelación).

## 7. Cómo funciona «Mi cita» y su seguridad

- Token = 32 bytes aleatorios (43 caracteres base64url). En la base solo se guarda el **hash sha256** (único) y una **copia cifrada AES-256-GCM** (para reenviar
  el MISMO enlace en los recordatorios). Un enlace por cita; vence 14 días después del fin de la cita y se puede revocar.
- El id de la cita **nunca** viene del cliente: se deduce del token en el servidor. La respuesta no trae ids internos, teléfono ni nombre de la clienta.
- Un token mal formado se rechaza **sin tocar la base**; manipulado, inexistente, revocado o vencido responde **igual** (sin pistas). Un enlace de otro negocio
  o cuya cita pertenece a otro negocio no abre nada (tres capas independientes).
- Respuestas con `Cache-Control: no-store`, `Referrer-Policy: no-referrer` y `X-Robots-Tag: noindex, nofollow`; límite de 60 solicitudes por minuto por enlace.
- RLS activo y sin políticas en `dulabs_cita_enlaces` (solo `service_role`).
- Si falla algo del enlace (p. ej. migración sin aplicar) **la reserva y la cancelación siguen funcionando**; solo se omite el texto del enlace.

## 8. Confirmaciones y recordatorios

- Confirmación: servicio, profesional, fecha/hora + «Si necesitas modificar o cancelar tu cita, puedes hacerlo desde este enlace: <url>» antes de «¡Gracias por elegirnos!».
  Sin enlace (otros negocios, o si no se pudo emitir) el texto es exactamente el de siempre.
- Recordatorio: se reutiliza la plantilla existente y se agrega el mismo enlace (si la plantilla del negocio ya lo trae no se repite). Una cita creada antes de
  esta función recibe su enlace al recordarle. Si el enlace no se puede obtener el recordatorio sale igual, sin la línea: nunca se retrasa ni se pierde.

## 9. Pruebas

| Verificación | Resultado |
|---|---|
| `npx tsc --noEmit -p .` | sin errores |
| `eslint --max-warnings=0` sobre los 35 archivos TypeScript tocados o nuevos | sin errores ni avisos |
| `npm run test:flow` (suite completa) | **6881 pruebas, 6881 pasan, 0 fallan** (las que exigen `SUPABASE_URL` real se omiten a propósito: ninguna prueba toca producción) |
| Pruebas nuevas | `lib/mi-cita/enlaces.test.ts` (15), `lib/mi-cita/reserva-portal.test.ts` (25), `lib/mi-cita/mi-cita.test.ts` (34), `app/api/reservar/portal-amore-rutas.test.ts` (4) |
| Pruebas del chat | `amore-conversacion-matriz.test.ts` bloque J (11 casos de producción) y `agenda-v2/router.test.ts` («AMORE: la cita nueva va por el enlace», 6 casos); se actualizaron las expectativas del flujo antiguo en `disponibilidad-cadena-real`, `amore-entrada-router` y `amore-entrada-gemini` |
| Mutaciones | 35 mutaciones (cada una rompe UNA garantía: fail-closed, identidad del chat, token de 16 bytes, revocación, vencimiento, cifrado, aislamiento por negocio —las tres capas—, borrado del evento, idempotencia, cabeceras, desvío del chat, compuertas de AMORE, panel…): **35/35 detectadas**, archivos restaurados con verificación de hash. Dos sobrevivieron en la primera pasada (guardia de «hora pasada» y rama de disponibilidad de AMORE) y se endurecieron sus pruebas |
| SQL de la migración | PGlite: aplica, es idempotente, el test SQL pasa, el rollback se niega con enlaces activos y borra la tabla si están revocados sin tocar las citas |
| SQL de reparación | PGlite con 9 citas de prueba (legacy, correcta, pasada, cancelada, de otro negocio, teléfono sin 57, ininterpretable, sin teléfono, con formato): repara exactamente las 5 afectadas, deja intactas las otras 4, es idempotente y la reversa devuelve el estado anterior (15 comprobaciones). Esa prueba detectó y corrigió un defecto de idempotencia con teléfonos ininterpretables |
| Interfaz «Mi cita» | verificada en el navegador integrado (móvil 375 px) con `fetch` simulado: estados cargando, enlace inválido, ver, elegir horario, confirmar cancelación, cancelada y reprogramada |
| `npm run build` (guard de release + `next build`) | compila sin errores; aparecen `/mi-cita/[token]` y las 4 rutas `/api/mi-cita/[token]/…` |

Las pruebas funcionales de punta a punta usan **el código real** (revalidación contra Google Calendar, UPDATE atómico, borrado del evento, avisos) sobre una base en memoria con las reglas
de Postgres que importan (EXCLUDE de solapes, unicidad de idempotencia) y un Google Calendar falso con estado. No usan Nylas, WhatsApp ni Supabase reales.

## 10. Los 18 casos funcionales pedidos → dónde se prueban

| # | Caso | Prueba |
|---|---|---|
| 1 | Crear una cita desde el portal | `reserva-portal.test.ts` §1 |
| 2 | La confirmación trae el enlace | `reserva-portal.test.ts` §1 y §7 |
| 3 | Abrir el enlace | `mi-cita.test.ts` §1 |
| 4 | Ver la cita correcta | `mi-cita.test.ts` §1 |
| 5 | Reprogramar | `mi-cita.test.ts` §5 |
| 6 | Verificar el cambio real en la agenda | `mi-cita.test.ts` §5 (base + Google Calendar falso con estado) |
| 7 | Cancelar | `mi-cita.test.ts` §3 |
| 8 | Verificar la cancelación real | `mi-cita.test.ts` §3 y §7 |
| 9 | El recordatorio trae el enlace | `reserva-portal.test.ts` §8 |
| 10 | WhatsApp «quiero una cita» → enlace | `amore-conversacion-matriz.test.ts` J1–J4, `agenda-v2/router.test.ts` |
| 11 | WhatsApp «quiero cancelar mi cita» → funciona | matriz J7 |
| 12 | WhatsApp «quiero cambiar mi cita» → funciona | matriz J8 |
| 13 | Pregunta informativa → respuesta normal | matriz J5 |
| 14 | «Hablar con una persona» → transferencia | matriz J11 |
| 15 | El enlace de otra cita falla | `mi-cita.test.ts` §2 |
| 16 | Token manipulado falla | `mi-cita.test.ts` §2 |
| 17 | Otro negocio falla | `mi-cita.test.ts` §2 |
| 18 | Otros negocios no cambian | `portal-amore-rutas.test.ts`, matriz, `router.test.ts` |

## 11. Riesgos pendientes (honestos)

1. **No se probó contra Google Calendar, Nylas ni WhatsApp reales.** Las pruebas usan una base en memoria con las reglas de Postgres que importan y un Google
   Calendar falso con estado. La verificación real es una prueba controlada del dueño (§13, paso 6).
2. ~~Editar/reagendar desde el panel no mueve el evento de Google~~ — **resuelto** en el PR de seguimiento (§14).
3. Reprogramar a un horario que se solapa con el horario actual de la propia cita se rechaza como «ocupado» (falla segura; la clienta elige otro).
4. Las citas que creó el portal antiguo **no tienen evento en Google Calendar** (no bloquean el calendario de la profesional). El script 02 corrige su identidad
   para que el bot las encuentre, pero no crea los eventos.
5. No hay política de «aviso mínimo» para cancelar o reprogramar (la clienta puede hacerlo hasta que empiece la cita).
6. Los enlaces usan la constante `https://www.dulabs.co` (no `NEXT_PUBLIC_SITE_URL`).
7. Sin la migración 20261209 la reserva funciona pero **no hay enlace** (confirmación y recordatorios saldrían sin él): aplicar la migración **antes** de reactivar.
8. No se agregó aviso a la profesional cuando la clienta cancela o cambia por el enlace (el chat tampoco lo hace hoy).

## 12. Qué NO se verificó en producción

Lectura y escritura en producción no se hicieron desde esta sesión (la herramienta no lo permitió y la regla del proyecto exige OK del dueño). Por eso no se puede
afirmar cuántas citas futuras tienen identidad legacy: eso lo responde el diagnóstico 01.

## 13. Runbook de producción (lo hace el dueño, en este orden)

1. Revisar y fusionar el PR (no se fusionó nada).
2. Esperar el despliegue en Vercel.
3. SQL Editor → correr `supabase/migrations/20261209000000_dulabs_cita_enlaces.sql` y la verificación de `PENDING_MIGRATIONS.md` (esperado `true | true`).
4. SQL Editor → `supabase/provisioning/amore/01_diagnostico_citas_solo_lectura.sql` (solo lectura). Si `invisibles_para_el_chat` > 0, guardar el resultado y correr
   `02_reparar_identidad_citas_portal.sql` (devuelve los valores anteriores: sirven para revertir).
5. Confirmar que en Vercel existen `TOKEN_ENCRYPTION_KEY`, `NYLAS_API_KEY` y `NYLAS_GRANT_ID_AMORE` (ya los usa el chat; no se agregó ninguna credencial nueva).
6. **Prueba controlada** con un número propio: reservar por el portal → ver la confirmación con el enlace → abrir «Mi cita» → reprogramar y verificar en Google Calendar →
   cancelar y verificar que el evento desaparece → escribir «quiero una cita» / «quiero cancelar mi cita» al bot.
7. Solo entonces decidir si se reactiva el bot para tráfico general.

Reversa: el rollback de la migración (`supabase/rollbacks/20261209000000_dulabs_cita_enlaces.down.sql`) se niega a borrar si hay enlaces activos; revertir el PR vuelve al
comportamiento anterior (con las citas del portal antiguo otra vez invisibles para el bot).

## 14. Seguimiento: el panel de la profesional y Google Calendar (PR «panel ↔ Google»)

El panel solo cambiaba la base. Ahora, para AMORE, cada acción deja Google Calendar igual que la agenda (\`lib/mi-cita/panel.ts\`; las rutas del panel solo hacen de puente y los demás negocios siguen exactamente igual):

| Acción del panel | Qué pasa ahora (solo AMORE) |
|---|---|
| **Editar** una cita confirmada (hora, duración, profesional) | Se crea el evento nuevo (en el calendario de la profesional de destino) → se cambia la base → se borra el viejo (del calendario de la profesional anterior) y el mapeo apunta al nuevo. **Si Google no responde no se cambia nada** (503 con un mensaje claro); si la base rechaza el cambio (choque de horario) el evento nuevo se deshace. No se revalida contra lo ocupado en Google: es una decisión de la administradora (como antes). El enlace «Mi cita» se extiende si la cita se mueve lejos. |
| **Proponer otro horario** a una solicitud pendiente | Igual que editar: el evento acompaña al horario retenido. |
| **Rechazar** una solicitud | Se borra el evento de Google (antes seguía bloqueando ese horario). |
| **Cancelar** | Se borra el evento de Google (ya estaba en el PR anterior; ahora vive en el mismo módulo). |
| **Confirmar** una pendiente | La clienta recibe la confirmación por WhatsApp-QR **con su enlace «Mi cita»**. El aviso antiguo de este panel usa la API de Meta, que AMORE no tiene, así que nunca le llegaba nada; además su texto es la política de otro negocio. |
| **Nueva cita** a mano | Teléfono **normalizado** (antes se guardaba tal cual: el bot no encontraba esa cita ni a la clienta), clienta conocida con la identidad del chat, y confirmación con el enlace. Un teléfono que no se pueda interpretar se conserva como lo escribieron y no recibe avisos. |

Hallazgos que cerró este seguimiento: (1) las citas creadas a mano desde el panel tampoco eran visibles para el bot por el teléfono sin normalizar; (2) su confirmación no llevaba el enlace; (3) confirmar una pendiente no le avisaba a la clienta.

**Sigue sin cubrirse (decisión del negocio, no se inventó texto):** avisar a la clienta cuando el SALÓN cancela, rechaza o edita su cita desde el panel (los avisos antiguos usan la API de Meta y tampoco le llegan a AMORE); la propuesta de horario no tiene camino de respuesta por WhatsApp-QR (la clienta no puede «aceptarla» por el bot).

Pruebas: \`lib/mi-cita/panel.test.ts\` (27) y 21 mutaciones del módulo y sus rutas, todas detectadas. El Google Calendar falso ahora también rechaza borrar un evento desde un calendario que no es el suyo, como el real.

## 15. Estado de producción

Sin cambios aplicados. Pendientes del dueño: fusionar el PR, migración 20261209, diagnóstico/reparación de citas legacy y la prueba controlada. El bot de AMORE no se
reactivó para tráfico general.
