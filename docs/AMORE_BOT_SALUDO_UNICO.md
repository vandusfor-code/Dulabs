# AMORE — asistente de WhatsApp en modo «saludo único»

Interruptor: `AMORE_BOT_MODO` (`lib/amore-bot-modo.ts`) · pruebas: `lib/amore-saludo-unico.test.ts`, `lib/amore-pide-cita.test.ts`, `lib/amore-menu-bienvenida.test.ts` · negocio: AMORE (`ed6ae77f-8a0c-483e-a5d9-8ede68eca50f`).

## 1. Qué se pidió y qué hace ahora

AMORE pidió que el asistente **solo mande el primer mensaje** (el saludo, que pregunta si quiere una cita) y que **no siga respondiendo en la conversación**. Se conserva todo lo
que es trámite: confirmaciones, recordatorios, «Mi cita», cumpleaños, cancelar / cambiar su cita y el **enlace de reserva cuando digan que quieren una cita**.

Es el modo **por defecto**. No hay migración de base de datos.

| Situación | Qué hace el asistente |
|---|---|
| Primer mensaje de un número nuevo (cualquiera que sea: «Hola», una pregunta…) | **Saludo + menú** (1 cita · 2 consulta · 3 una persona). No contesta la pregunta si la trae. El saludo sale **una sola vez** por número. |
| Primer mensaje pidiendo una cita («quiero una cita», «quisiera agendar»…) | Saludo + **enlace de reserva** (sin menú). |
| Primer mensaje gestionando su cita («quiero cancelar mi cita», «quiero cambiar mi cita») | Saludo + el trámite normal (muestra SU cita, pide confirmar). |
| Responde **1** al menú (solo la primera respuesta, y solo si ninguna persona le escribió después): «1», «1.», «1️⃣», «la 1», «opción 1», «uno», o a secas «cita», «agendar»… | Enlace de reserva. |
| Responde **2** («2», «opción dos», «consulta», «quiero hacer una consulta»…) | Un aviso fijo: «una persona de nuestro equipo te responderá». Después, silencio. |
| Responde **3** («3», «tres», «una persona»…), o pide hablar con una persona | Avisa a Jessica y le dice a la clienta que ya se avisó. Después, silencio total (atención humana, 24 h). |
| En cualquier momento dice que quiere una cita | Enlace de reserva (cada vez que lo pida). |
| Cancelar / cambiar / consultar SU cita con frases claras | El trámite de siempre, siempre con confirmación explícita antes de tocar nada. |
| **Cualquier otra cosa** (preguntas, charla, «gracias», emojis, audios…) | **Silencio.** La atiende el equipo. |

En este modo **nunca** se llama a la IA y **nunca** se cae al Flow Engine (que conversaría con IA). Si la base de datos falla al leer el estado de la conversación, el asistente
también se calla (queda el error en el log).

## 2. Cuándo el asistente calla del todo

- La clienta pidió una persona (menú «3» o frases como «quiero hablar con alguien»): 24 h de silencio (`VENTANA_ATENCION_HUMANA_MS`).
- El equipo pulsó **«Atención manual»** en el chat del panel: el worker no invoca al asistente (hasta «Reactivar asistente»).
- Una conversación ya saludada y sin petición de cita ni de gestión: silencio (punto de arriba).
- Un registro o una compra que la clienta dejó abiertos ya no le repiten avisos mientras una persona le contesta (ver §10).

Que el equipo escriba **no** pausa al asistente por sí mismo; por eso el menú es de una sola vez y los números dejan de valer cuando una persona del equipo fue la última en
escribirle a la clienta (`lib/chats/ultimo-saliente.ts`: si «la profesional» ofrece «1) 10 o 2) 11» y la clienta responde «1», eso es de SU conversación).

## 3. Cómo se decide que «piden una cita» (sin IA)

`lib/amore-pide-cita.ts` suma a las frases fijas de siempre (`detectarTriggerAgendaDeterminista`) las formas comunes que esas frases no cubrían: «quisiera una cita», «quiero cita»,
«necesito cita», «me gustaría tener una cita», «agendar cita», «¿tienen citas / disponibilidad / cupo?», «¿qué horarios tienen?», «¿cómo reservo?», «me agendas»…

Criterio: un falso positivo solo manda el enlace; un falso negativo deja a la clienta sin enlace y la atiende el equipo. No se dispara con «cita» suelta ni con «tengo una cita
mañana» / «confirmo mi cita» (son de una cita que ya existe). Una negación pegada al verbo («no quiero cita», «ya no necesito una cita») nunca cuenta.

**Límite conocido:** al no haber IA, una cancelación o cambio escrito con palabras libres («no voy a poder ir», «se me complicó») ya no se entiende y queda en silencio para el
equipo. Las frases claras («quiero cancelar mi cita», «quiero cambiar mi cita», «cancelar cita»…) siguen funcionando, y los recordatorios y confirmaciones llevan el enlace
personal «Mi cita» para cancelar o cambiar sin escribir.

## 4. Sesiones que quedaron abiertas

Una sesión de Agenda V2 que quedó abierta contestaba **cualquier** mensaje suelto (mandaba el enlace por «gracias»). En este modo:

- una reserva por chat abandonada (la de antes del enlace) se cierra **en silencio** con el siguiente mensaje;
- una gestión de cita (cancelar / cambiar) sin movimiento en **más de 2 horas** (`VENTANA_SESION_GESTION_ABANDONADA_MS`) se cierra en silencio;
- una gestión reciente no se toca: la clienta está en pleno trámite.

## 5. Reversa

`AMORE_BOT_MODO=completo` en las variables de entorno de Vercel (producción) y un nuevo despliegue (~3 min) devuelven el comportamiento anterior (conversación con IA durante toda
la charla). Cualquier otro valor, o quitar la variable, deja el modo «saludo único». Las suites del modo «completo» (`lib/amore-entrada-router.test.ts`,
`lib/amore-conversacion-matriz.test.ts`, `lib/agenda-v2/router.test.ts`) fijan `AMORE_BOT_MODO=completo` y siguen pasando completas: la reversa no cambió.

## 6. Qué no cambia

Confirmaciones y recordatorios de citas, «Mi cita», registro de clientas por el portal, atención humana, el panel de chats y los demás negocios (todo el código nuevo se aparta
si `idTenant` no es AMORE). La compra desde la tienda conserva su recorrido (botón «Comprar» → menú 1/2 → llave de pago → «Ya pagué» avisa a Jessica); solo dejó de repetir avisos sin
fin (ver §10).

## 7. Texto a aprobar por AMORE

- Aviso de la opción **2**: «Claro 💗 Escríbenos tu consulta por aquí y una persona de nuestro equipo te responderá en cuanto pueda.» (`MENSAJE_CONSULTA_LA_ATIENDE_UNA_PERSONA`).
- El saludo y el menú son los de siempre (`MENSAJE_BIENVENIDA_1` / `MENSAJE_BIENVENIDA_2`).

## 8. Pruebas

`lib/amore-saludo-unico.test.ts` (84 casos) corre el pipeline real de producción con base de datos en memoria y exige, en **cada** mensaje, cero llamadas a la IA y cero al Flow
Engine. Cubre primer contacto (con y sin petición de cita, clienta nueva, gestión), silencio posterior, menú de una sola vez, enlace, gestión de citas de punta a punta, sesiones
viejas, fallo de base de datos, el interruptor y la regla de «una persona escribió». `lib/amore-pide-cita.test.ts` (90 casos) fija las frases que sí y las que no piden una cita, y `lib/amore-menu-bienvenida.test.ts` (81 casos) las formas de responder al menú.

## 9. Fuera de este cambio

- Los saludos de **cumpleaños** (`app/api/cron/cumpleanos/route.ts`) no los toca este cambio. Al revisarlos (2026-10-08) no había envíos registrados y el cron no figuraba
  programado; programarlo es una decisión aparte.

## 10. Flujos que capturan los mensajes de la clienta: cuándo se sueltan

Dos flujos de AMORE se quedan con **todos** los mensajes de la clienta mientras están abiertos (van antes que cualquier otra capa en `lib/whatsapp-qr-pipeline.ts`): el **registro** de
clientas nuevas (nombre → día → mes de cumpleaños) y la **compra de un producto** de la tienda (botón «Comprar» → menú 1/2 → pago). Ninguno tenía salida: repetían «Necesito un día válido
entre 1 y 31», «No reconocí esa opción» o el recordatorio de pago con cada mensaje, sin tope, aunque una persona del equipo ya le estuviera contestando desde el celular y aunque hubieran
pasado semanas (captura de AMORE del 2026-10-29: «aparecen muchos mensajes»).

Ahora cada flujo se **suelta** —modo `gemini`, sin mandar nada y **sin marcar el wamid**, para que el mensaje siga su camino por las demás capas como el de cualquier otra clienta— cuando
deja de ser de la clienta. Todo se decide con lo que la clienta realmente recibió (sus últimos mensajes enviados en `dulabs_chat_mensajes`, `lib/chats/salientes-recientes.ts`); sin historial
legible no se decide nada y el flujo sigue como siempre. **No hay migración ni SQL**: las clientas que hoy están atrapadas se sueltan solas con su próximo mensaje.

| | Registro (`lib/amore-registro-vigencia.ts`) | Compra (`lib/amore-compra-vigencia.ts`) |
|---|---|---|
| Una persona del equipo fue la última en escribirle | se suelta | menú 1/2: se suelta (su «1» es de SU conversación) · esperando el pago: el asistente **calla** y el flujo sigue abierto |
| Cambia de tema (pide una cita o gestiona la que tiene) | — | se suelta |
| Ya se le repitió el aviso 2 veces seguidas | se suelta en vez de mandar un tercero | menú 1/2: se suelta en vez de mandar un tercero |
| Respuesta válida (un día o mes; «1» o «2») | **nunca** se descarta por los avisos anteriores | **nunca** se descarta por los avisos anteriores |
| Tiempo | más de 6 h sin ningún mensaje enviado: se suelta | **sin vencimiento**: quien elige «1» días después todavía puede pagar |
| «Ya pagué» | — | se reconoce **siempre**, antes que cualquier otra regla |
| Recordatorio de pago | — | se manda **una** vez seguida |
| Botón «Comprar» nuevo | — | reinicia el flujo con el producto nuevo (antes recibía «No reconocí esa opción») |

«Una persona fue la última en escribirle» = el último mensaje enviado tiene `origen = 'humano'` (el worker lo marca así cuando no lo mandó el asistente). En la compra, además, el texto no
puede ser uno de los textos fijos del asistente: el `origen` se marca desde un registro en memoria del worker, y un fallo de esa marca no debe quitarle el flujo de pago a la clienta.

**Por qué el registro vence por tiempo y la compra no:** desde que las citas nuevas van por el enlace nadie arranca un registro por chat, así que todos los que hay en la base son viejos;
el flujo de compra, en cambio, está activo y toca dinero (perder un «Ya pagué» o un «1» tardío es peor que un aviso de más).

**Pruebas:** `lib/amore-registro-vigencia.test.ts`, `lib/amore-compra-vigencia.test.ts`, `lib/chats/salientes-recientes.test.ts`, los bloques «Test R» y «Test S» de
`lib/amore-entrada-router.test.ts` y los bloques J y K de `lib/amore-saludo-unico.test.ts` (pipeline real, de punta a punta). Mutación: `scripts/mutacion/registro-vigencia.py` y
`scripts/mutacion/compra-vigencia.py`.
