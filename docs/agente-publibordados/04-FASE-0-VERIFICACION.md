# Agente Publi Bordados — 04 · Fase 0: verificación técnica

> Estado: **EN PROGRESO**. Este documento separa lo **VERIFICADO** (código del repositorio,
> `main` @ `dbff111`) de lo **NO VERIFICADO** (producción, Meta, QStash), y deja las pruebas
> exactas para cerrar cada punto.
>
> **Limitaciones de este entorno (comprobadas):**
> - No hay credenciales de Supabase, QStash, Meta ni Gemini (`env` vacío para todas).
> - El proxy de salida **bloquea** `developers.facebook.com`, `docs.360dialog.com` y
>   `dualhook.com`.
>
> La documentación de Meta se contrastó mediante **fuentes secundarias** (resultados de búsqueda
> que citan la referencia oficial y dos repositorios públicos que corrigieron el mismo
> problema). Ninguna consulta a producción se ejecutó: se entregan listas para correr.

---

## 0. Hallazgo principal: DuLabs no lee los ecos de Coexistence

**Qué hace el código.** `app/webhook-dulabs/route.ts` busca los ecos en
`value.smb_message_echoes` (tipo en `:179`, lectura en `:626`). Ese nombre de campo existe
desde el commit inicial del webhook (`62a900b`) y nunca cambió
(`git log -S "smb_message_echoes"`).

**Qué envía Meta**, según la referencia `smb_message_echoes webhook reference` citada por los
resultados de búsqueda:
- `field = "smb_message_echoes"` en `changes[]`;
- el arreglo va en **`value.message_echoes[]`**, no en `value.smb_message_echoes[]`;
- cada eco trae `from` (número del negocio), `to` (cliente), `id` (wamid), `timestamp`, `type`
  y el contenido.

Dos proyectos públicos corrigieron exactamente este fallo:
[property-agent-mini#8](https://github.com/ltx1018ltx-creator/property-agent-mini/pull/8)
("Real Meta `smb_message_echoes` webhooks deliver items in `value.message_echoes`, which the
previous parser missed") y
[tg_motors_erp_monterito#10](https://github.com/drivemediasas/tg_motors_erp_monterito/pull/10)
(la detección de la administradora "never triggered").

**Consecuencia en DuLabs (derivada del código):**
1. Para un cambio `smb_message_echoes`, `ecos` queda vacío.
2. No se registra el mensaje `manual` ni se activa la pausa de 30 min.
3. `procesarCambio` termina sin hacer nada.
4. El respaldo `messages` con `from == display_phone_number` no aplica, porque los ecos no llegan
   en `messages`.

Es decir: **la pausa por eco de Coexistence probablemente nunca funcionó en producción, para
ningún tenant.**

**Estado: VERIFICADO en código · corroborado por fuentes secundarias · NO VERIFICADO con un
payload real.** La consulta C5 (§8) lo confirma o descarta en producción sin tocar nada.

**Impacto sobre la arquitectura:**
- PB **no puede** apoyarse en el manejador compartido de ecos. Tampoco en sus efectos: el log
  `manual` y la pausa compartida.
- PB interpreta el eco por su cuenta, dentro de su módulo, leyendo `value.message_echoes`.
  Por tolerancia también lee `value.smb_message_echoes` y `messages` con `from == display`.
- **No** se corrige el manejador global en esta fase: sería un cambio global (ver §10, que
  explica por qué arreglarlo **agrava** el riesgo del cron).

---

## 1. Coexistence: CLIENTE frente a ASESORA frente a IA

| | CLIENTE → NEGOCIO | ASESORA → CLIENTE (app Business) | IA → CLIENTE (API de DuLabs) |
| --- | --- | --- | --- |
| Campo del webhook (`changes[].field`) | `messages` | `smb_message_echoes` | ninguno (solo `statuses` del mensaje) |
| Arreglo en `value` | `messages[]` | **`message_echoes[]`** | `statuses[]` |
| `from` | wa_id del cliente | número del negocio | — |
| `to` | (no viene) | wa_id del cliente | `statuses[].recipient_id` = cliente |
| `metadata.phone_number_id` | el del número de PB | el del número de PB | el del número de PB |
| `id` | wamid entrante | wamid del mensaje de la asesora | wamid que devolvió la API al enviar |
| `contacts[]` | sí (nombre de perfil) | no documentado | no |
| Relación con la conversación | `(phone_number_id, from)` | `(phone_number_id, to)` | `(phone_number_id, recipient_id)` |
| Fuente | Código (`route.ts`) + documentación | Fuentes secundarias (§0) | Comentario del código (`route.ts:621`) + descripción oficial ("mensajes que el negocio envía **con la app**") |

**Campos que permiten diferenciarlos sin ambigüedad:**
1. `changes[].field` (`messages` frente a `smb_message_echoes`).
2. La presencia de `value.message_echoes`.
3. `from` igual al número del negocio.

Los mensajes de la IA **no** deberían llegar como eco; aun así, PB los reconoce por
`wamid` y hash del texto (§3).

**NO VERIFICADO** (se cierra con la prueba P1–P6 de §9):
- que la app de Meta esté suscrita al campo `smb_message_echoes`;
- WhatsApp Web y dispositivos vinculados: si generan eco y con qué forma;
- que la API **nunca** genere eco;
- `to` del eco igual a `from` del entrante;
- el campo `timestamp`, el orden y la latencia;
- ecos de ediciones o de mensajes eliminados.

---

## 2. `smb_message_echoes` en el sistema actual

| Pregunta | Respuesta | Estado |
| --- | --- | --- |
| ¿Se procesa? | El cambio entra (`route.ts:460` deja pasar el campo) y llega a `procesarCambio`, pero busca la clave equivocada → **no produce nada** | VERIFICADO (código) |
| Payload que recibe | Según fuentes secundarias: `value = {messaging_product, metadata:{display_phone_number, phone_number_id}, message_echoes:[{from, to, id, timestamp, type, text/…}]}` | NO VERIFICADO (payload real) |
| Remitente | `message_echoes[].from` = número del negocio | Documentado (secundario) |
| Destinatario | `message_echoes[].to` = cliente | Documentado (secundario) |
| `phone_number_id` | `value.metadata.phone_number_id` | VERIFICADO (el código ya lo usa para enrutar) |
| `wamid` | `message_echoes[].id` | Documentado (secundario) |
| ¿Se guarda en BD? | En teoría `dulabs_mensajes_log` con `origen='manual'` (`route.ts:637`); en la práctica **no**, por la clave equivocada | VERIFICADO (código); confirmar con C5 |
| Web frente a teléfono | Sin evidencia en el repositorio | **NO VERIFICADO** |
| Tests, fixtures o logs | **Ninguno** en el repositorio (`smb_message_echoes` aparece solo en `route.ts`) | VERIFICADO |
| Suscripción | `POST /{waba}/subscribed_apps` sin campos (`meta-callback/route.ts:229`): los campos se eligen en el panel de la app de Meta | NO VERIFICADO (panel) |

---

## 3. Diferenciar IA de asesora

Criterio de PB para un eco (`ecos.ts`, diseño):

```
eco.id ∈ dulabs_pb_envios.wamid                                → PROPIO (IA)
(REVISADO en §23: el hash del texto ya no decide; solo cuenta el wamid)
cualquier otro caso, o error al consultar                      → HUMANO
```

**Base:**
- Meta describe el eco como "mensajes que el negocio envía **usando la app WhatsApp Business**".
- El comentario del código (`route.ts:621`) afirma que los envíos por la API llegan solo como
  `statuses`.
- Protección que ya existe: si Meta repitiera un `wamid` de la API, `registrarMensaje` choca
  con el `UNIQUE`.

**Estado: DISEÑADO · NO VERIFICADO con payload real.** La prueba P4 (§9) usa un envío por API
desde el Inbox de DuLabs a un teléfono interno y confirma si llega o no un eco, **sin que PB
envíe nada**.

---

## 4. Señales de "humano activo": cuáles son confiables

| Señal | Qué es | Confiabilidad real | Rol |
| --- | --- | --- | --- |
| **S1** Eco detectado por PB | Parser propio de `message_echoes` | La **única** forma en que DuLabs se entera de que la asesora escribió desde el teléfono. Depende de que Meta entregue el eco (suscripción, latencia). **Punto único de detección** → por eso la Fase 0 existe. | **Detección primaria** |
| **S2** Pausa compartida (`dulabs_pausas_chat`) | Lectura fail-closed | Hoy solo la alimenta el Inbox "tomar" (los ecos no escriben, §0). Útil si alguien toma el chat desde DuLabs. | Complementaria |
| **S3** Estado propio de PB (`control`) | Fila transaccional con CAS y `epoch` | Confiable: la escribe solo PB, dentro de transacciones, y no caduca. | **Autoridad** |
| **S4** Pre-autorización atómica | `select … for update` + checks + reserva del envío | Confiable **dado** S3: es el punto de linealización frente a S1. | **Última barrera** |
| ~~Log `manual`~~ | Registro del manejador compartido | **Descartada**: la alimenta el mismo manejador roto (§0) y sería redundante con S1. | — |
| S5 (a descubrir) `statuses` de wamids ajenos | ¿Meta envía `statuses` de mensajes escritos en la app? | Desconocido | El modo sombra lo **mide**. Si existe, sería una segunda señal independiente. |

Reglas añadidas por la verificación:
- **Toda señal humana es pegajosa.** Si S2 (o S5) encuentra evidencia humana, PB pasa a
  `HUMAN_ACTIVE`. Así, si alguien borra la pausa compartida, PB no se reactiva.
- **Doble intento de S1.** El eco se procesa de forma **síncrona en `POST()` antes del 200** y otra
  vez en `after()`. Es idempotente por `wamid` del eco. Así, una muerte de `after()` no pierde el
  eco.

---

## 5. Carrera IA ↔ asesora: análisis y mínima arquitectura

**Modelo.** La asesora envía en `t_h`; Meta entrega el eco en `t_h + L`, donde `L` es la latencia
del eco. PB autoriza su envío en `t_a`.
- Si `t_h + L ≤ t_a` → S4 rechaza el envío. **Garantizado.**
- Si `t_a − L < t_h < t_a` → DuLabs no puede saberlo en `t_a`: la respuesta sale.

La ventana peligrosa mide **L**, y solo existe mientras PB está en `AI_ACTIVE`. Después del
handoff no hay carrera posible.

| Mecanismo | ¿Reduce la ventana? | Veredicto |
| --- | --- | --- |
| Lock de conversación / lease / reserva de turno | No (evita dos turnos de la IA, no el eco tardío) | Se mantiene, por concurrencia |
| Estado atómico + transacción pre-envío (S4) | Lleva nuestro lado a ~0 ms; lo que queda es `L` | **Se mantiene: núcleo** |
| Eco síncrono en `POST()` | Quita la demora de `after()` en nuestro lado | **Se adopta** |
| Outbox (cola de envío) | No: agrega latencia sin cerrar `L` | Descartado (la reserva en `dulabs_pb_envios` ya da idempotencia) |
| Retraso controlado antes de enviar | **No**: desplaza la ventana, no la achica (sigue midiendo `L`) | Descartado como mitigación; se deja el parámetro en 0 |
| Confirmación de estado tras el envío | No evita el envío | Se usa para **medir** (abajo) |
| Cancelar o borrar el mensaje enviado | La Cloud API no ofrece revocar un mensaje de negocio (**NO VERIFICADO**; no se diseña con eso) | Descartado |
| Cancelar Gemini al detectar humano | No achica la ventana; ahorra costo | Opcional (poll del estado cada 2 s durante la llamada) |
| Menos envíos de la IA por conversación | Reduce las **oportunidades** (hay una ventana por envío) | Se adopta: pedir tipo + nombre en la bienvenida; sin mensajes intermedios |
| Protocolo operativo de la asesora ("si vas a intervenir, escribe; la IA calla al instante") | Reduce la probabilidad | Se adopta: runbook |

**Medición obligatoria (modo sombra y producción):**
- `L = llegada − eco.timestamp` (con precisión de segundos, que es la de Meta);
- métrica **`race_collision`**: un eco humano con `timestamp ≤ enviado_at` de un envío de PB en la
  misma conversación durante `AI_ACTIVE`. Cuenta cuántas veces ocurre de verdad.

**Conclusión honesta:**
- La arquitectura garantiza que **ningún** envío sale después de que DuLabs registró la
  intervención humana.
- Lo único que no puede garantizar es un eco que Meta todavía no entregó.
- El peor caso es **un** mensaje de plantilla (una pregunta) que coincide con el primer mensaje
  de la asesora. Desde ese eco, silencio permanente.
- Si `race_collision` resulta relevante en la medición, se reevalúa con datos.

---

## 6. Modo sombra

**Objetivo:** observar tráfico real del número sin llamar a Gemini ni enviar nada.

```
Webhook → dispatcher (el número es de PB, modo 'sombra') → normalizar → dulabs_pb_observaciones → FIN
                                                      (sin buzón, sin turno, sin Gemini, sin Meta)
```

**Qué registra (`dulabs_pb_observaciones`, una fila por elemento del payload):**

| Campo | Contenido | Privacidad |
| --- | --- | --- |
| `recibido_at` | Hora de llegada (ms) | — |
| `ruta` | `post_sync` / `after` (qué gancho lo vio) | — |
| `field` | `messages` / `smb_message_echoes` / otro | — |
| `clave_arreglo` | `messages` / `message_echoes` / `smb_message_echoes` / `statuses` | **Confirma la clave real** |
| `claves_value` | Nombres de las claves de primer nivel de `value` (sin valores) | Sin PII |
| `wamid` | id del elemento | Identificador técnico |
| `tipo` | text / interactive / image / audio / … / status | — |
| `rol_from` | `negocio` / `cliente` / `ausente` | Sin el número |
| `chat_ref` | `hmac_sha256(pepper, phone_number_id + ':' + wa_id)` del cliente (`from` o `to`) | Seudónimo con pepper (env `PB_HASH_PEPPER`); permite comprobar que `to` del eco = `from` del cliente |
| `meta_ts` | `timestamp` de Meta | — |
| `latencia_ms` | `recibido_at − meta_ts` | — |
| `duplicado` | `true` si el `wamid` ya se vio en esta ruta | Unique `(wamid, ruta, clave_arreglo)` |
| `status` / `status_propio` | Para `statuses`: estado y si el `wamid` es de un envío conocido | Mide S5 |
| `longitud_texto` | Largo del texto (sin el texto) | Sin contenido |

**No se guarda:** texto, nombre de perfil, número de teléfono en claro ni ids de media.

**Retención:** hasta cerrar la Fase 0, con un tope de 30 días. Luego se borra la tabla o sus
filas.

**Métricas que responden la hipótesis:**
- conteo por `clave_arreglo` (¿`message_echoes`?);
- ecos con `rol_from = negocio` agrupados por `chat_ref` coincidente con un `chat_ref` de cliente;
- percentiles p50/p95/p99 de `latencia_ms` en ecos y en entrantes;
- duplicados;
- `statuses` con `status_propio = false` (S5);
- orden de llegada por `chat_ref`.

**Efecto de negocio del modo sombra:** con el número en `ia_pausada = true` y PB en sombra,
**nadie responde automáticamente**; la asesora atiende todo a mano, como en un teléfono
normal. Hay que confirmar si hoy algún bot responde en ese número (C1–C3); si lo hace, la sombra
lo apaga.

## 7. Cómo se activa el modo sombra (sin hardcodear el número)

Dos llaves, ambas necesarias:

| Llave | Dónde | Valores | Rol |
| --- | --- | --- | --- |
| `PUBLIBORDADOS_ENABLED` | Variable de entorno (Vercel) | ausente/`false` (defecto) · `true` | Interruptor maestro: en `false`, el dispatcher devuelve "no es de PB" para **todo** número sin leer ninguna tabla. El despliegue del código es inerte. |
| `dulabs_pb_config.modo` | Fila por `phone_number_id` | `apagado` · `sombra` · `qa` · `activo` | Qué hace PB en **ese** número |

- El `phone_number_id` solo existe en la fila de configuración, que se inserta por SQL del runbook
  en producción.
- El código y los tests usan IDs sintéticos; un test de CI busca números reales en
  `lib/publibordados`.
- Si `PUBLIBORDADOS_ENABLED = false` o no hay fila, el número de PB sigue en el camino
  existente, que calla por `ia_pausada = true`.

---

## 8. Estado actual del número: consultas de solo lectura (NO EJECUTADAS)

Ejecutar en el SQL Editor de Supabase de producción, **solo `select`**. Reemplazar `:pid` por el
`phone_number_id` obtenido en C1. Ninguna consulta devuelve secretos: solo booleanos.

```sql
-- C1. Fila del número (sin secretos)
select id_tenant, phone_number_id, nombre_negocio, telefono_negocio, estado_conexion,
       ia_pausada, ia_restringida_a, flow_activo, flow_id, trigger_routing_activo,
       captura_leads, forward_to_dumo, marketplace_activacion_id,
       prompt_sistema is null            as prompt_null,
       coalesce(length(prompt_sistema),0) as prompt_len,
       meta_permanent_token is not null  as tiene_token_propio,
       api_key_ia is not null            as tiene_api_key_ia,
       whatsapp_business_account_id,
       coalesce(array_length(string_to_array(ia_numeros_bloqueados, ','),1),0) as bloqueados
from dulabs_clientes_config
where telefono_negocio like '%3012913038%' or nombre_negocio ilike '%publi%';
-- (si ia_numeros_bloqueados no es texto separado por comas, quitar esa columna)

-- C2. ¿Otros números del mismo tenant? ¿Tenant histórico "Publibordados" de Flow?
select phone_number_id, nombre_negocio, flow_activo, estado_conexion
from dulabs_clientes_config where id_tenant = (select id_tenant from dulabs_clientes_config where phone_number_id = :pid);

-- C3. ¿Algún motor configurado para el número?
select 'agente_runtime' m, count(*) from dulabs_agente_runtime_config where phone_number_id = :pid
union all select 'survey_config',   count(*) from dulabs_survey_bot_config    where phone_number_id = :pid
union all select 'survey_sessions', count(*) from dulabs_survey_sessions      where phone_number_id = :pid
union all select 'campaign_bot',    count(*) from dulabs_campaign_bot_config  where phone_number_id = :pid
union all select 'campaign_leads',  count(*) from dulabs_campaign_leads       where phone_number_id = :pid
union all select 'onboarding',      count(*) from dulabs_onboarding_sesiones  where phone_number_id = :pid
union all select 'especialistas',   count(*) from dulabs_especialistas        where phone_number_id = :pid
union all select 'pausas_vigentes', count(*) from dulabs_pausas_chat          where phone_number_id = :pid and pausado_hasta > now();
-- (si alguna tabla no tiene phone_number_id, la consulta falla en esa línea: quitarla y anotarlo)

-- C4. ¿Quién responde hoy en ese número? (últimos 30 días)
select direccion, origen, count(*), max(created_at)
from dulabs_mensajes_log where phone_number_id = :pid and created_at > now() - interval '30 days'
group by 1,2 order by 1,2;

-- C5. ¿Funcionan los ecos en ALGÚN número? (confirma o descarta el hallazgo §0)
select phone_number_id, count(*) as manuales_con_wamid, max(created_at)
from dulabs_mensajes_log
where origen = 'manual' and direccion = 'saliente' and wamid like 'wamid.%'
  and created_at > now() - interval '90 days'
group by 1 order by 2 desc;
-- 0 filas en números donde el dueño responde desde el teléfono ⇒ los ecos no se procesan.
-- (origen 'manual' también lo escriben la agenda y las reservas: revisar qué phone_number_id aparece)

-- C6. ¿El cron seguimiento-traspaso envió alguna vez? ¿A qué números?
select phone_number_id, count(*), min(created_at), max(created_at)
from dulabs_mensajes_log
where direccion = 'saliente' and contenido like 'Te pedimos disculpas 💗 Dani se encuentra ocupada%'
group by 1 order by 2 desc;

-- C7. Plan y cupo del tenant
select * from dulabs_suscripciones where id_tenant = :tenant;   -- revisar plan y estado
select phone_number_id, mensajes_usados_mes, mes_actual from dulabs_clientes_config where id_tenant = :tenant;
```

**Comprobaciones fuera de la BD:**

| # | Dónde | Qué |
| --- | --- | --- |
| V1 | Panel de la app de Meta → WhatsApp → Configuración → Webhooks | Si están marcados `messages`, `smb_message_echoes`, `history` y `smb_app_state_sync`; y la URL de callback |
| V2 | WhatsApp Manager → número de PB | Que sea Coexistence (`platform_type`) y el estado del número |
| V3 | Vercel → variables de entorno | `DUMO_PHONE_NUMBER_ID` no incluye el `:pid` de PB; existencia de `GEMINI_KEY_PUBLIBORDADOS` (se creará) |
| V4 | Consola de Upstash QStash → Schedules (o `curl -H "Authorization: Bearer $QSTASH_TOKEN" https://qstash.upstash.io/v2/schedules`) | Si algún schedule apunta a `/api/cron/seguimiento-traspaso`, con qué cron y desde cuándo |
| V5 | Logs de Vercel (búsqueda) | `[webhook-dulabs] eco de coexistencia` (nunca debería aparecer si §0 es cierto) y `AI_RESPONSE_BLOCKED_HUMAN_TAKEOVER` |

---

## 9. Plan de prueba real de Coexistence (modo sombra, sin respuestas)

**Precondiciones:**
- C1–C4 revisadas;
- `ia_pausada = true` en el número;
- PB desplegado con `PUBLIBORDADOS_ENABLED = true` y `modo = 'sombra'`;
- 2 teléfonos internos (T1, T2) que **no** son clientes;
- la asesora con el teléfono del negocio y WhatsApp Web abierto.

| # | Acción | Qué se espera en `dulabs_pb_observaciones` | Hipótesis que cierra |
| --- | --- | --- | --- |
| P1 | T1 escribe "hola" | `field=messages`, `clave_arreglo=messages`, `rol_from=cliente`, `chat_ref=A` | Entrada del cliente |
| P2 | La asesora responde a T1 **desde el teléfono** | `field=smb_message_echoes`, `clave_arreglo=message_echoes`, `rol_from=negocio`, `chat_ref=A`, latencia medida | §0, `to` = `from`, forma del eco |
| P3 | La asesora responde a T1 **desde WhatsApp Web** | Igual que P2 (o nada) | Web y dispositivos vinculados |
| P4 | Un operador envía a T1 **desde el Inbox de DuLabs** (envío por API) | Solo `statuses` con `status_propio`; **ningún** eco | La API no genera eco |
| P5 | La asesora escribe **primero** a T2 (chat nuevo) | Eco con `chat_ref=B` sin entrada previa | Chat iniciado por el negocio |
| P6 | La asesora edita y luego borra un mensaje | Qué llega (eco de edición o eliminación, o nada) | Tipos de eco raros |
| P7 | T1 envía foto, audio y documento | `tipo` correcto; sin texto guardado | Media |
| P8 | T1 envía 3 mensajes en 1 s | Orden por `meta_ts`, sin pérdida | Ráfaga |
| P9 | Esperar 24 h | Reentregas o duplicados de Meta | Duplicados reales |
| P10 | Revisar `statuses` de mensajes de la asesora | ¿Existe S5? | Segunda señal |

**Criterio de cierre de la Fase 0:**
- P2 y P4 pasan;
- `to` = `from` en el 100 % de los casos;
- se conoce la p95 de la latencia del eco;
- P3 queda documentada (si Web no genera eco, pasa a ser **riesgo bloqueante** y se decide
  operativamente que la asesora use solo el teléfono).

---

## 10. Cron `seguimiento-traspaso`

| Pregunta | Respuesta | Estado |
| --- | --- | --- |
| Dónde se define | `app/api/cron/seguimiento-traspaso/route.ts` (`GET`/`POST`) | VERIFICADO |
| ¿Programado? | No está en `vercel.json` ni en `.github/workflows` (no existe esa carpeta); su comentario dice "NO wired a ningún schedule de QStash" | VERIFICADO (repositorio) · **NO VERIFICADO** (QStash: V4; evidencia histórica: C6) |
| Quién puede ejecutarlo | QStash firmado o `Bearer $CRON_SECRET` (comparación en tiempo constante y fail-closed desde el Bloque 18) | VERIFICADO |
| Frecuencia prevista | "cada ~2–3 minutos" (comentario) | VERIFICADO (intención) |
| Consulta | `dulabs_pausas_chat` con `seguimiento_enviado = false`, `pausado_desde <= now()−5 min` y `pausado_hasta > now()` | VERIFICADO |
| Filtro por tenant o número | **Ninguno** (`soloPhoneNumberId` solo en tests) | VERIFICADO |
| Destinatarios | El cliente de cada fila, enviado con el token del número de esa fila | VERIFICADO |
| Mensaje | "Te pedimos disculpas 💗 Dani se encuentra ocupada en este momento, pero apenas tenga el espacio estará respondiéndote." | VERIFICADO |
| ¿Incluye a PB? | Solo si existe una fila de pausa para un chat de PB. PB **no** escribe pausas (ADR-04). Los ecos hoy **tampoco** (§0). Solo el Inbox "tomar" sobre un chat de PB la crearía. | VERIFICADO (código) |

**Riesgo:** si el cron está programado y alguien usa "tomar" en el Inbox sobre un chat de PB, 5
minutos después el cliente recibe el mensaje de "Dani". Pasa lo mismo, hoy, con **cualquier**
tenant.

**Impacto:** un mensaje incorrecto, con nombre de otra persona, al cliente de PB. Si alguien
corrige el fallo global de ecos (§0), el riesgo se vuelve **automático**: cada mensaje de la
asesora produciría el mensaje de "Dani" 5 minutos después, en todos los tenants con
Coexistence.

**Solución mínima (solo si V4 o C6 demuestran que está activo, o antes de corregir §0):**
- filtro opt-in explícito de `phone_number_id` en el cron (env o tabla), vacío → no envía;
- se inicializa con los números de Daniela;
- se prueba con el patrón existente `route.test.ts` (`soloPhoneNumberId`).

**Impacto sobre otros tenants:** los números de la lista, idéntico; los demás dejan de recibir un
mensaje que no les corresponde. Es un cambio global que **requiere tu aprobación**.

**Mientras tanto:** el runbook de PB prohíbe usar "tomar" del Inbox en el número de PB. PB no
lo necesita: la asesora trabaja desde el teléfono.

---

## 11. Mapa de gates: dónde puede responder algo con `ia_pausada = true`

Recorrido real de un mensaje del número de PB, **hoy**, sin PB:

```
POST /webhook-dulabs
 ├─ firma · JSON
 ├─ [R1] reenvío a DuMo ────────────────────────── ⚠ si forward_to_dumo = true o :pid ∈ DUMO_PHONE_NUMBER_ID (DuMo es externo y puede responder)
 ├─ history → DuMo (solo si hay reenvío)
 ├─ registro síncrono del entrante (sin respuesta)
 └─ after(procesarCambio)
     ├─ cliente por phone_number_id · desconectado → fin
     ├─ ecos (clave equivocada, §0) · statuses · citas (sin respuesta)
     ├─ ★ PUNTO ELEGIDO PARA PB (inicio de procesarCambio, tras resolver el cliente)
     ├─ filtro de tipos (descarta media en números sin Flow, y list_reply)
     ├─ pedidos del catálogo (registra, no responde)
     └─ atenderMensaje
         ├─ procesado_at (dedupe)
         ├─ lista negra → silencio
         ├─ [R2] AMORE migración ─────────────────── ⚠ responde, pero solo si :pid == 305754644951780 (constante)
         ├─ [R3] encuesta ────────────────────────── ⚠ responde si hay sesión (dulabs_survey_sessions del :pid y teléfono)
         ├─ [R4] campaña ─────────────────────────── ⚠ responde si hay lead (dulabs_campaign_leads del :pid y teléfono)
         ├─ [R5] Soluciones Financieras ──────────── ⚠ responde, pero solo si :pid == 1248901801649972 (constante)
         ├─ [R6] onboarding ──────────────────────── ⚠ responde si hay sesión (dulabs_onboarding_sesiones del :pid y teléfono)
         ├─ ia_pausada = true → SILENCIO  ◄── todo lo de abajo queda bloqueado
         ├─ ia_restringida_a · pausa humana · cupo · ráfaga · candado
         ├─ lib/agente (fila en dulabs_agente_runtime_config)
         ├─ Flow / Business Agent (flow_activo)
         └─ legacy / agenda / especialistas / Daniela / captura_leads

Fuera del webhook (crons que envían por su cuenta):
   seguimiento-traspaso (§10) · encuestas-seguimiento · comunicaciones · cumpleaños · fidelización ·
   recordatorios-citas · seguimiento-inactividad-solotalento (constante propia)
   → todos requieren configuración por tenant o número; se verifica con C3 y el runbook.
```

**Conclusión:**
- `ia_pausada = true` **no** bloquea R1, R3, R4 y R6, porque corren antes (R2 y R5 son imposibles
  salvo coincidencia de constantes, que se descarta con C1).
- Con PB en el punto ★, R2–R6 **nunca** corren para el número de PB.
- R1 (DuMo) corre en `POST()`, **antes** del punto ★: exige la invariante
  `forward_to_dumo = false` y que el número no esté en `DUMO_PHONE_NUMBER_ID` (V3).
- Si PB queda "indeterminado", el camino existente solo puede responder por R3, R4 o R6 si hay
  datos: C3 debe dar 0.

---

## 12. Ubicación del dispatcher: decisión técnica

**Punto elegido:** dos ganchos que llaman a la misma función idempotente.
- **E (eco, síncrono):** en `POST()`, dentro del bucle de `changes`, para `field ∈ {messages,
  smb_message_echoes}`, **antes** de programar `after()`. Solo registra ecos del número de PB
  (`pb_marcar_humano`); nunca lanza y nunca cambia el 200. Tiene un plazo propio de 2 s.
- **B (cambio completo, diferido):** primera instrucción de `procesarCambio` tras resolver el
  cliente y el estado de conexión: `if (await despacharCambioPublibordados(cliente, value,
  wabaId)) return;`. Para un número de PB, PB procesa todo el cambio:
  - mensajes de clientes, incluidos media, `button_reply` y `list_reply`, sin filtrar;
  - ecos (segundo intento, idempotente);
  - `statuses` de sus envíos.

**Motivo (verificado en código):** en el punto B tenemos
- el cliente completo (`select *`), el `value` crudo con `messages`, `message_echoes`,
  `statuses`, `contacts` y `metadata`, y el `wabaId`;
- **ningún** mensaje descartado todavía (el filtro de tipos está después);
- **ningún** motor activado: pedidos, encuestas, campañas y onboarding están después;
- **ninguna** respuesta enviada;
- el registro síncrono del texto entrante ya ocurrió (el Inbox lo ve).

El gancho E da durabilidad al eco (antes del 200) y la menor latencia posible en nuestro lado.

**Riesgos:**
1. Para el número de PB, PB debe replicar la actualización de `estado_entrega` de sus propios
   envíos en `dulabs_mensajes_log` (hoy en `actualizarEstadoEntrega`, función local del route):
   duplicación pequeña y deliberada.
2. El gancho E suma una lectura de propiedad por cambio de `messages` o `smb_message_echoes` de
   **todos** los tenants. Tiene caché de 30 s y, con `PUBLIBORDADOS_ENABLED = false`, cero
   lecturas.
3. R1 (DuMo) sigue antes: se cubre con la invariante.

**Por qué no los otros puntos:**

| Punto | Motivo del descarte |
| --- | --- |
| `route.ts:1038` (junto a `lib/agente`) | La media y `list_reply` ya se descartaron; R3, R4 y R6 ya pudieron responder; el freno de ráfaga descarta mensajes; el candado espera hasta 20 s; el cupo silencia; el eco (§0) nunca llegaría. |
| Inicio de `atenderMensaje` | La media ya se descartó; `procesado_at` ya se marcó con la semántica compartida. |
| Dentro del bucle de mensajes (propuesta anterior del `02`) | El `return` anticipado de ecos (`route.ts:652`) puede descartar un lote mixto; no ve `message_echoes`. |
| Todo en `POST()` | El turno (Gemini) necesita `after()`; duplicaría la resolución del tenant y alargaría el 200 de todos. |

---

## 13. Botones: límites verificados

| Límite | Fuente | Estado |
| --- | --- | --- |
| Máximo 3 botones de respuesta | Comentario del wrapper (`whatsapp-outbound.ts:153`) y límite conocido de Meta | VERIFICADO (código) / documentación de Meta **no accesible** desde aquí |
| Título ≤ 20 caracteres | El wrapper recorta con `slice(0,20)` en **unidades UTF-16** | VERIFICADO |
| El wrapper **no** valida la cantidad de botones, la unicidad ni el largo del id | Código de `enviarBotones` | VERIFICADO |
| Solo dentro de la ventana de 24 h | Comentario del wrapper | VERIFICADO (código) |

Medición de los títulos elegidos (unidades UTF-16 / puntos de código):
- `🧢 Gorras` 9/8
- `👕 Prendas de vestir` **20**/19 (justo en el límite: el recorte no lo corta)
- `➕ Más opciones` 14/14
- `🦺 Uniformes` 12/11
- `🧵 Otros` 8/7
- `↩️ Volver` 9/9
- `Persona natural` 15
- `Empresa` 7

**Decisión:**
- Se usa `enviarBotones` **sin modificarlo**.
- PB valida antes de llamarlo, con una función pura: ≤ 3 botones, títulos únicos de ≤ 20
  unidades UTF-16, ids únicos `pb1:*` de ≤ 64 caracteres y cuerpo ≤ 1024.
- No se toca el soporte global de botones ni de `list_reply`.

---

## 14. Handoff: caso A y caso B

| | Caso A: termina la calificación | Caso B: la asesora interviene antes |
| --- | --- | --- |
| Disparador | 4 datos válidos → `READY_FOR_HANDOFF` | Eco humano (S1), o S2/S5 |
| Transición | `pb_ejecutar_handoff`: `HUMAN_ACTIVE` + reserva del mensaje final (atómico) | `pb_marcar_humano`: `HUMAN_ACTIVE`, `epoch + 1` |
| Mensaje | "En un momento uno de nuestros asesores te atenderá. 😊" | **Ninguno** (la asesora ya está hablando) |
| Datos | Completos + segmento | Parciales: lo recopilado queda guardado |
| Turno en curso | — | Su envío lo rechaza S4 (`control` + `epoch`) |
| Etapa | `HANDED_OFF` | Queda la última etapa (para el reporte); **no importa**: el control manda |

La intervención humana tiene prioridad absoluta: `control` se evalúa antes que la etapa en
todas las rutas.

## 15. `HUMAN_ACTIVE` no caduca y la devolución a la IA

- No hay columna de vencimiento. Ningún mensaje del cliente, ningún tiempo y ninguna pausa
  compartida lo revierten.
- **"Devolver a IA" hoy** (`app/api/dashboard/conversaciones/handoff/route.ts:146`): borra la fila
  de `dulabs_pausas_chat` y registra `liberado`.
- `dashboard/negocio` (`:141`) y `dashboard/cuenta` (`:50`) borran **todas** las pausas del número.
- Ninguno toca tablas de PB. **VERIFICADO: no pueden reactivar PB.** Con la regla "señal humana
  pegajosa" (§4), ni siquiera el borrado de una pausa que PB ya vio lo reactiva.
- Devolución en V1: solo `pb_devolver_a_ia(conv, actor, motivo)` (RPC con `service_role`, desde
  el runbook, evento `returned_to_ai`).

## 16. Cliente que regresa (día 30)

La conversación sigue en `HUMAN_ACTIVE`. PB:
- registra la entrada (buzón y traza `silenced_human`);
- no llama a Gemini ni envía;
- marca `procesado_at`;
- si pasaron más de 7 días desde la última actividad, deja el evento `customer_returned`
  (reporte).

La asesora lo ve en su teléfono. Reactivar la IA exige `pb_devolver_a_ia`.

## 17. Foto, audio y documento (V1)

| Entrada | `AI_ACTIVE` | `HUMAN_ACTIVE` |
| --- | --- | --- |
| imagen, audio, documento, video | 1) registro en `dulabs_mensajes_log` (entrante, contenido fijo `[imagen]`/`[audio]`/`[documento]`/`[video]`, `wamid`, marca `procesado_at`); 2) buzón con `media_tipo`; 3) **handoff** `media_recibida` con el mensaje final | 1) y 2); sin respuesta |
| sticker, reacción | Registro `[sticker]`; sin respuesta (las reacciones no se registran) | Igual |
| ubicación, contacto o tipo desconocido | Registro `[ubicación]`/`[contacto]`/`[mensaje]` + handoff | Registro |

Detalles:
- Nunca se pasa a Gemini.
- No se guarda el pie de foto ni el id del archivo.
- Hoy el registro síncrono **no** guarda media en números sin Flow; PB lo hace para su número
  (idempotente por `wamid`), así el Inbox de DuLabs también lo muestra. La asesora lo ve siempre
  en su teléfono.

## 18. Arquitectura de autoridad

```
                    ┌──────────────────────────────┐
                    │ dulabs_pb_conversaciones     │
                    │ control · epoch · version    │  ← AUTORIDAD (BD + reglas del backend)
                    └──────────────┬───────────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              │                                         │
          AI_ACTIVE                                HUMAN_ACTIVE
              │                                         │
   Gemini INTERPRETA (no decide)                 IA BLOQUEADA
   backend valida y decide                       (sin Gemini, sin envío)
   pre-autorización atómica                            │
              │                                         ▼
              ▼                                      ASESORA
   Meta (plantilla del backend)

   Señales que solo pueden MOVER hacia HUMAN_ACTIVE: eco (S1) · pausa compartida (S2) · S5
   Única salida de HUMAN_ACTIVE: pb_devolver_a_ia (explícita, auditada)
   NO son autoridad: la IA · el historial textual · el modelo · la pausa compartida
```

Criterio operativo: **"no sabemos" ⇒ no responder**. Nunca inventar. Nunca caer a legacy.

## 19. Decisiones de negocio aplicadas (V1)

| Tema | Regla |
| --- | --- |
| Tipo | Persona natural / Empresa (botones + texto) |
| Nombre | "¿Cuál es tu nombre?" (sin pregunta aparte por la empresa) |
| Producto | Gorras / Prendas de vestir / Uniformes / Otros (dos páginas de botones) |
| Cantidad | "¿Cuántas unidades necesitas?" → `>= 6` mayorista, `< 6` detal, ambos al asesor |
| Varios productos | Aclaración sencilla **una vez** ("¿Cuál quieres cotizar primero? Luego el asesor te ayuda con los demás."). Si vuelve a mencionar varios → handoff `varios_productos` |
| Cliente que regresa | Sigue `HUMAN_ACTIVE` (§16) |
| Media | §17 |

---

# Ronda 2 — Cierre de la Fase 0 con evidencia (2026-09-24)

## 20. Qué se pudo ejecutar desde este entorno y qué no

**Comprobado en esta ronda:**
- sin credenciales: `env` no contiene variables de Supabase, QStash, Meta ni Vercel;
- sin salida de red hacia `graph.facebook.com`, `qstash.upstash.io`, `*.supabase.co` ni
  `api.vercel.com` (todas responden `000`); solo `registry.npmjs.org` está permitido.

**Consecuencias:**
- No se ejecutó **ninguna** consulta C1–C7, ni una comprobación en Meta o en QStash. **No hay
  resultados inventados.** Siguen abajo, listas para ejecutar.
- El modo sombra **no se puede activar**: necesita código nuevo (observador), su despliegue y una
  fila en producción. La fase actual prohíbe el primero y el entorno no tiene acceso a los otros
  dos.
- Las pruebas P2–P10 con la asesora necesitan ese observador en producción. **No se ejecutaron.**

**Lo que sí se ejecutó:** pruebas automatizadas sobre el **código real** de
`procesarCambio`, con Supabase en memoria (`lib/testing/supabase-rest-memoria.ts`), Meta
simulado (`lib/testing/meta-graph-mock.ts`) y una guardia que hace fallar cualquier otra salida de
red. El archivo es desechable, fuera del repositorio (scratchpad de la sesión):
`npx tsx --test fase0-routing.test.ts`. Resultado: **11/11 OK**, 0 salidas de red.

| # | Prueba sobre el código real | Resultado |
| --- | --- | --- |
| E1 | Eco con la forma documentada por Meta (`value.message_echoes`) | El manejador compartido **no registra nada ni pausa** |
| E2 | Eco con la forma que asume el código (`value.smb_message_echoes`) | Registra `manual` y pausa 30 min |
| E3 | Respaldo `messages` con `from == display` | Pausa |
| E4 | Mismo eco dos veces | Una sola fila (dedupe por `wamid`) |
| E5 | Eco sobre una pausa de 30 días | **La acorta a 30 min** |
| R1 | `ia_pausada = true`, texto de cliente, sin otros motores configurados | Cero envíos |
| R2 | `ia_pausada = true` + sesión de encuesta activa del cliente | **La encuesta responde** (corre antes de `ia_pausada`) |
| R3 | Imagen en un número sin Flow | Descartada: ni log ni respuesta |
| R4 | `list_reply` | Descartado: ni log ni respuesta |
| I1 | Eco en el número A | No pausa al mismo cliente en el número B |
| Z1 | Guardia de red | Ninguna salida real |

**Qué prueban y qué no:**
- Prueban el comportamiento **del código actual** ante cada forma de payload, y el routing real
  con `ia_pausada`.
- **No** prueban qué forma envía Meta a este número: eso solo lo prueba el payload real (P2).

## 21. Consultas y comprobaciones que debes ejecutar tú (solo lectura)

### 21.1 Supabase (SQL Editor de producción)

C1–C7 del §8 se mantienen tal cual. Se agregan:

```sql
-- C8. ¿Existe ya alguna configuración de PB? (esperado hoy: la tabla no existe → error 42P01 = "no hay PB")
select to_regclass('public.dulabs_pb_config') as tabla_pb;

-- C9. ¿Hay mensajes 'manual' con wamid en el número de PB? (0 = el eco nunca se procesó en ese número)
select count(*) from dulabs_mensajes_log
where phone_number_id = :pid and origen = 'manual' and direccion = 'saliente' and wamid like 'wamid.%';

-- C10. ¿El número coincide con constantes del código? (esperado: ambas false)
select :pid = '305754644951780' as es_amore_migracion, :pid = '1248901801649972' as es_soluciones_financieras;
```

### 21.2 Meta (suscripción real a los ecos)

Con el **Graph API Explorer** (o `curl`), usando un token del sistema del negocio con permiso sobre
la WABA:

```bash
# M1. Campos suscritos por la APP (nivel app): debe aparecer "smb_message_echoes" en fields
curl "https://graph.facebook.com/v23.0/$APP_ID/subscriptions?access_token=$APP_ID|$APP_SECRET"
#   → [{ "object":"whatsapp_business_account", "callback_url":"https://…/webhook-dulabs",
#        "active":true, "fields":[{"name":"messages",…},{"name":"smb_message_echoes",…},…] }]

# M2. ¿La app está suscrita a la WABA de PB? ¿Hay un callback propio de la WABA?
curl "https://graph.facebook.com/v23.0/$WABA_ID/subscribed_apps?access_token=$TOKEN"

# M3. Número: nombre, estado, Coexistence y configuración de webhook
curl "https://graph.facebook.com/v23.0/$PHONE_NUMBER_ID?fields=display_phone_number,verified_name,status,platform_type,is_on_biz_app,webhook_configuration&access_token=$TOKEN"
#   (si algún campo no existe en la versión de la API, Meta lo indica; anotarlo)
```

En la interfaz, **App Dashboard → WhatsApp → Configuración → Webhook**:
- confirmar la URL de callback (`…/webhook-dulabs`) y que esté verificada;
- en "Campos de webhook", que `messages` y `smb_message_echoes` estén en **Suscrito**;
- con el botón **Probar** de `smb_message_echoes`, copiar el **payload de ejemplo** que muestra
  Meta y pegarlo en este documento. Es la forma oficial del eco, aunque no sea un mensaje real.

`phone_number_id` y WABA correctos: M2 y M3 deben coincidir con C1
(`phone_number_id`, `whatsapp_business_account_id`).

### 21.3 QStash

```bash
# Q1. Schedules: ¿alguno apunta a seguimiento-traspaso?
curl -s -H "Authorization: Bearer $QSTASH_TOKEN" https://qstash.upstash.io/v2/schedules \
 | jq '.[] | {scheduleId, cron, destination, isPaused, createdAt}'
# Q2. Si existe: últimas ejecuciones (logs de QStash filtrados por esa URL, en la consola)
```

Respuesta esperada para documentar: programado (sí/no), `cron`, `destination`, `isPaused` y
fecha. C6 lo complementa con evidencia histórica: si alguna vez envió el mensaje de "Dani" y a
qué números.

## 22. Las pruebas P1–P10: qué puede cerrar la Fase 0 y qué no

Hay que separar dos grupos:
- **P1–P5 observan a Meta**: son la verdadera Fase 0 y solo necesitan el **observador** del
  modo sombra.
- **P6–P10 prueban a PB**: la carrera con Gemini, la idempotencia de PB, `HUMAN_ACTIVE`, el
  retorno del cliente y la devolución. **No pueden ejecutarse** hasta que PB exista. Pedirlas
  como salida de la Fase 0 bloquea el proyecto de forma circular.

**Propuesta:** P6–P10 pasan a ser **compuertas de aceptación** obligatorias antes de
`modo = 'activo'` (QA con teléfonos internos). Ningún cliente real recibe un mensaje de PB hasta
que pasen.

| Prueba | Resultado | Evidencia | Riesgo si no se cierra |
| --- | --- | --- | --- |
| P1 cliente → "Hola" | **NO VERIFICADO** (requiere observador) | Código: `messages[]`, `from` = cliente (`route.ts`) | Bajo: es el camino que ya funciona para todos los tenants |
| P2 asesora desde el teléfono | **NO VERIFICADO** | Código: la clave actual no captura ecos (E1); fuentes secundarias: `message_echoes` | **Crítico**: sin esto no sabemos detectar a la asesora |
| P3 asesora desde WhatsApp Web | **NO VERIFICADO** | Ninguna | **Alto**: si Web no genera eco, la asesora debe usar solo el teléfono |
| P4 envío por API (IA) | **NO VERIFICADO** | Comentario del código + descripción de Meta ("mensajes enviados con la app") | Alto: autosilenciamiento o, al revés, falso humano |
| P5 latencia del eco (≥ 10 muestras) | **NO VERIFICADO** | Ninguna | Dimensiona la ventana de carrera |
| P6 carrera real IA/asesora | **NO EJECUTABLE en Fase 0** (PB no existe) | Diseño: RPC atómica + `epoch` (02 §9) | Compuerta de QA |
| P7 duplicado | Parcial: **VERIFICADO** para el manejador actual (E4); para PB, compuerta de QA | E4 | Compuerta de QA |
| P8 asesora antes del handoff | **NO EJECUTABLE en Fase 0** | Diseño: `control` antes que la etapa (02 §9.2) | Compuerta de QA |
| P9 cliente vuelve | **NO EJECUTABLE en Fase 0** | Diseño: sin vencimiento (02 §9.1) | Compuerta de QA |
| P10 devolver a IA | **VERIFICADO en código** | `handoff/route.ts:146` borra solo `dulabs_pausas_chat`; `negocio:141` y `cuenta:50` borran pausas del número; ninguno toca tablas de PB | Bajo |

### 22.1 Cómo se mide P5 y P6 sin esperas artificiales

- **P5** (modo sombra, ≥ 10 repeticiones):
  - la asesora anota la hora de envío `T2` (reloj sincronizado, con precisión de segundos);
  - el observador registra `T3` (llegada, ms) y `eco.timestamp` de Meta;
  - se calcula `echo_latency = T3 − T2` y `T3 − eco.timestamp`, con percentiles p50/p95/máximo.
- **P6** (QA, ≥ 10 repeticiones):
  - PB guarda en la traza `cliente_message_time`, `ai_started`, `ai_generation_finished`,
    `pre_send_check`, `send_attempt` y `send_result`; el gancho E guarda `echo_received` y la
    asesora anota `advisor_message_time`;
  - para que la carrera ocurra de verdad, en QA se usa un **proveedor de IA simulado con una
    latencia configurable** solo para los teléfonos de prueba. No es un `sleep` en el camino de
    producción: fuerza la ventana donde la asesora escribe mientras "Gemini" procesa;
  - criterio: 0 envíos de PB con `send_attempt > echo_received`, y `race_collision` contado y
    reportado.
- **Ninguna espera artificial** en producción. Si P5 muestra una latencia grande, se decide con
  esos datos.

## 23. P4: distinguir IA de asesora sin usar el texto

Se acepta el requisito: **el hash del texto no es autoridad**. Diseño revisado:

1. **Registro propio estructural:** cada envío de PB queda en `dulabs_pb_envios` con el `wamid`
   que devuelve la API (`messages[0].id`). Es la única prueba de "lo envió DuLabs".
2. Un eco se clasifica como **propio** solo si `eco.id` coincide con un `wamid` registrado.
3. Carrera "eco antes de guardar el `wamid`": mientras una conversación tiene un envío
   `reservado` sin `wamid` (como máximo el plazo de envío, 10 s), la clasificación de un eco
   **espera** a que ese envío se cierre (o venza) y vuelve a comparar por `wamid`. Si al vencer no
   coincide → **humano**.
4. El hash del texto se guarda **solo como dato de diagnóstico**, nunca decide.
5. Si P4 muestra que la API **no** genera ecos (lo esperado), el paso 3 casi nunca se activa y
   todo eco es humano salvo coincidencia de `wamid`.

## 24. Routing y aislamiento: estado

- **Routing (VERIFICADO en código y por ejecución, R1–R4):** con `ia_pausada = true`, lo único
  que puede responder antes de ese gate es:
  - DuMo (en `POST()`);
  - encuesta, campaña u onboarding si tienen datos de ese número (R2 lo demuestra con la
    encuesta);
  - AMORE o Soluciones Financieras solo si el `phone_number_id` coincide con sus constantes (C10).

  El gancho B de PB va **antes** de todos ellos en `procesarCambio`, así que la protección
  depende solo de DuMo (invariante) y de que la propiedad del número se resuelva. **Falta** C1,
  C3 y C10 con datos reales.
- **Aislamiento:** hoy no existe estado de PB que otro tenant pueda heredar (C8). El estado
  compartido actual ya es por número (I1). Las pruebas A1–A10 del 02 §16.5 (PB activo en un
  número y apagado en otro, sin heredar estado, configuración, límites ni observaciones) solo
  pueden ejecutarse sobre el código de PB: quedan como pruebas automatizadas obligatorias de la
  implementación.

## 25. GLOBAL BUG / PB LOCAL WORKAROUND

- **GLOBAL BUG:** `app/webhook-dulabs/route.ts` lee los ecos en `value.smb_message_echoes`
  (`:179`, `:626`); Meta (fuentes secundarias) los envía en `value.message_echoes`.
  - Efecto demostrado por ejecución (E1): para la forma documentada no hay ni log `manual` ni
    pausa.
  - Afecta a todos los tenants con Coexistence.
  - **No se corrige** en este proyecto.
- **PB LOCAL WORKAROUND:** el parser propio de PB (02 §8) lee `message_echoes`, además de
  `smb_message_echoes` y `messages` con `from == display`; solo en números de PB y sin tocar el
  manejador compartido.
- **Orden recomendado para una futura corrección global** (fuera de este proyecto):
  1. filtrar el cron `seguimiento-traspaso`;
  2. corregir la clave;
  3. revisar que la pausa de 30 min no acorte pausas largas (E5).

## 26. Estado por punto

| Punto | Estado | Base |
| --- | --- | --- |
| Coexistence (payload real) | **NO VERIFICADO** | Falta P1–P3 con el observador |
| Echo | **NO VERIFICADO** en Meta · **VERIFICADO** que el código actual no lee `message_echoes` (E1) | E1–E5; fuentes secundarias |
| IA vs asesora | **NO VERIFICADO** (P4) · diseño estructural por `wamid` (§23) | — |
| Legacy / routing | **VERIFICADO en código y por ejecución** (R1–R4) · configuración real **NO VERIFICADA** (C1, C3, C10) | §24 |
| HUMAN_ACTIVE | **VERIFICADO en código**: nada fuera de PB puede tocarlo (P10) · comportamiento de PB: compuerta de QA | §22 |
| QStash | **NO VERIFICADO** (Q1, C6) · VERIFICADO: no hay schedule en el repositorio | §10, §21.3 |
| Concurrencia | **Diseñada** (02 §10) · no ejecutable sin PB · compuerta de QA | — |
| Idempotencia | **VERIFICADO** para el manejador actual (E4) · PB: compuerta de QA | — |

## 27. Bloqueadores reales para empezar la Fase 2

Solo cuatro. Los demás puntos no bloquean **escribir** el código: bloquean **activarlo**, y ya
están cubiertos por las compuertas de rollout (sombra → QA → activo).

1. **Autorizar el observador del modo sombra.** Es la primera pieza de la Fase 2 y la única forma
   de obtener P1–P5. Alcance: los ganchos E y B, `dulabs_pb_config` y `dulabs_pb_observaciones`,
   sin Gemini, sin envíos y sin buzón. Con `PUBLIBORDADOS_ENABLED = false` es inerte.
2. **Resultados de C1, C3 y C10** (configuración real del número: `ia_pausada`, `flow_activo`,
   DuMo, motores con datos, constantes). Sin ellos no se puede activar ni el modo sombra con
   seguridad.
3. **M1 y M2** (suscripción de la app a `smb_message_echoes` y a la WABA). Si el campo no está
   suscrito, ningún eco llega y todo el diseño de detección queda sin señal. Se corrige en el
   panel de Meta, sin código.
4. **Q1 y C6** (cron `seguimiento-traspaso`). Si está activo, el filtro opt-in se decide antes de
   la fase QA.
