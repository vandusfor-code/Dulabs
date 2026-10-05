# catalog_sales · Fase 3B.9E — el cliente se entera de la decisión, la responsable se entera del pedido, y el traspaso nunca queda a medias

Rama `feat/aslc-flujo-completo` (apilada sobre `feat/aslc-configuracion-cliente`, PR #163). Sin migraciones. **Nada de esto se ejecutó en producción**: los dos SQL nuevos
(`12` y `13`) los corre el dueño, igual que los anteriores.

## Qué faltaba para que el recorrido de Aquí Sí Lo Compras (ASLC) funcionara de punta a punta

```
cliente escribe → agente (Gemini) → catálogo / precio / envío → checkout → aviso obligatorio → "sí"
   → pedido PENDIENTE DE ACEPTACIÓN, conversación asignada a la responsable, IA en silencio
   → la responsable acepta / rechaza / cancela en Pedidos → Por aceptar
   → ❌ el cliente no recibía NADA            → ahora recibe un mensaje (módulo propio)
   → ❌ la responsable solo se enteraba mirando el panel → ahora además recibe un correo (opcional)
```

Además había un bug de runtime: si el modelo pasaba el chat a una persona (`handoff_to_human`) y el texto final fallaba, el cliente recibía el mensaje técnico
(«¿me lo escribes de nuevo?»), aunque el chat ya estaba con una persona.

## 1. Mensajes al cliente tras la decisión (módulo `avisos_decision_pedidos`)

**Problema de diseño que se resolvió.** Los mensajes de aceptado / rechazado / cancelado (Fase 3B.8) solo salen si el negocio tiene encendido `notificaciones_pedidos`, pero
ese módulo enciende TAMBIÉN los avisos genéricos de cada etapa (pago recibido, en preparación, enviado, entregado, completado), que usan plantillas de la plataforma con el
tono y los emojis de otro negocio (💖). Por eso ASLC no podía tenerlo. Ahora hay un módulo aparte:

| Módulo | Qué enciende |
|---|---|
| `notificaciones_pedidos` (de siempre) | avisos genéricos de cada etapa del pedido **y**, si el negocio tiene el texto, los de decisión (compatibilidad) |
| `avisos_decision_pedidos` (nuevo) | **solo** el mensaje tras aceptar / rechazar / cancelar, con el texto que configuró el propio negocio |

- La consulta es por negocio de la sesión; una falla de la base = apagado (nunca se envía por no poder verificar). Una sola vez por pedido y decisión (clave única en la base), solo
  dentro de la ventana de 24 h de WhatsApp, con el número y el token de ASLC. No cambia el estado de ningún pedido.
- Delacour no cambia: sigue con `notificaciones_pedidos` y sus plantillas (prueba incluida). Las rutas de gestión del panel siguen usando solo el módulo de siempre.
- Los scripts `05` / `06` / `10` siguen exigiendo `notificaciones_pedidos` **apagado** para ASLC (el módulo nuevo no lo reemplaza ni lo enciende).

**Textos propuestos por DuLabs (no son del negocio; léelos antes de correr el `12`):**

| Decisión | Texto |
|---|---|
| Aceptado | ¡Buenas noticias! 🎉 Tu pedido {pedido} fue aceptado. Recuerda que el pago es contraentrega: ten el dinero disponible cuando lo recibas. Si tienes alguna duda, escríbenos por este mismo chat. |
| Rechazado | Hola 👋 Lamentamos informarte que tu pedido {pedido} no pudo ser aceptado. Si tienes alguna duda, escríbenos por este mismo chat y te ayudamos. |
| Cancelado | Hola 👋 Tu pedido {pedido} fue cancelado. Si tienes alguna duda, escríbenos por este mismo chat y te ayudamos. |

Criterios: solo el marcador `{pedido}` (número público); **sin `{motivo}`** (lo escribe el equipo para el equipo y, si faltara, el mensaje no saldría); sin nombres de personas, fechas,
despacho, stock ni alternativas prometidas; solo repiten lo que el negocio ya dijo (pago contraentrega y «tener la disponibilidad del dinero»). Si el negocio aprueba otros, se escriben en
`supabase/provisioning/aslc/textos-aprobados.json` (`aceptado` / `rechazado` / `cancelado`) y se regenera (`npx tsx scripts/generar-aprovisionamiento-aslc.ts`); lo aprobado tiene prioridad.

**Límite conocido:** si la responsable decide pasadas 24 h desde el último mensaje del cliente, WhatsApp no permite texto libre: el estado del mensaje queda `ventana_vencida` y se
escribe a mano (no hay plantilla de Meta aprobada).

## 2. Correo a la responsable cuando hay un pedido por aceptar (canal `correo`)

El enrutador de aceptación ya aceptaba `canales: ["panel", "correo", "whatsapp"]` en la configuración, pero solo existía el panel. Ahora el canal `correo` existe:
usa el proveedor de correo que ya está en producción (Resend; `RESEND_API_KEY` existe en Vercel Production), manda **solo el número público del pedido y el enlace a Pedidos → Por aceptar**
(ningún dato del cliente), y un fallo del correo nunca deshace nada ni impide el panel. Remitente: `PEDIDOS_EMAIL_FROM` si existe; si no, el mismo que ya usan los demás correos.
Solo corre si el negocio lo configuró (`cierre.responsable.canales` incluye `correo`): hasta correr el `13`, nadie recibe nada.

## 3. Traspaso a una persona que no se rompe

Si `handoff_to_human` salió bien (la conversación ya está con una persona) pero el texto final del modelo falla o no se puede respaldar, el cliente recibe el **mensaje fijo de traspaso**
(no el técnico), y ese fallo ya no cuenta como falla del asistente. Sin traspaso, un fallo técnico sigue siendo técnico (sin cambios).

## SQL nuevos (los corre el dueño; probados en un Postgres local con datos ficticios)

| Script | Qué hace | Se niega si… |
|---|---|---|
| `12_avisos_de_decision.sql` | guarda los tres textos en `checkout_opciones.cierre.textos` y enciende **solo** el módulo `avisos_decision_pedidos` de ASLC | la fila no tiene la configuración completa, el aviso guardado no es el aprobado, o `notificaciones_pedidos` está encendido |
| `13_aviso_por_correo.sql` | cambia **solo** `cierre.responsable.canales` a `["panel","correo"]` | la responsable no está activa, no es admin/agente o **no tiene correo válido** (sin correo la configuración quedaría inválida y el agente callaría) |

Ambos: una sola sentencia atómica, repetible, con reversa en el encabezado, sin tocar pausa, restricción, `habilitado`, aviso ni otros negocios. El `03` de hoy ya trae los tres textos
(una instalación nueva queda igual que una con `03` + `12`).

## Qué NO se hizo, y por qué

- **Seguimiento cada 2 horas a clientes que no responden.** No es solo código: todos los crons de `vercel.json` son diarios, así que una cadencia de 2 h necesita un plan de Vercel que la permita o QStash
  (infraestructura y claves nuevas), y además es una decisión comercial que no está definida: cuántos recordatorios, en qué horario, con qué texto, cuándo parar
  y qué hacer pasadas las 24 h de WhatsApp (ahí hace falta plantilla aprobada por Meta). Enviar mensajes no solicitados a clientes reales no se deja a medio definir.
- **Aviso por WhatsApp a la responsable.** Sin plantilla de Meta aprobada no se puede escribir fuera de la ventana de 24 h; el correo cubre el aviso.
- **Candado de envíos que entienda negaciones / acepte el texto exacto del motor.** No hace falta hoy: los textos de envío ya pasan el candado (una prueba recorre 7 días × 7 horas × 6 ciudades).
  Cambiarlo es tocar una barrera de seguridad; se deja para cuando haga falta.
- **Cosas del cliente** (no inventables): usuario real de Patricia Castro, fotos de DL-000009 a DL-000012, stock real, confirmar la línea de WhatsApp (…8509 conectada vs …5088 informada),
  aprobar los textos propuestos.

## Pruebas

- `lib/catalogo/pedidos/avisos-decision-modulo.test.ts` (10): módulo y su consulta (por negocio, fail-closed), ASLC recibe su mensaje y NINGÚN aviso genérico, Delacour sin cambios, cableado.
- `lib/agente/aviso-responsable-correo.test.ts` (9): contenido sin datos del cliente, destinos inválidos, proveedor caído, remitente, cableado.
- `lib/agente/activacion-aslc.test.ts` (+8): textos, prioridad de lo aprobado, SQL `12` y `13` (solo lo previsto, guardas, atómicos).
- `lib/agente/agente-aceptacion-humana.test.ts` (+1): con la configuración REAL de ASLC, aceptar / rechazar / cancelar escriben el texto de ASLC, sin el motivo, una sola vez.
- `lib/agente/agente-runtime.test.ts` (+1): traspaso exitoso con texto final caído.
- Postgres local efímero (pglite): `12` sobre la fila de antes deja EXACTAMENTE lo que carga el `03` de hoy; guardas; `13`; Delacour idéntico.
- 17 mutaciones (cada una rompe una garantía; todas detectadas; archivos restaurados con hash verificado).

## Orden para ponerlo en marcha

1. Fusionar PR #163 y luego este PR (el despliegue a Vercel es automático). Sin los SQL, el comportamiento de ASLC no cambia salvo el arreglo del traspaso.
2. Correr `12_avisos_de_decision.sql` (lee los textos antes).
3. Cuando exista el usuario real de Patricia: `09_cambiar_responsable.sql` con su id y luego `13_aviso_por_correo.sql` (exige que tenga correo).
4. Fotos y stock reales de los productos; confirmar la línea; QA desde …7388 (aceptar, rechazar, cancelar y ver el mensaje en el chat y el correo); y solo entonces `06_abrir_al_publico.sql`.
