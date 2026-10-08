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

Confirmaciones y recordatorios de citas, «Mi cita», registro de clientas por el portal, compra desde la tienda, atención humana, el panel de chats y los demás negocios (todo el
código nuevo se aparta si `idTenant` no es AMORE).

## 7. Texto a aprobar por AMORE

- Aviso de la opción **2**: «Claro 💗 Escríbenos tu consulta por aquí y una persona de nuestro equipo te responderá en cuanto pueda.» (`MENSAJE_CONSULTA_LA_ATIENDE_UNA_PERSONA`).
- El saludo y el menú son los de siempre (`MENSAJE_BIENVENIDA_1` / `MENSAJE_BIENVENIDA_2`).

## 8. Pruebas

`lib/amore-saludo-unico.test.ts` (71 casos) corre el pipeline real de producción con base de datos en memoria y exige, en **cada** mensaje, cero llamadas a la IA y cero al Flow
Engine. Cubre primer contacto (con y sin petición de cita, clienta nueva, gestión), silencio posterior, menú de una sola vez, enlace, gestión de citas de punta a punta, sesiones
viejas, fallo de base de datos, el interruptor y la regla de «una persona escribió». `lib/amore-pide-cita.test.ts` (90 casos) fija las frases que sí y las que no piden una cita, y `lib/amore-menu-bienvenida.test.ts` (81 casos) las formas de responder al menú.

## 9. Fuera de este cambio

- Los saludos de **cumpleaños** (`app/api/cron/cumpleanos/route.ts`) no los toca este cambio. Al revisarlos (2026-10-08) no había envíos registrados y el cron no figuraba
  programado; programarlo es una decisión aparte.
