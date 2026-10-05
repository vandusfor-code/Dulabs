# catalog_sales · Fase 3B.9F — el cliente se entera cuando su pedido avanza de etapa (en preparación, enviado, entregado)

Rama `feat/aslc-avisos-de-etapa`. Sin migraciones. **Nada de esto se ejecutó en producción**: el SQL nuevo (`14`) lo corre el dueño, igual que los anteriores, y solo
**después** de desplegar el código de esta fase.

## 1. Qué pasó (hallazgo del 2026-10-05)

Una persona del equipo de Aquí Sí Lo Compras (ASLC) hizo un pedido de prueba, lo aceptó y lo marcó «en preparación» y luego «enviado», con la ventana de 24 h de WhatsApp
abierta. **El cliente no recibió nada.** Lo que sí funcionó: el aviso de «aceptado» (módulo `avisos_decision_pedidos`, Fase 3B.9E).

Causa: los avisos de cada etapa del pedido dependían SOLO del módulo `notificaciones_pedidos`, que manda plantillas de la **plataforma** (con el tono y los emojis de otro negocio,
💖) y por eso está apagado a propósito para ASLC. Sin el módulo, el panel aplicaba el cambio de etapa y el notificador respondía «desactivada» en silencio (el panel no muestra nada
para ese estado). No era un fallo de WhatsApp, de la ventana de 24 h ni del pedido.

## 2. Qué cambia

```
una persona marca la etapa en Pedidos (el estado YA cambió, por las operaciones de siempre)
  → módulos del negocio: avisos_etapa_pedidos (solo estas 3 etapas, con SU texto) y/o notificaciones_pedidos (plantillas de la plataforma)
  → avisos-etapa.ts decide el texto:  del negocio | de la plataforma | ninguno
  → lo de siempre (notificaciones.ts): candado idempotente por (pedido, etapa), ventana de 24 h, número y token del negocio, resultado registrado, reintento
```

| Módulo | Qué enciende |
|---|---|
| `notificaciones_pedidos` (de siempre) | plantillas de la plataforma en cada etapa; si el negocio tiene además `avisos_etapa_pedidos` y texto para esa etapa, gana el del negocio |
| `avisos_decision_pedidos` (3B.9E) | solo el mensaje tras aceptar / rechazar / cancelar un pedido pendiente de aceptación |
| `avisos_etapa_pedidos` (**nuevo**) | solo el aviso de **en preparación / enviado / entregado**, con el texto del propio negocio |

### El texto es del negocio (configuración), no del código

`checkout_opciones.cierre.textos` admite tres claves opcionales nuevas: `en_preparacion`, `enviado`, `entregado`. Mismas reglas que los textos de decisión: se envían **tal cual**,
solo admiten el marcador cerrado `{pedido}` (el número público del pedido; ni datos del cliente ni un motivo), hasta 500 caracteres y sin espacios en los bordes. Sin la clave, **no se
envía nada** para esa etapa. El esquema sigue siendo estricto (una clave desconocida invalida la configuración), y la configuración de producción de antes (sin estas claves) sigue
siendo válida: por eso el código se despliega primero.

### Matriz de decisión (la única función que decide: `lib/catalogo/pedidos/avisos-etapa.ts`)

| `avisos_etapa_pedidos` | `notificaciones_pedidos` | Etapa | Texto configurado | Sale |
|---|---|---|---|---|
| sí | no | en preparación / enviado / entregado | sí | **el del negocio** |
| sí | no | en preparación / enviado / entregado | no (o config. inválida / agente apagado) | nada |
| sí | no | pago recibido, completado, cancelado, rechazado | — | nada (cancelado y rechazado tienen su mensaje de decisión) |
| sí | sí | etapa con texto del negocio | sí | el del negocio |
| sí | sí | cualquier otra | — | la plantilla de la plataforma (como siempre) |
| no | sí (Delacour) | cualquiera | — | la plantilla de la plataforma — **sin leer ninguna configuración**: su camino no cambió |
| no | no | cualquiera | — | nada |

Cuando no sale nada, no se crea fila ni se llama a Meta. Si se **puede** enviar pero falla algo (ventana de 24 h vencida, error de Meta, la base), todo se comporta como en los avisos de
siempre: el pedido no se revierte, la notificación queda registrada y se puede reintentar desde el panel; **el reintento reenvía el texto del negocio** (no la plantilla) y, si no se puede
leer la configuración, deja la fila como estaba.

### Archivos

| Archivo | Qué hace |
|---|---|
| `lib/agente/textos-etapa.ts` (nuevo) | funciones puras: las 3 etapas, el marcador `{pedido}`, `renderizarTextoEtapa` |
| `lib/agente/perfil-negocio.ts` | esquema: las 3 claves opcionales de `cierre.textos` |
| `lib/agente/aceptacion-humana.ts` | `ConfigAceptacion.textosEtapa` (lee las claves de la fila del agente) |
| `lib/catalogo/pedidos/avisos-etapa.ts` (nuevo) | el resolutor puro (matriz de arriba) |
| `lib/catalogo/pedidos/avisos-etapa-produccion.ts` (nuevo) | cableado de producción (módulos + configuración + notificador del panel). Separado a propósito: `notificaciones*.ts` no importa nada de la IA ni del agente (lo exige una prueba) |
| `lib/catalogo/pedidos/notificaciones.ts` | `NotificadorDeps.textoDeEtapa` (opcional); sin él, todo igual que antes |
| `lib/catalogo/pedidos/notificaciones-produccion.ts` | `MODULO_AVISOS_DE_ETAPA`, `MODULOS_PANEL_DE_PEDIDOS` |
| `app/api/dashboard/pedidos/[pedido]/route.ts` y `.../notificaciones/route.ts` | usan `productionNotificadorDelPanel` |
| `lib/tenant-modulos.ts` | módulo `avisos_etapa_pedidos` |
| `lib/agente/activacion-aslc.ts` | textos propuestos, `generarSqlAvisosDeEtapa`, el 03 de hoy ya trae los textos |
| `supabase/provisioning/aslc/14_avisos_de_etapa.sql` (nuevo, generado) | guarda los 3 textos y enciende el módulo |

## 3. Textos propuestos por DuLabs (no son del negocio: pendientes de aprobación)

Mismas reglas que los de decisión: sin nombres de personas, sin fechas, guías ni transportadoras, sin prometer que se volverá a avisar (la ventana de 24 h puede estar cerrada), solo
`{pedido}`, y solo repiten lo que el negocio ya dijo (pago contraentrega y tener el dinero disponible).

| Etapa | Texto |
|---|---|
| en preparación | Hola 👋 Tu pedido {pedido} ya está en preparación. Si tienes alguna duda, escríbenos por este mismo chat. |
| enviado | ¡Buenas noticias! 📦 Tu pedido {pedido} ya fue enviado. Recuerda que el pago es contraentrega: ten el dinero disponible cuando lo recibas. Si tienes alguna duda, escríbenos por este mismo chat. |
| entregado | Hola 👋 Tu pedido {pedido} figura como entregado. ¡Gracias por tu compra! Si tienes alguna duda, escríbenos por este mismo chat. |

Si el negocio prefiere otros, se ponen en `textos-aprobados.json` (`en_preparacion` / `enviado` / `entregado`), se regenera (`npx tsx scripts/generar-aprovisionamiento-aslc.ts`) y tienen prioridad.

## 4. Orden de activación

1. Fusionar el PR y **esperar el despliegue** en Vercel (el código nuevo es compatible con la fila de hoy: sin las claves nuevas no se envía nada, igual que ahora).
2. Correr `supabase/provisioning/aslc/14_avisos_de_etapa.sql` en el SQL Editor (una sola sentencia, todo o nada; se niega si `notificaciones_pedidos` está encendido, si la fila no
   tiene la configuración completa o si el aviso obligatorio no es el aprobado). Correrlo **antes** del despliegue dejaría la configuración inválida para el código anterior y el
   agente callaría.
3. Verificar (solo lectura): `npx tsx --env-file=.env.local scripts/verificar-aslc-solo-lectura.mts --etapa=controlado` y los tres textos y el módulo en la base.
4. QA desde el número de prueba: pedido → aceptar → «en preparación» → «enviado» → «entregado». Debe llegar un mensaje por etapa, con el número de pedido, desde el número de ASLC.

**Reversa:** apagar solo el módulo (`update public.dulabs_tenant_modulos set habilitado = false … modulo = 'avisos_etapa_pedidos'`, está en el encabezado del 14); los textos quedan sin uso.

## 5. Límites conocidos (no se resolvieron aquí)

- **Ventana de 24 h.** WhatsApp solo deja escribir un texto libre dentro de las 24 h siguientes al último mensaje del cliente. Si el equipo marca «en preparación» o «enviado» pasado
  ese plazo, el aviso no sale: el pedido cambia igual y el panel muestra «la ventana de conversación de WhatsApp estaba vencida». Avisar fuera de la ventana exige una **plantilla
  aprobada por Meta**, que no existe todavía (y cuyo costo por conversación está en la advertencia de precios de Meta). Mientras tanto, el equipo puede escribirle al cliente a mano.
- **Cancelar o rechazar desde Pedidos (no desde «Por aceptar»)** no le avisa al cliente por este camino: ese mensaje (con su texto del negocio) solo sale desde «Por aceptar». Queda como
  mejora aparte (requiere pasar el motivo escrito por la persona al notificador).
- Las etapas «pago recibido» y «completado» no se avisan en ASLC (el pago es contraentrega; no hay texto del negocio).
- Los textos viven en la configuración del agente de ASLC, así que **si esa fila se deshabilita o queda inválida, los avisos de etapa dejan de salir** (igual que los mensajes de decisión). El
  freno de emergencia (`07`) solo pausa la IA: no deshabilita la fila, así que los avisos de etapa siguen saliendo con la IA pausada (son avisos fijos, sin IA).

## 6. Pruebas

- `lib/catalogo/pedidos/avisos-etapa.test.ts` (31): módulo y esquema, lectura con el **parser real** del runtime (la fila de producción de antes sigue siendo válida), el resolutor
  (matriz completa, Delacour sin leer configuración, otro negocio, plantilla inválida, la base caída), de punta a punta con el motor en memoria (reproduce el reporte, una sola vez por
  etapa, doble clic, ventana vencida + reintento con el texto del negocio, falla de Meta, falla al leer la configuración, módulo apagado, Delacour igual), cableado de producción con
  un Supabase falso y reglas de arquitectura.
- `lib/agente/activacion-aslc.test.ts`: los textos propuestos, la prioridad de los aprobados, el 14 (escribe solo lo previsto, guardas, atómico, idéntico al 03).
- **SQL 14 en una base local efímera (pglite, nunca producción):** desde la fila de producción de hoy (02 → 03 anterior → 05 → 11 → 12 → 13) deja `checkout_opciones` idéntico al del 03
  de hoy + 13, enciende solo `avisos_etapa_pedidos`, no cambia pausa, restricción, habilitado, audio, aviso ni responsable, Delacour queda idéntico, es repetible, la reversa funciona
  y se niega (sin dejar cambios) con `notificaciones_pedidos` encendido, el aviso alterado, otro nombre u otra credencial.
