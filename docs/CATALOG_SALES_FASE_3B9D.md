# Aquí Sí Lo Compras — Fase 3B.9D: configuración completa y activación controlada

Fecha: 2026-10-03 (ajustes del 2026-10-05 en la sección 8). Estado vigente (2026-10-05): el dueño aplicó la migración `20261207`, la `20261208` y los scripts `02`, `03`, `05` y `11`; el
código con la compuerta `cierre_aceptacion_humana` abierta está desplegado. La IA de ASLC está **activa pero restringida** a su número de prueba (termina en …7388): el `06`
(abrir al público) NO está aplicado y no debe aplicarse hasta cerrar el QA (sección 4). Delacour y los demás negocios no se tocan.

> Lo que sigue (secciones 1 a 7) es la descripción original de la fase; el estado actual y lo que se ajustó después están en la sección 8.

## 1. Qué cambió

| Qué | Dónde | Efecto |
|---|---|---|
| Compuerta `cierre_aceptacion_humana` abierta | `lib/agente/perfil-negocio.ts` | Una fila de agente con `cierre.modo = aceptacion_humana` pasa a ser **válida**. Sin esto, la configuración de ASLC es inválida y el agente calla. No afecta a nadie más: Delacour no usa ese cierre, y la fila de ASLC sigue deshabilitada y con la IA pausada hasta el script 05. |
| Configuración completa de ASLC | `lib/agente/activacion-aslc.ts` | Una sola fuente, validada con el **mismo esquema** que el runtime. El aviso obligatorio entra desde `textos-aprobados.json` y se verifica byte a byte (747 bytes, SHA-256). |
| Scripts SQL (generados, no se editan a mano) | `supabase/provisioning/aslc/03…10` | Cada uno es UNA sola sentencia (un bloque DO atómico) con guardas; una prueba verifica que el archivo es exactamente la salida del generador. |
| Verificación de solo lectura por etapa | `scripts/verificar-aslc-solo-lectura.mts` | `--etapa=inicial\|aprovisionado\|configurado\|controlado\|publico`: juzga la fila real con el parser y las compuertas reales del runtime. |
| Pruebas | `lib/agente/activacion-aslc.test.ts` (+ bloque 3B.9D en `agente-aceptacion-humana.test.ts`) | La configuración REAL de ASLC corre de punta a punta en el motor: política de reserva y vencimiento, asignación, pausa de la IA, aceptación por la responsable o un administrador, documento de oficina cifrado, "sí" del cliente y caso 15. |

## 2. Orden de ejecución

| # | Quién | Qué | Cómo se verifica |
|---|---|---|---|
| 0 | — | (HECHO) Migraciones `20261207`, `20261208` y script `02`. | `--etapa=aprovisionado` → OK |
| 1 | Dueño | `08_ver_equipo_solo_lectura.sql` (opcional): ids del equipo. Para ser responsable: `estado = 'activo'` y rol `admin` o `agente`. | — |
| 2 | Dueño | `03_configurar_completo_sin_activar.sql` con `v_responsable` (y, si hay, `v_respaldo`). La fila sigue deshabilitada y la IA pausada. | `--etapa=configurado` → OK |
| 3 | DuLabs | Desplegar el código con la compuerta abierta (merge a `main`). **`GEMINI_KEY_ASLC` en Vercel solo se aplica a despliegues NUEVOS**: este despliegue la toma. | Despliegue en estado Ready |
| 4 | Cliente | Cargar los ~12 productos (Dashboard → Catálogo → Carga masiva) y **publicar** el catálogo (necesario para que el agente envíe fotos). | Productos > 0 en el panel |
| 5 | Dueño | `05_activacion_controlada.sql`: habilita el agente, enciende la transcripción de audio y quita la pausa, **solo si la IA sigue restringida** a números de prueba (si no, se niega). | `--etapa=controlado` → OK |
| 6 | Dueño | QA con el número de prueba (sección 4). | 16 casos |
| 7 | Dueño | `06_abrir_al_publico.sql`: quita la restricción. Solo corre con la etapa controlada en marcha. | `--etapa=publico` → OK |

Siempre disponibles: `07_freno_de_emergencia.sql` (pausa la IA al instante; los mensajes siguen llegando al Inbox), `10_reanudar_tras_freno.sql` (quita SOLO la pausa y deja la
restricción como estaba, controlado o público; nunca sirve como primera activación), `09_cambiar_responsable.sql` (con la fila ya habilitada) y `04_revertir_aprovisionamiento.sql`
(reversa del 02, solo mientras nadie haya habilitado la fila).

Comando de verificación (solo lectura, no escribe nada y no imprime secretos):

```bash
npx tsx --env-file=.env.local scripts/verificar-aslc-solo-lectura.mts --etapa=configurado
```

`huella_otros_negocios` y `huella_agentes_otros` deben seguir siendo `8c2a8bbde0765e3f4bddde39465b839c` y `fcce81399f3e582fd91d90498f1cf9cc` (Delacour y demás, intactos).

## 3. Decisiones ADOPTADAS (no las dio el cliente; el negocio puede cambiarlas)

Se tomaron el 2026-10-03 para no frenar la entrega. Viven en `DECISIONES_ASLC`, `TEXTOS_ASLC` y `POLITICAS_ASLC` (`lib/agente/activacion-aslc.ts`); cambiar una = editar la constante, regenerar
(`npx tsx scripts/generar-aprovisionamiento-aslc.ts`) y volver a correr el 03 **mientras la fila siga deshabilitada**. Después de activar, un cambio de configuración se hace pausando (07) y con un SQL de ajuste.

| Tema | Valor adoptado |
|---|---|
| Quién acepta en el panel | La responsable, su respaldo y los administradores |
| Reserva de stock mientras espera / vencimiento | 12 h / 24 h |
| Teléfono de contacto | Vale "este mismo WhatsApp" |
| Retiro en oficina Interrapidísimo | Solo si el cliente lo pide; sin dirección ni barrio; oficina escrita por el cliente; documento (número sin tipo) cifrado y borrado a los 30 días; si se niega, una persona |
| Número de pedido | Se muestra al cliente |
| Cobertura | Todo el país, sin exclusiones; ciudad desconocida o sin información verificable → una persona |
| Corte de las 11:30 en Bogotá | Lunes a viernes, festivos ignorados; antes: "puede" tener entrega el mismo día (nunca garantizado) |
| Bogotá **después** de las 11:30 | Hasta el 2026-10-04: "…no tendría entrega el mismo día. El tiempo exacto depende de la ciudad y la transportadora." **Desde el 2026-10-05** (ver 8.2: el candado de envíos rechazaba esa frase): "Envío gratis. Como tu pedido se hace después de las 11:30 a. m., el tiempo exacto de entrega depende de la ciudad y la transportadora." **Texto propuesto por DuLabs, sin dato del cliente** |
| Respuesta al "sí" tras el aviso | Por defecto (sin texto del negocio): "¡Gracias por confirmar! 🙌 Una persona de nuestro equipo continuará con tu pedido y te escribirá por este mismo chat." **Desde el 2026-10-05** sale la que redactó el negocio (nombra a la asesora responsable; vive en `textos-aprobados.json`, nunca en el código) |
| Regla "¿es una estafa?" | Política para el modelo (comercio serio, pago contraentrega, nota para revisar, **sin prometer** abrir el paquete). **Desde el 2026-10-05** además va el texto del cliente como información oficial (`negocio.conocimiento`) |

## 4. QA con el número de prueba (los 16 casos del cliente)

Se hace con la IA restringida al número de prueba. **No se abre al público hasta que todos estén en verde.**

| Caso | Mensaje del cliente | Debe pasar | Quién lo garantiza |
|---|---|---|---|
| 1 | "Hola" | Saludo del agente | Modelo |
| 2 | "¿Qué productos tienen?" | Lista del catálogo cargado (nada inventado) | Herramientas + catálogo |
| 3 | "¿Cuánto cuesta [producto]?" | Precio del catálogo | Herramientas |
| 4 | "Muéstrame fotos" | Envía las fotos (catálogo publicado) | Herramientas |
| 5 | "¿Tienen disponible?" | Stock real | Herramientas |
| 6 | "Quiero comprar" | Pide los datos (nombre, teléfono, ciudad, departamento, dirección, barrio) y muestra el resumen con botón "datos correctos" | Backend (checkout) |
| 7 | "Quiero pagar por Nequi" | Rechaza el pago anticipado; solo contraentrega | Backend (el único pago es `contra_entrega`) + política |
| 8 | "¿Cuánto demora a Bogotá?" | Envío gratis; antes de las 11:30 "puede tener entrega el mismo día" (nunca garantizado); después, "el tiempo exacto de entrega depende de la ciudad y la transportadora" (textos desde el 2026-10-05, ver 8.2). Con la ciudad ya conocida no pasa a una persona | Backend (herramienta de envíos) |
| 9 | "¿Cuánto demora a una ciudad sin información?" | Pasa a una persona | Backend |
| 10 | "¿Es una estafa?" | Respuesta calmada y comercial con el texto del negocio; **sin** prometer abrir el paquete | **Modelo** (es política, no hay guardián determinista): validado con Gemini real el 2026-10-05 (sección 8.3); repetirlo en el QA |
| 11 | Nota de voz | Se transcribe y se trata como texto; si no se puede, pide que lo escriba | Backend (`transcripcion_audio`) |
| 12 | "Quiero hablar con una persona" | Traspaso a una persona | Backend |
| 13 | Cambiar la dirección después del proceso | La IA calla (ya hay pedido pendiente y la IA está pausada); lo atiende la responsable desde el Inbox | Backend |
| 14 | "Sí" tras el aviso | UNA respuesta fija; el pedido NO se confirma | Backend |
| 15 | La responsable escribe antes del "sí" | La IA **no** responde; el "sí" queda registrado | Backend |
| 16 | La responsable acepta en el panel | Pedido confirmado (`acceptOrder`, nunca la IA). **No sale un mensaje automático al cliente** (ver sección 5): la responsable le escribe desde el Inbox | Backend |

Además, en el flujo completo debe verse: el **aviso obligatorio** exacto tras "datos correctos"; el pedido en **Por aceptar** con el aviso registrado; la conversación **asignada** a la responsable; la IA **en silencio** en ese chat.

## 5. Límites conocidos (dichos sin adornos)

- **Sin mensajes automáticos de aceptado / rechazado / cancelado al cliente.** Salen solo con el módulo `notificaciones_pedidos`, que también manda avisos genéricos de otras etapas con el tono de otro negocio (💖). Se dejó **apagado** (los scripts 05, 06 y 10 se niegan si está encendido). Hoy la responsable escribe al cliente desde el Inbox.
- **La responsable se entera por el panel** (conversación asignada y lista "Por aceptar"). Correo y WhatsApp a la responsable no están implementados.
- **"¿Es una estafa?" depende del modelo** (política con el texto aprobado); validado con Gemini real el 2026-10-05 (sección 8.3) y debe repetirse en el QA (caso 10).
- **El candado de envíos no entiende negaciones ni exime el texto exacto del motor** (sección 8.2): un texto de envío del negocio que diga "no está garantizado" o "no tendría entrega el mismo día" haría que el modelo, al repetirlo, sea rechazado y la conversación termine en una persona. Los textos de ASLC se redactaron sin esas frases y una prueba lo vigila; el defecto del candado está propuesto como tarea aparte.
- **Si el modelo pasa el caso a una persona y después falla el texto de cierre** (el proveedor devuelve 503 o tarda), el cliente puede recibir "¿me lo escribes de nuevo?" aunque el chat ya quedó con un asesor. Propuesto como tarea aparte.
- **Bloques `handoff` y `textos` del perfil no implementados** en el runtime: cargarlos invalida la configuración. Pasan a una persona de forma determinista: el cliente que lo pide, las dudas de envío y las fallas repetidas; lo demás depende del modelo.
- **Festivos:** el sistema no tiene un calendario confiable; la regla de las 11:30 los ignora.
- La **persona responsable** debe estar `activo` con rol `admin` o `agente`: una persona invitada que aún no entró, suspendida o con rol `lectura` no sirve (los scripts lo verifican).

## 6. Freno, reanudación y reversa

| Situación | Qué correr |
|---|---|
| Algo raro con un cliente real | `07` (pausa al instante; el agente calla y nunca cae a otro bot) |
| Ya se resolvió | `10` (solo quita la pausa; la restricción queda como estaba) |
| Cambió la persona responsable | `09` (solo cambia el responsable; los pedidos ya pendientes siguen asignados a la anterior y se reasignan desde el Inbox) |
| Se quiere volver a antes de configurar | Reversa comentada al inicio del `03` (solo mientras la fila siga deshabilitada) |
| Se quiere deshacer el aprovisionamiento | `04` (se niega a borrar una fila que alguien habilitó o cambió) |

## 7. Pendiente (no es de código)

- Cliente: usuario real de la responsable (hoy el único miembro de ASLC es el administrador; mientras tanto el 03 puede apuntar a esa cuenta y luego se cambia con el 09), línea de WhatsApp (en la base figura …8509, el negocio informó …5088) y correo, **aprobación de los textos y decisiones de la sección 3** y la cobertura exacta.
- Catálogo: ~12 productos (sin fotos al inicio es posible; se agregan después).
- Dueño: despliegue (merge) y `GEMINI_KEY_ASLC` en Vercel (ya cargada; aplica con el siguiente despliegue).

## 8. Ajustes del 2026-10-05: configuración del cliente, evaluación con Gemini real y catálogo por color

Estado (2026-10-05): el PR #162 (el agente ve la descripción completa del producto, antes solo 200 caracteres) está fusionado y desplegado. **El `11` ya está aplicado en producción** (lo corrió el dueño a las 12:14, hora de Colombia) y la
fila del agente quedó IDÉNTICA a la que genera el código (negocio y `checkout_opciones` del 03 de hoy, aviso exacto, parser real en `ok`; comprobado en solo lectura). El mismo día el dueño aplicó la migración pendiente de media del Inbox
(`20260927000000_dulabs_mensajes_log_media.sql`: 6 columnas en `dulabs_mensajes_log`; sin ella, lo que una persona enviaba con foto o documento desde el Inbox no quedaba en el historial). Con eso no queda ninguna migración pendiente.

### 8.1 Qué se configuró (todo es configuración del negocio: el runtime no cambia)

| Qué | Dónde vive | Detalle |
|---|---|---|
| Estilo de atención | `negocio.tono` y `negocio.personalidad` | Tutea siempre; cercano, comercial y persuasivo sin presionar; emojis moderados y respuestas breves; propone el siguiente paso; ante una objeción de precio destaca lo que incluye y su garantía y ofrece solo opciones más económicas; respeta a quien dice que no le interesa |
| 9 políticas | `negocio.politicas` | Solo contraentrega; del envío no se dice nada hasta consultar la ciudad; desconfianza → respuesta oficial sin prometer que abran el paquete; nunca confirmar un pedido; agotado sin prometer reposición; sin respuesta confirmada → asesor (`out_of_scope`); queja, problema de pedido o entrega, garantía, devolución, cambio o solicitud especial → asesor; ubicación; necesidades descritas ("algo para cocinar") → buscar con varios términos antes de decir que no hay |
| Información oficial | `negocio.conocimiento` | Ubicación de la bodega (vía Siberia, Cundinamarca), qué responder a quien desconfía (texto del cliente) y horario 24/7 |
| Respuesta tras el "sí" | `checkout_opciones.cierre.textos.tras_aviso_confirma` | Nombra a la asesora responsable (texto del negocio) |
| Ortografía | `checkout_opciones` | "Interrapidísimo", como la escribe el negocio |

Los textos del negocio viven en `textos-aprobados.json` (el código no trae ninguno: en el código de la aplicación no aparece el nombre de ninguna persona y una prueba lo verifica). El `11` carga todo esto en la fila
ya habilitada sin tocar la pausa, la restricción, `habilitado`, el audio, el responsable ni el aviso, y una prueba en una base local demuestra que deja la fila EXACTAMENTE como la dejaría el `03` de hoy.

### 8.2 Hallazgo de la evaluación: "envío gratis" antes de saber la ciudad

El candado de envíos (3B.6) solo acepta lo que el modelo diga del envío (gratis, cobertura, "a nivel nacional", tiempos, transportadora) si `consultar_envio` lo respaldó **con la ciudad del cliente en ese turno**.
Si no, descarta la respuesta ENTERA y obliga a preguntar la ciudad. Con la primera versión del estilo, las respuestas de Gemini eran buenas pero decían "envío gratis" de entrada, y el cliente recibía solo "¿en qué ciudad?":

| El cliente preguntaba | Gemini redactaba (correcto) | El candado lo descartaba y el cliente recibía |
|---|---|---|
| "¿Cuánto vale el Kit Tablet Krono Net X2?" | precio, qué incluye, garantía y "envío gratis" | solo "¿en qué ciudad?" |
| "¿Qué incluye y qué garantía tiene?" | lista completa y "envío GRATIS" | solo "¿en qué ciudad?" |
| "¿Dónde están ubicados?" | el texto del cliente, que dice "a nivel nacional, con envío GRATIS" | otra pregunta, sin la ubicación |

Tres causas, tres arreglos (solo configuración y datos): (1) el estilo y las políticas ya no empujan a decir "envío gratis" y piden la ciudad con naturalidad; (2) la línea "Envío: gratis." salió de la descripción de los productos
reescritos; (3) la ubicación queda como "…vía Siberia, Cundinamarca. Desde allí despachamos nuestros pedidos, con pago contraentrega." (la parte de "a nivel nacional" y "envío gratis" la dice el sistema cuando el cliente da su ciudad).
Una prueba exige que ningún texto que el modelo repite active el candado. **Alternativa no hecha:** eximir del candado los textos aprobados tal cual (cambio de código en un guardián de seguridad; solo si el cliente insiste en su texto literal).

**Segundo hallazgo, más grave: los textos de Bogotá.** El motor de envíos devuelve para Bogotá un texto distinto antes y después de las 11:30 (la regla del negocio: antes "puede" tener entrega el mismo día y nunca se dice que está garantizado), y el
modelo debe repetirlo TAL CUAL. Pero el candado revisa también ese texto y no entiende la negación: «(no está garantizado)» activaba `guarantee` y «no tendría entrega el mismo día» activaba `same_day_unbacked`. En un día hábil, TODA consulta de
envío a Bogotá terminaba en una persona (Gemini repetía el texto, el candado lo rechazaba dos veces y salía el traspaso). Se vio al evaluar "Estoy en Bogotá". Arreglo (configuración): «Envío gratis. Tu pedido, hecho antes de las 11:30 a. m., puede
tener entrega el mismo día.» y, después, «Envío gratis. Como tu pedido se hace después de las 11:30 a. m., el tiempo exacto de entrega depende de la ciudad y la transportadora.» (el negocio no dio texto para después de las 11:30; no se dice nada
que el sistema no pueda respaldar). El `11` también carga estos tiempos, y una prueba recorre los 7 días × 7 horas × 6 ciudades con el motor REAL y exige que cada texto que puede devolver pase el candado repetido tal cual.
**Defecto del candado que sigue ahí** (sin tocar, es un guardián de seguridad): no entiende negaciones ni eximir el texto exacto del motor; le pegará a cualquier negocio cuyo texto de envío niegue algo. Está propuesto como tarea aparte.

### 8.3 Evaluación con el modelo real (Gemini 3.6 flash, catálogo real de 12 productos en memoria, nunca tocó producción)

Se corrió el runtime real del agente (herramientas, anclaje y traspasos) con la configuración de ASLC, los 12 productos reales en memoria y Gemini real, sin tocar producción ni WhatsApp. Los casos que fallaron por el
proveedor se repitieron; lo que sigue es lo que salió con la configuración final. Después de aplicar el `11` y fusionar el PR #162 se repitió OTRA VEZ, ahora leyendo de producción la fila del agente y el catálogo REALES (solo lectura: un proxy bloquea cualquier escritura al catálogo; pedidos, asignación y pausa en memoria, nada por WhatsApp): saludo, precio con colores, qué incluye y garantía del Kit X2 (con la descripción COMPLETA), garantía no informada, ubicación, desconfianza, queja, envío a Bogotá y a Medellín, objeción de precio, Nequi, "algo para cocinar" y una COMPRA COMPLETA salieron bien (detalle al final de esta sección).

| Caso | El cliente escribe | Resultado |
|---|---|---|
| Saludo | "Hola" | OK: saluda tuteando y ofrece ayuda |
| Productos | "¿Qué productos tienen?" | OK: envía el enlace del catálogo |
| Precio con colores | "¿Cuánto cuesta la Tablet Infantil Modio M56?" | OK: precio y los dos colores (Azul, Rosa); pregunta cuál |
| Qué incluye y garantía | "Me interesa el Kit Tablet Krono Net X2…" / "¿Qué incluye y qué garantía tiene?" | OK: especificaciones, lo que incluye, **8 meses de garantía** y pago contraentrega; pide la ciudad (necesita el PR #162: sin él solo ve 200 caracteres de la descripción) |
| Garantía no informada | "¿El Kit Tablet Net G tiene garantía?" | OK: **no la inventa**, pasa a una persona |
| Ubicación | "¿Dónde están ubicados?" | OK: «vía Siberia, Cundinamarca», contraentrega y pregunta la ciudad |
| Desconfianza | "¿Esto es una estafa?" | OK: la respuesta del negocio (comercio serio, contraentrega, nota para revisar) sin prometer abrir el paquete |
| Queja con garantía | "Compré una tablet… llegó dañada, quiero hacer valer la garantía" | OK: pasa a una persona |
| Cambio | "Quiero cambiar el reloj por otro color" | OK: pasa a una persona |
| Pide una persona | "Quiero hablar con una persona" | OK: la pasa el sistema, sin modelo |
| Solicitud especial | "…Net G con otro cargador y teclado en inglés" | OK: pasa a una persona, no promete nada |
| No le interesa | "No gracias, no me interesa" | OK: se despide, no insiste |
| Nequi | "Quiero pagar por Nequi" | OK: texto fijo, solo contraentrega |
| Envío con ciudad | "¿Cuánto demora el envío a Medellín?" / "Vivo en Cali…" | OK: «gratis, normalmente 2 a 3 días hábiles», tal cual el motor |
| Envío a Bogotá | "¿Cuánto demora el envío a Bogotá?" / "Estoy en Bogotá" | OK **tras el arreglo** (antes: pasaba a una persona) |
| Envío sin ciudad | "¿El envío tiene costo?" / "¿Hacen envíos a todo el país?" | OK: no afirma nada y pide la ciudad |
| Necesidad descrita | "¿Tienen algo para cocinar?" | OK **tras la política nueva**: ofrece las dos freidoras (antes: "no encontré") |
| Agotado | "¿Tienen la Freidora Click Home?" / "¿Y cuándo les llega?" | OK: dice que está agotada, ofrece la otra freidora y **no promete fecha** |
| Objeción de precio | "Me gusta pero está muy caro" | OK con el estilo final y datos reales: destaca lo que incluye, la garantía y el pago contraentrega, y ofrece solo opciones MÁS económicas (la Z Kids y la Modio). Con una versión anterior del estilo ofreció una alternativa más cara, de ahí el ajuste |

**Compra completa sobre datos reales (solo lectura):** "Hola, quiero comprar la Tablet Infantil Modio M56 en color rosa" / "Solo 1, me la llevo" → el modelo llama `update_cart` y `create_order_request` y arranca el checkout del sistema (nombre, teléfono con el botón "Este mismo número", ciudad, departamento, dirección, barrio) → resumen con la Modio (Rosa) DL-000004, "Envío gratis" y contra entrega → "Datos correctos" → el aviso obligatorio EXACTO → el pedido queda `pending_acceptance`, asignado al responsable (2776) y la IA se pausa en ese chat → el cliente contesta "Sí" y recibe UNA respuesta fija que nombra a la asesora; el pedido sigue pendiente (el "sí" no lo confirma). Un detalle del modelo: a veces cuela una palabra en inglés ("Available en Azul o Rosa"); no es de configuración.

Durante la evaluación Gemini devolvió `503 UNAVAILABLE` (saturación del proveedor) y `timeout` en ráfagas: los fallos "me lo escribes de nuevo" de la primera corrida eran del proveedor, no de la configuración (el arnés reintenta; el
sistema real responde con el mensaje fijo y, tras dos fallos seguidos, pasa a una persona).

### 8.4 Catálogo por color (hecho en producción el 2026-10-05, con OK del dueño)

El checkout no tiene campo de color ni de referencia, así que **cada color es un producto aparte**: 8 → 12 productos (Modio Rosa/Azul, Reloj Rosado/Gris, Celular Verde/Azul/Rosado). Los tres productos que ya existían conservan su
referencia (DL-000004, DL-000007, DL-000008) con el primer color; los otros cuatro son nuevos (DL-000009 a DL-000012). Stock 5 provisional y sin fotos (solo DL-000002 tiene una). Se hizo con el mismo camino del formulario
(esquemas y servicio del Catálogo), verificando el negocio antes de cada escritura, con 10 comprobaciones posteriores: 12 exactos, todos de ASLC, fotos y publicación intactas, otros negocios idénticos, IA intacta.
Los 7 productos escritos ya no llevan "Envío: gratis." en la descripción; los otros 5 (DL-000001, 2, 3, 5 y 6) todavía la conservan: conviene quitarla (empuja al modelo a decir "envío gratis" antes de la ciudad).

### 8.5 Pendiente

- Dueño: repetir el QA con …7388 (garantía, qué incluye, ubicación, desconfianza, envío a Bogotá, queja → persona) y, si quiere, quitar «Envío: gratis.» de la descripción de DL-000001, 2, 3, 5 y 6 (`update … set descripcion = replace(descripcion, ' Envío: gratis.', '')` acotado al tenant y a esas referencias). El `11` y el PR #162 ya están aplicados.
- Cliente: usuario real de la asesora Patricia Castro (hoy el responsable es el administrador), línea (…8509 vs …5088), garantía del Kit Tablet Net G y accesorios de la Freidora Click Home, fotos de los 12 productos, aprobar los textos y decisiones adoptadas.
- Sin construir (propuestos, esperan OK): aviso de "venta cerrada" a la asesora por WhatsApp o correo, seguimiento cada 2 horas, y el bloque `handoff` determinista.
- Ciudades remotas (San Andrés, Leticia, Mitú…) hoy dan "2 a 3 días hábiles" como cualquier otra: confirmar con el cliente si deben pasar a una persona.
