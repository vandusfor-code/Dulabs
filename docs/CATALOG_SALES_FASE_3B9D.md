# Aquí Sí Lo Compras — Fase 3B.9D: configuración completa y activación controlada

Fecha: 2026-10-03. Estado: **código y scripts listos y probados sin tocar producción; los scripts 03–10 NO están aplicados.** Ya aplicado en producción: migración
`20261207`, migración `20261208` (la aplicó el dueño) y el script `02` (fila del agente deshabilitada + módulos `catalogo`, `pedidos`, `pedidos_por_aceptar`).
ASLC sigue con la IA **pausada** y restringida a su número de prueba (termina en …7388). Delacour y los demás negocios no se tocan.

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
| Retiro en oficina Inter Rapidísimo | Solo si el cliente lo pide; sin dirección ni barrio; oficina escrita por el cliente; documento (número sin tipo) cifrado y borrado a los 30 días; si se niega, una persona |
| Número de pedido | Se muestra al cliente |
| Cobertura | Todo el país, sin exclusiones; ciudad desconocida o sin información verificable → una persona |
| Corte de las 11:30 en Bogotá | Lunes a viernes, festivos ignorados; antes: "puede" tener entrega el mismo día (nunca garantizado) |
| Bogotá **después** de las 11:30 | "…no tendría entrega el mismo día. El tiempo exacto depende de la ciudad y la transportadora." **Texto propuesto por DuLabs, sin dato del cliente** |
| Respuesta al "sí" tras el aviso | "¡Gracias por confirmar! 🙌 Una persona de nuestro equipo continuará con tu pedido y te escribirá por este mismo chat." (propuesta) |
| Regla "¿es una estafa?" | Política para el modelo (comercio serio, pago contraentrega, nota para revisar, **sin prometer** abrir el paquete) |

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
| 8 | "¿Cuánto demora a Bogotá?" | Envío gratis; antes de las 11:30 "puede" entrega el mismo día (no garantizado); después, sin mismo día | Backend (herramienta de envíos) |
| 9 | "¿Cuánto demora a una ciudad sin información?" | Pasa a una persona | Backend |
| 10 | "¿Es una estafa?" | Respuesta calmada y comercial con la regla aprobada; **sin** prometer abrir el paquete | **Modelo** (es política, no hay guardián determinista): revisar con Gemini real |
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
- **"¿Es una estafa?" depende del modelo** (política con la regla aprobada); se valida con Gemini real en el caso 10.
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
