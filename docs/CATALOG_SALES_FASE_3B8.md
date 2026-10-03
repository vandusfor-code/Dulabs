# catalog_sales · Fase 3B.8 — Textos finales y comunicación con el cliente

> **Estado vigente:** este documento describe el cierre de ESA fase; frases como «sin commit», «sin aplicar» o `cierre_aceptacion_humana = false` eran ciertas entonces.
> Qué está aplicado hoy en producción y cómo se activa ASLC: [`CATALOG_SALES_FASE_3B9D.md`](CATALOG_SALES_FASE_3B9D.md).

Estado: implementada y verificada (sin commit, sin push, sin activar). **Ninguna migración ejecutada; ningún SQL contra producción.** Se escribió
UNA migración (sin aplicar) y su rollback, probados solo en un Postgres local efímero. ASLC sigue pausado, restringido a su número de prueba y con
`cierre_aceptacion_humana = false`; Patricia no se creó; el catálogo real no se cargó.

## Principio

La capa de comunicación es **configuración del negocio**, no código. El motor genérico no trae ningún texto comercial ni el nombre de ninguna
persona. Sin texto configurado el sistema NO inventa uno: no envía (decisiones) o usa el mensaje neutro que ya existía (derivaciones y errores). Un
texto nunca cambia el estado de un pedido, y el modelo nunca redacta ni elige textos.

## 1. Auditoría de textos existentes

| Clase | Texto | Dónde | Qué se hizo |
|---|---|---|---|
| **A. Definido por el cliente** | Aviso obligatorio ("⚠️ IMPORTANTE ANTES DE ENVIAR SU PEDIDO…") | `cierre.textos.aviso` (config del negocio); en el código NO existe | **Sin cambios.** 747 bytes, SHA-256 `c0bf58e0…175a`, fijado en 3B.4; el texto recibido en esta fase es idéntico byte a byte |
| A | Ejemplo "Perfecto 👍 Tu confirmación fue recibida. Patricia será…" | solo en pruebas | Es un ejemplo del dueño, no un texto aprobado: vive solo como valor de prueba; el real lo carga el negocio en 3B.9 |
| **B. Técnico existente** | `ACEPTACION_MESSAGES` (preguntas de datos, formatos, documento rechazado/no disponible, pregunta sin respuesta, "ya registrado", "no se pudo registrar") | `checkout.ts` (3B.4) | Sin cambios, salvo que `coverageHandoff` puede ser reemplazado por el texto del negocio |
| B | `FALLBACK_MESSAGES` (técnico, traspaso, seguridad, no verificado, pendiente), `CART_CLARIFY`, `realOrderStatus` | `runtime.ts` | Sin cambios (son el fallback seguro) |
| B | Notificaciones de estado del pedido (`mensajeNotificacion`: pago recibido, en preparación, enviado, entregado, completado, cancelado, rechazado) | `notificaciones.ts` (Bloque 31, estilo Delacour 💖) | Sin cambios de texto. **No se reutilizan para las decisiones de ASLC** (ver riesgos) |
| **C. Genérico reutilizable** | Traspaso neutro ("Te comunico con una asesora…"), mensaje técnico, `coverageHandoff`, `questionHandoff` | `FALLBACK_MESSAGES`, `ACEPTACION_MESSAGES` | Se siguen usando SOLO como fallback donde ya se usaban |
| **D. Sin definir** | Mensaje tras **aceptar**, **rechazar**, **cancelar** | no existía | Ahora configurable por negocio, sin texto por defecto |
| D | Envíos: **fuera de cobertura explícita**, **no verificable**, **error técnico** | no existía (el modelo redactaba el "no cubrimos" y el traspaso usaba el mensaje neutro) | Ahora configurable por negocio; sin texto rige lo de siempre |
| D | `handoff.texto`, `textos.ubicacion|confianza|agotado` (D13) | declarados en el esquema, **sin consumidor** | Siguen sin implementarse (los bloques `handoff_determinista` y `textos_fijos` continúan "no disponibles": configurarlos hace inválida la configuración) |

## 2. Textos modificados o creados

Creados (todos opcionales, en la configuración del negocio — `dulabs_agente_runtime_config.checkout_opciones`):

- `cierre.textos.aceptado` / `rechazado` / `cancelado` (≤500, sin espacios en los bordes). Marcadores cerrados: `{pedido}` y, **solo en rechazo y
  cancelación**, `{motivo}`. Cualquier otra llave es configuración inválida.
- `envios.textos.sin_cobertura` / `cobertura_no_verificable` / `error_consulta` (≤300, sin llaves).

Modificados en el código (comportamiento): ninguno de los textos existentes. Cambios de comportamiento, todos solo si el negocio configuró el texto:
el traspaso de envíos, la ciudad excluida y el error técnico usan el texto del negocio en vez del genérico (ver §5).

## 3. Qué quedó configurable (y su fallback)

| Texto | Campo | Sin configurar |
|---|---|---|
| Aviso obligatorio | `cierre.textos.aviso` (obligatorio, ya existía) | la configuración es inválida (no se inventa) |
| Respuesta al "sí" | `cierre.textos.tras_aviso_confirma` (obligatorio, ya existía) | la configuración es inválida |
| Tras aceptar / rechazar / cancelar | `cierre.textos.aceptado | rechazado | cancelado` | **no se envía nada** (la decisión sigue válida; la persona puede escribir desde el Inbox) |
| Fuera de cobertura (explícita) | `envios.textos.sin_cobertura` | como en 3B.6: lo dice el modelo, respaldado por el motor y el guardián |
| Cobertura / envío no verificable (traspaso) | `envios.textos.cobertura_no_verificable` | `FALLBACK_MESSAGES.handoff` (checkout: `coverageHandoff`) |
| Error técnico del traspaso de envíos | `envios.textos.error_consulta` | `FALLBACK_MESSAGES.technical` |

## 4. Qué quedó exactamente igual

- El aviso obligatorio (texto, emojis, saltos, puntuación): un test fija el SHA-256 y la prueba de 3B.4 conserva el mismo; el aviso no tiene copia en
  el código; el checkout lo envía como `cierre.textos.aviso` sin transformarlo; el esquema lo conserva.
- Todos los textos de las clases B y C, la respuesta al "sí" (3B.5: una vez, sin confirmar nada, silencio si una persona ya escribió) y el motor de
  envíos (3B.6: ninguna regla de cobertura, tiempos ni guardián cambió).
- Delacour: su configuración no trae ninguno de estos campos; ninguna ruta suya cambia.

## 5. Integración con 3B.6

Tres situaciones que no se mezclan (la decisión la toma `resolverEnvio`, no el modelo):

| Resultado del motor | Qué sale | Traspaso |
|---|---|---|
| `not_covered` (excluida explícitamente) | `sin_cobertura` del negocio, enviado por el backend tal cual (el modelo no redacta) | No (se sabe que no) |
| Cualquier otra duda (`unknown_city`, `coverage_unverified`, `inconsistent_location`, `rules_unavailable`, sin tiempo verificable) | `cobertura_no_verificable` | **Sí, lo decide el backend**: el modelo no puede evitarlo ni escribir sobre ese envío |
| No se pudo avisar a una persona | `error_consulta` | No (el siguiente fallo repetido sí traspasa) |

Un texto "no verificable" nunca afirma que no haya cobertura, y el de "sin cobertura" nunca se usa para una duda (hay pruebas para ambas direcciones).
Una afirmación de envío sin respaldo que persiste tras corregirla también termina en el traspaso con el texto del negocio. En el checkout, la ciudad sin
certeza usa `cobertura_no_verificable` (o `coverageHandoff`). Preguntas de envío durante el checkout sin respuesta verificable siguen usando el
mensaje genérico de la pregunta (`questionHandoff`/`questionFallback`): no se conectó un texto propio para ese caso.

## 6. Idempotencia

Mensajes tras una decisión humana: **una vez por (pedido, decisión)**, garantizado por la BD y no por la memoria del proceso.

- Candado: la tabla `dulabs_catalogo_pedido_notificaciones` (Bloque 31) ya tiene `unique (pedido_id, tipo)`; `reservar` inserta la fila antes de enviar y
  quien pierde la carrera recibe la existente (`repetida`) sin enviar. Los tipos son `aceptado`, `rechazado`, `cancelado`.
- Capa de decisión: el gancho solo se llama cuando la decisión se aplicó por primera vez (`result !== "duplicate"`); una decisión repetida, dos personas
  a la vez o un doble clic no vuelven a avisar. Si aceptar y rechazar compiten, solo sale el mensaje de la que ganó.
- Un proceso que se cae a mitad (fila en `enviando`) NO reenvía solo: se prefiere no mandar a mandar dos veces. El reintento genérico del módulo
  Pedidos se niega para estos mensajes (usaría la plantilla de siempre en vez del texto del negocio).
- El motivo queda congelado en el primer envío.

**Migración pendiente:** `supabase/migrations/20261208000000_dulabs_catalogo_pedido_notificaciones_aceptado.sql` amplía el CHECK de `tipo` con `aceptado`
(rechazado y cancelado ya existían). Rollback en `supabase/rollbacks/`. **No se aplicó.** Sin ella, el aviso de "aceptado" no puede registrarse: el código
lo trata como "no disponible" y no envía nada (rechazar y cancelar no dependen de ella). Probada solo en Postgres local efímero (base de migraciones +
3B.1 + esta, dos veces, prueba SQL en `supabase/tests/`, rollback que se niega si hay filas `aceptado`).

## 7. Aislamiento multi-tenant

- El texto sale de la configuración del negocio de la SESIÓN (`d.tenantId`) para el número del pedido; el número debe ser de ese negocio y tener
  token propio (si no, se omite). Nada que llegue en la petición (`tenant_id`, `texto`, `plantilla`) ni del modelo cambia el negocio o el texto.
- Los textos de envíos salen de la fila del número del turno. "Patricia" solo existe en la configuración de ASLC (ningún archivo de código la contiene;
  un test lo verifica).
- El modelo no tiene ninguna herramienta que escriba textos o configuración; las herramientas son estrictas y rechazan argumentos desconocidos.

## 8. Cómo y cuándo envía (producción)

`por-aceptar-produccion.ts` conecta el gancho `alDecidir` (3B.7) con `mensajes-decision.ts`. Envía solo si se cumplen TODAS: la decisión se aplicó por
primera vez; el pedido quedó realmente en ese estado; el negocio configuró el texto; el módulo `notificaciones_pedidos` está activo; el número es del
negocio y tiene token; la ventana de 24 h de WhatsApp está abierta; la plantilla se puede completar (si pide `{motivo}`, la persona lo escribió y no parece
contener un documento, teléfono o cuenta: 7 o más dígitos). Hoy ningún negocio lo cumple (el cierre con aceptación humana sigue apagado: nadie puede decidir
todavía), así que en producción no sale ningún mensaje. El panel le dice a la persona, antes de decidir, si habrá mensaje y si el motivo lo leerá el
cliente, y después, qué pasó con él (enviado, ventana cerrada, no se pudo confirmar…).

## Verificación

- Tests nuevos (89, registrados en `scripts/test-flow-manifest.txt`): `lib/agente/agente-textos-3b8.test.ts` (36: aviso idéntico, plantillas y esquema,
  textos de envíos en el runtime real —J, K, L, M, N—, modelo sin acceso a textos, código sin textos ni personas),
  `lib/catalogo/pedidos/mensajes-decision-b38.test.ts` (47: aceptar/rechazar/cancelar, faltas de configuración, aislamiento entre negocios, idempotencia,
  el mensaje no cambia el pedido, documento y motivo sensible, ventana de 24 h y fallos, respuesta al "sí" —B, C, D—) y 6 más en
  `components/dashboard/pedidos/por-aceptar.dom.test.tsx` (avisos del panel). Se ajustaron las pruebas de 3B.7 que fijaban la forma exacta de la respuesta de decisión
  (suma `mensaje_cliente`) y la ausencia de gancho en producción (ahora está conectado).
- 34 mutaciones (cada una rompe UNA garantía y la suite debe fallar; archivos restaurados con hash verificado), repetidas sobre el código final: negocio equivocado
  al leer el texto o el pedido, candado idempotente roto (capa de envío y almacén), envío sin comprobar el estado del pedido, datos del cliente en el texto, motivo
  sensible enviado, motivo reinterpretado, reintento genérico habilitado, texto de aceptación inventado, ventana de 24 h ignorada, gancho sin conectar, motivo
  perdido, aviso modificado al enviarlo / al guardarlo / duplicado en el código, traspaso evitable, afirmación sin respaldo sin traspaso, texto de "no verificable"
  ignorado o mezclado con "sin cobertura", ciudad excluida sin su texto, error técnico con el texto equivocado, checkout sin el texto del negocio, respuesta al "sí"
  tras intervención humana (con certeza y sin ella), dos "sí" con dos respuestas, texto fijo en el código, esquema sin validar marcadores o con llaves, cierre
  encendido y dos de la interfaz. Se comprobó además que las mutantes caen por el test previsto y no por un error de sintaxis.
- SQL: la migración, su prueba y su rollback corren en un Postgres local efímero (pglite; base de migraciones + 3B.1 + esta, dos veces): CHECK con `aceptado`,
  clave única intacta, un solo CHECK de tipo, rollback que se niega con filas `aceptado`. Nunca contra producción.
- Regresión: `tsc --noEmit` y `eslint --max-warnings=0` limpios; `npm run test:flow`: 6606 tests, 6605 OK y 1 fallo (B30, preexistente: regex con
  `\n` sobre `app/webhook-dulabs/route.ts` contra CRLF de Windows; falla igual en la base 7207d79; no se tocó); 3B.4, 3B.5 (79), 3B.6 (51), 3B.7 (50 + 14 + 12 + 43),
  Bloque 31 (notificaciones), perfil, aceptación y fase7 en verde; evaluaciones de Delacour (cooperativo y adversario) idénticas a la línea base salvo el token
  aleatorio de MD05.

## Riesgos y decisiones a revisar

- **Notificaciones del Bloque 31 para ASLC:** si en 3B.9 se activa `notificaciones_pedidos` para ASLC, las etapas posteriores (en preparación, enviado,
  entregado…) saldrían con las plantillas de Delacour (con 💖). Aprobar o configurar esos textos antes de activar el módulo.
- **Ventana de 24 h:** si la decisión ocurre más de 24 h después del último mensaje del cliente, el mensaje no sale (queda `ventana_vencida`); enviar
  fuera de la ventana requiere una plantilla aprobada por Meta (no implementado).
- **`{motivo}` lo lee el cliente:** el motivo lo escribe una persona del equipo; una plantilla que lo incluya lo envía tal cual (salvo el filtro de 7+
  dígitos). El panel lo advierte, pero la redacción del motivo sigue siendo humana.
- **Migración sin aplicar** (`aceptado`): hasta aplicarla, ese aviso no se envía.
- **`handoff.texto` y `textos.*` (D13)** siguen sin consumidor.

## Para 3B.9 (no implementado aquí)

Textos reales del negocio (aviso, respuesta al "sí", aceptado/rechazado/cancelado, tres textos de envíos), aplicar la migración `20261208`, habilitar los
módulos (`pedidos`, `pedidos_por_aceptar`, y `notificaciones_pedidos` si se quiere el mensaje), crear a la persona responsable, catálogo y reglas de envío
reales, `cierre_aceptacion_humana = true` y la activación.
