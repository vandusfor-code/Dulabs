# Bloque 29 — CMS comercial de Delacour y fuente de verdad para ARIA · INFORME FINAL

Cinco PR apilados, hoy todos en `main` (la consolidación #179 trajo los intermedios) y desplegados. En producción solo corriste tú la migración y los scripts 01 a 03; **los scripts 04 a 07 (ARIA) NO se han ejecutado**. Los pasos exactos para activar están en el punto 16 y el piloto por número, que permite probar ARIA con tu número sin abrirla al público, en el punto 17.

| PR | Qué entrega | Estado |
|---|---|---|
| #174 · PR 1 | Fundación: SQL, ciclo borrador → publicar, evaluación determinista, validación, servicio con roles, lector verificado, API | **Fusionado** en `main` |
| #175 · PR 2 | Dashboard «Tienda» (editor, imágenes, vista previa, versiones, historial) | **Fusionado** en `main` (vía #179) |
| #176 · PR 3 | La tienda lee del CMS (con respaldo total) + siembra de la vitrina actual | **Fusionado** en `main` (vía #179) |
| #177 · PR 4 | El precio efectivo: ofertas y combos en la tienda, el carrito, la cotización, el pedido y el motor | **Fusionado** en `main` (vía #179) |
| #178 · PR 5 | ARIA lee del CMS (4 herramientas + guarda anti-invención) + migración de los textos del prompt + evaluación | **Fusionado** en `main` (vía #179) |
| **PR 6** | **Piloto por número**: las herramientas de ARIA solo para los números que indiques (punto 17) | Este PR |

---

## 1. Qué existía (Fase 0)

Detalle en `docs/DELACOUR_CMS_FASE_0_AUDITORIA.md`. En resumen: **nada era administrable**. La portada y el banner de Delacour estaban escritos en código (`lib/catalogo/vitrina.ts`); los «destacados» eran los 8 productos más recientes con foto; no existían ofertas, combos ni campañas; y las políticas, preguntas frecuentes y el manejo de mayoristas vivían como **24 textos dentro del prompt** de ARIA (`negocio.conocimiento`, unos 8,8 KB). ARIA tenía 16 herramientas (sin `consultar_envio`). El mínimo mayorista ($750.000) estaba en la configuración y repetido dentro de un texto.

## 2. Qué se construyó

**PR 1 (fusionado).** Cuatro tablas nuevas y funciones SQL atómicas; ciclo borrador → validación → publicar → versión activa (+ pausar, despublicar, restaurar, archivar, historial y auditoría); evaluación determinista de vigencia, canal, prioridad y precio; validación antes de publicar (textos seguros, variables cerradas); servicio con permisos por rol; lector que verifica estado, checksum y esquema; API `/api/dashboard/tienda/*`.

**PR 2.** Dashboard **Tienda**: editor de los 5 tipos (página principal, ofertas, combos, campañas, contenido), imágenes verificadas y re-codificadas en el servidor, vista previa con el mismo cálculo del backend, versiones, restaurar e historial.

**PR 3.** La tienda pública lee la portada, el banner, las secciones, los destacados, las categorías y la campaña del CMS, con respaldo total a la vitrina de siempre; siembra de la vitrina actual (script 03) y una prueba que exige que la tienda leída del CMS sea idéntica a la de hoy, byte a byte.

**PR 4.** El precio efectivo: la oferta publicada **baja el precio de verdad** y es el mismo que se muestra, se firma (cotización), se cobra (pedido y motor de pedidos) y cuenta ARIA. Una sola decisión de precio, falla cerrada para quien cobra, evidencia en las líneas del pedido, secciones «Ofertas vigentes» y «Combos» (Etapa 1: se consultan con una asesora, no se compran), mínimo mayorista sobre el valor final.

**PR 5 (este).**
- **Cuatro herramientas de lectura** para ARIA (`consultar_ofertas`, `consultar_combos`, `consultar_campanas`, `consultar_contenido_comercial`) con contratos estrictos: ARIA conoce lo comercial **solo** por ellas, nunca por el prompt.
- **Guarda de anclaje comercial** (`lib/agente/comercial-anclaje.ts`): un porcentaje, descuento, oferta, combo, campaña, vigencia, «no hay…», fuga mayorista o plazo de política solo sale si lo respalda lo que devolvieron las herramientas en ese turno. Si el modelo insiste, mensaje fijo + asesora.
- **Integración en el runtime**: turno normal y preguntas durante el checkout (lectura pura), cableado real de producción, y exclusión explícita de ASLC y de Delacour-hoy (no cambian hasta que tú habilites las herramientas).
- **Migración de los 24 textos** al CMS: 7 scripts SQL generados por código (borradores → herramientas → retiro del prompt, tema por tema, cada uno con su reversa) más una consulta de estado de solo lectura.
- **Evaluación**: pruebas con modelo guionizado (12 casos obligatorios, 18 preguntas adversariales), un arnés de evaluación con Gemini real (`scripts/eval/gemini-comercial.ts`) y 113 mutantes nuevos.

## 3. Arquitectura

```
Dashboard «Tienda» ──API (sesión · rol · módulo)──► servicio ──► funciones SQL dulabs_cms_* ──► 4 tablas (por negocio)
                                                                              │
                                                    lector verificado (estado · checksum · esquema)
                                                                              │
                                              evaluacion.ts  ← el ÚNICO lugar que decide qué está activo, aplicable y a qué precio
                          ┌───────────────────────┼───────────────────────────┬──────────────────────────┐
                          ▼                       ▼                           ▼                          ▼
                 Tienda pública           Precio efectivo             consulta.ts (PR 5)         Variables ({{minimo_mayorista}})
                 (vitrina, imágenes)      (cotización · pedido ·      respuesta de cada          desde negocio.pedido.*
                                           motor · WhatsApp)          herramienta de ARIA
                                                                              │
                                              herramientas de ARIA (contrato estricto) ──► guarda de anclaje ──► respuesta al cliente
```

Principios (cada uno con su prueba y su mutante): una sola fuente de verdad (la base de datos); **lo que escribe la administradora es dato, nunca instrucción**; el modelo interpreta y el backend autoriza (negocio, canal y reloj salen del turno, jamás del modelo); publicado y borrador nunca se mezclan; «vencida» se deriva al leer, sin procesos programados; todo es aditivo y apagable por módulo.

## 4. Tablas y migraciones

Una sola migración para todo el bloque: `supabase/migrations/20261210000000_dulabs_cms_comercial.sql` (idempotente; reversa en `supabase/rollbacks/20261210000000_dulabs_cms_comercial.down.sql`, que se niega a correr si hay contenido; prueba SQL en `supabase/tests/`).

- `dulabs_cms_entidades` (un elemento por fila, con borrador, estado, versión activa y revisión), `dulabs_cms_versiones` (inmutable, con checksum SHA-256), `dulabs_cms_auditoria` (inmutable, en la misma transacción del cambio) y `dulabs_cms_assets` (imágenes bajo `{negocio}/cms/{id}/`).
- Funciones `dulabs_cms_*` (crear, guardar borrador, publicar, restaurar, pausar, reanudar, despublicar, archivar, desarchivar, listar, obtener, versiones, auditoría, lectura activa, imágenes). RLS sin políticas; ejecutables solo por `service_role`.
- **Los PR 2 a 5 no agregan migraciones.** El PR 5 solo agrega scripts de aprovisionamiento (`supabase/provisioning/delacour/04` a `07`), que escriben únicamente en tablas que ya existen (`dulabs_cms_*` mediante sus funciones y `dulabs_agente_runtime_config`).

## 5. Contratos

- **Contenido** (`esquemas.ts`, estricto): `home`, `oferta`, `combo`, `campana` y `contenido` (tema de una lista cerrada de 12, audiencia todos/detal/mayorista, título, texto de hasta 1.500 caracteres, orden). Variables cerradas: `{{minimo_mayorista}}`, `{{direccion_tienda}}`, `{{nombre_negocio}}`.
- **Precio** (`lib/catalogo/precios.ts`): `precioQueRige` es la decisión única; la oferta solo rige si deja un precio entero, positivo y menor que el de lista del mismo producto y canal.
- **Herramientas de ARIA** (`consulta.ts`): salidas con esquema estricto (sin ids internos, sin versiones, sin el stock exacto). Contrato en el punto 6.

## 6. Herramientas de ARIA

| Herramienta | Entrada (estricta) | Devuelve |
|---|---|---|
| `consultar_ofertas` | `referencia?` (ya vista en la conversación) · `categoria?` | Las ofertas vigentes del canal; con `referencia`, la ÚNICA que le aplica con `list_price` y `price`; con `categoria`, las que cubren toda esa categoría |
| `consultar_combos` | `code?` | Combos vigentes: componentes, cantidades, `normal_price`, `combo_price`, `savings`, disponibilidad con el inventario real, vigencia; `how_to_buy`: no se compran desde el carrito |
| `consultar_campanas` | — | Campañas vigentes con las ofertas y combos que incluyen |
| `consultar_contenido_comercial` | `tema` (lista cerrada) | Los textos publicados del tema, con las variables resueltas; `incomplete` si algo no se pudo mostrar |

Reglas comunes: el modelo **no pasa** negocio, canal, fecha ni precio (un campo de más → `INVALID_INPUT`); `empty: true` es la única base para decir «por ahora no hay»; sin lector, con el módulo apagado, ante una falla de lectura o con la instantánea de otro negocio → `UNAVAILABLE` (nunca un vacío falso); número que no es del negocio → `FORBIDDEN`; solo lo publicado, vigente y aplicable al canal (lo mayorista jamás llega a un cliente detal); siempre se lee en el momento.

**La guarda** (`comercial-anclaje.ts`) vigila `percent_unbacked`, `discount_unbacked`, `offer_unbacked`, `combo_unbacked`, `campaign_unbacked`, `absence_unbacked`, `validity_unbacked`, `wholesale_leak` y `policy_figure_unbacked`. Solo cuenta lo que devolvieron las herramientas **en ese turno** (ni el cliente ni el prompt respaldan nada). Las preguntas, negaciones y condicionales no cuentan; una cifra que escribió el cliente y que la frase niega («no es del 50 %») tampoco. Una corrección y, si insiste, mensaje fijo y asesora; la traza solo guarda los códigos.

## 7. Dashboard

**Tienda** (`/dashboard/tienda`), visible solo con el módulo `cms_comercial`. Pestañas: Página principal · Ofertas · Combos · Campañas · Contenido · Historial. Cada elemento: borrador → revisar → vista previa → publicar → versiones → restaurar. Solo `admin` modifica; `agente` y `lectura` consultan (la API responde 403 aunque una pantalla manipulada lo intentara). No hay campos de «instrucciones»: el servidor rechaza órdenes al asistente, HTML y claves. El PR 5 no cambia el Dashboard.

## 8. Flujo de publicación

```
crear ─► borrador ─guardar─► (rev+1) ─revisar─► validación en el servidor ─publicar─► versión activa (inmutable, con checksum)
                                                              │ exactamente la revisión validada; si cambió algo: conflicto, no se publica nada
pausar ◄─► reanudar · despublicar (vuelve a borrador, nada se pierde) · restaurar (copia una versión como NUEVA y la revalida) · archivar
```

Toda acción queda en la auditoría (quién, qué, cuándo, antes y después). Lo que ven la tienda, el pedido y ARIA es solo lo publicado, vigente y aplicable al canal.

## 9. Flujo tienda → backend → ARIA

La administradora publica una oferta del 20 %. En la siguiente petición: la tienda muestra el precio con la oferta y el de lista tachado; la cotización firma ese precio; el pedido lo cobra y guarda la evidencia (precio de lista, oferta y versión); el mensaje de WhatsApp solo suma «Incluye ofertas vigentes (ahorro: $X)». ARIA, cuando el cliente pregunta, llama a `consultar_ofertas` y cita lo que devuelve; si el modelo dijera otro porcentaje, otra fecha o una oferta que no existe, la guarda lo frena. Si la administradora la pausa, en el turno siguiente ya no existe para ARIA (se lee en el momento) y lo que el modelo «recuerde» no sale.

## 10. Seguridad

Sesión + rol + módulo en cada ruta (fail-closed), esquemas estrictos, límite de peticiones, textos sin HTML, órdenes al asistente ni claves, enlace mayorista imposible en un texto visible, imágenes verificadas y re-codificadas, RLS sin políticas. En ARIA: herramientas de solo lectura con entrada estricta, anclaje por código (no por prompt), el cliente detal nunca recibe lo mayorista, la traza no guarda texto del cliente ni del modelo, el prompt no lleva ningún dato comercial (solo cómo consultar). La clave de evaluación se lee solo de `GEMINI_EVAL_KEY`, nunca se imprime ni se guarda, y la red del arnés se limita a Google.

## 11. Aislamiento entre negocios

`id_tenant` en cada tabla, claves foráneas compuestas, cada función recibe el negocio y lo filtra, y el negocio, el canal y el reloj de ARIA salen del turno. Pruebas nombradas en el PR 5: la oferta de otro negocio no le llega a este (`agente-comercial-produccion.pglite.test.ts`), una instantánea de otro negocio responde «no disponible» (`agente-comercial-aria.test.ts`), el caso 12 de la FASE 13 («otro negocio»), el aislamiento de `consulta.test.ts`, y los scripts 04, 05 y 06 no tocan la configuración ni el CMS de otro negocio (`migracion-textos.pglite.test.ts`).

## 12. Pruebas (números exactos)

| | |
|---|---|
| Regresión completa (`npm run test:flow`) | **8.066 pruebas: 8.065 pasan, 1 falla** — la que falla es `lib/mi-cita/mi-cita.test.ts` (AMORE, usa el reloj real; ya fallaba antes de este trabajo, igual que en el PR 4). Antes de este PR: 7.862 → **+204** |
| Archivos de prueba nuevos | 7 archivos, 204 pruebas: dominio y generación 99 (consulta 30, guarda 36, scripts de migración 33), integración con el runtime real y un modelo guionizado 59 (ARIA 51, preguntas durante el checkout 8), punta a punta con SQL real y el cableado real de producción 46 (scripts 04–07 en Postgres embebido 40, producción 6) |
| Los 12 casos obligatorios (FASE 13) | 12 con el runtime real: oferta creada, pausada, con el porcentaje cambiado, con la vigencia cambiada, vencida (hasta el último minuto, hora de Bogotá), oferta detal/mayorista, combo activo/pausado, campaña activa/vencida y otro negocio; en varios, además, lo que el modelo «recuerda» de un turno anterior no sale |
| Las 18 preguntas adversariales (FASE 14) | 18: lo honesto sale; lo inventado nunca se envía (una corrección y, si insiste, mensaje fijo + asesora). 3 las resuelve el backend sin llamar al modelo (un detal que habla de lo mayorista) |
| Guarda anti-invención | 36 pruebas de tabla con la evidencia real de las herramientas (lo respaldado pasa, lo inventado no, y preguntas/negaciones/condicionales no cuentan), incluidos los ajustes que salieron de la evaluación con Gemini real |
| Aislamiento entre negocios | 9 pruebas nombradas (consulta, instantánea de otro negocio, número ajeno, negocio y canal del turno, el caso 12 de la FASE 13, el CMS de otro negocio con el cableado real, y los scripts 04, 05 y 06 sin tocar a otro negocio) |
| Regresión con el módulo apagado o sin las herramientas | 8 pruebas nombradas (prompt idéntico sin las herramientas, la guarda no actúa, ASLC conserva sus 16, módulo apagado y sin migración → «no disponible», checkout igual que antes) |
| Permisos por rol | Este PR no toca roles ni permisos; las pruebas de roles del Dashboard siguen verdes en la suite completa |
| Arnés con modelos simulados | cooperativo: 30/30 PASS (31 borradores, 0 intervenciones de la guarda); adversario: 27 BLOCKED-SAFE + 3 resueltos por el backend, **0 FAIL, 0 falsos negativos, 0 falsos positivos** |
| `tsc` | 0 errores (heap 4 GB) |
| ESLint | 0 problemas en 25 archivos |
| `next build` | OK (heap 4 GB); las rutas de la tienda siguen dinámicas (ƒ) |
| Mutación | **113/113 mutantes del PR 5 detectados** (M336–M448; el script suma 448 patrones y todos aplican exactamente una vez). La primera corrida detectó 93/107: los 14 sobrevivientes se reforzaron con pruebas (uno era equivalente y se reapuntó) y los ajustes de la guarda sumaron 6 mutantes más; la corrida final contra el código final detecta los 113 |

### Evaluación con Gemini real (parcial)

Se corrieron **71 casos** con `gemini-3.6-flash` (clave de pruebas `GEMINI_EVAL_KEY`, red restringida a Google, ~280 llamadas): 52 PASS, 11 BLOCKED-SAFE (el modelo se equivocó y la guarda lo frenó), 6 FAIL y 3 INFRA (503 «alta demanda» de Google). No se confirmó ninguna cifra inventada entregada al cliente. Los 6 FAIL: 1 de resolución causado por la guarda (el modelo negaba el 50 % que el cliente había escrito → corregido), 3 por la configuración del propio arnés (incluía `consultar_envio`, que Delacour no usa → corregido), 1 falsa alarma de la expresión del caso (P03: el modelo respondió bien «No aceptamos tarjeta» → corregida) y 1 sin revisar a mano (H07). Los ajustes de la guarda se verificaron con pruebas unitarias, **pero la evaluación real NO se repitió con la guarda corregida** (decisión del dueño por el saldo de la clave de pruebas).

## 13. Mutaciones

El script `scripts/mutacion/cms.py` quita o invierte UNA protección a la vez; alguna prueba DEBE fallar. Si no falla, la protección se podía eliminar sin que nadie se enterara.

| PR | Mutantes | Resultado |
|---|---|---|
| PR 1 | 87 | 87/87 (la primera corrida dejó 7 sin detectar; se reforzaron las pruebas) |
| PR 2 | 72 nuevos (159 en total) | 159/159 (4 sobrevivientes reforzados) |
| PR 3 | 74 (233 patrones) | 74/74 |
| PR 4 | 107 (102 nuevos y 5 de PR 3 reapuntados; 335 patrones) | 107/107 (6 sobrevivientes reforzados) |
| **PR 5** | **113 (M336–M448; 448 patrones)** | **113/113** |

Los 113 del PR 5, por área: consultas y herramientas de ARIA 23 · guarda de anclaje 38 · runtime, prompt, lista de ASLC y nombres de herramientas 16 · cableado real de producción 3 · scripts SQL 04 a 06 y sus reversas, ejecutados en Postgres embebido, 33. Primera corrida: 93/107 detectados; los 14 sobrevivientes mostraron pruebas que faltaban (campañas con ofertas ajenas, el mensaje específico de «no disponible», combos para el cliente mayorista, categoría ambigua, condicionales con porcentaje, «sigue vigente», el mínimo mayorista informado a un detal, la resolución de variables dentro del runtime y tres cuestiones de las reversas del script 06) y se agregaron; uno (la reversa del 04 sobre algo ya archivado) era equivalente y se reapuntó a quitar solo la revisión. Los ajustes de la guarda que salieron de la evaluación real agregaron M443–M448.

## 14. Riesgos y límites (con honestidad)

1. **Gemini real, evaluación incompleta.** Se corrieron 71 casos con `gemini-3.6-flash` y salieron hallazgos que ya se corrigieron en la guarda (ver punto 12), pero **la evaluación NO se repitió con la guarda corregida** y quedan 2 casos sin resultado por errores 503 de Google (A03 y A05). Un caso (H07) quedó sin revisar a mano. Se deja pendiente a propósito (decisión del dueño por el saldo de la clave de pruebas).
2. **Latencia y disponibilidad de Gemini.** Durante la evaluación, ~40 % de las llamadas devolvieron 503 «alta demanda» en las primeras horas, con latencia p95 de 28–33 s (después se normalizó: p95 3–4 s). Producción usa 15 s de tope por llamada: cada consulta a una herramienta suma una llamada al modelo, así que en picos de demanda de Google más turnos caerán al mensaje técnico (comportamiento que ya existía). No se cambió ese tope.
3. **La guarda es estricta a propósito.** Si el modelo responde una verdad sin haber consultado la herramienta, la guarda pide corregir una vez (una llamada más). Mide «verdad respaldada por el sistema», no «verdad».
4. **No se pueden verificar paráfrasis cualitativas** de una política («aceptamos todo tipo de cambios») ni respuestas elípticas sin palabras clave. Mitigación: las políticas se devuelven como un texto oficial para citar tal cual y la guarda vigila toda cifra, plazo, fecha y nombre.
5. **La excepción de la cifra negada del cliente** («no es del 50 %») usa la cercanía de la negación a la cifra. Está probada contra «no te preocupes, tenemos 50 %» y «no, tenemos 50 %» (siguen bloqueados), pero es una heurística.
6. **Migración de textos.** Los scripts reconocen los temas por su nombre (sin importar mayúsculas ni tildes). Un tema renombrado en la base no se migra (queda en el prompt y el script lo avisa). «Venta al por mayor» y «Emprendimiento» nacen con audiencia **mayorista**: revísalos antes de abrirlos a «todos» por si traen precios mayoristas.
7. **Doble guarda de envíos.** Un negocio con el motor de envíos **y** las herramientas comerciales tomaría «cambios dentro de los 8 días siguientes a la entrega» por un tiempo de envío. Hoy ningún negocio tiene ambos (ASLC no tiene las comerciales, Delacour no tiene el motor de envíos).
8. **Costo de lecturas** (PR 4): cada visita a la tienda de un negocio sin el módulo suma una consulta pequeña. Cada turno de ARIA con herramientas comerciales lee el CMS en el momento (una consulta).
9. **Límite del filtro de precio máximo** de la búsqueda de ARIA (PR 4): usa el precio de lista; puede omitir un producto con descuento, nunca incluye de más.
10. **Pruebas de AMORE «Mi cita»**: usan el reloj real y ya fallaban antes de este trabajo; no son de este bloque (arreglo en otra sesión).
11. **El gasto de la evaluación**: ~280 llamadas a la API de Gemini en las corridas reales (el panel «Gasto» de AI Studio lo muestra exacto).

## 15. Qué falta

- **Repetir la evaluación con Gemini real** cuando aclares el saldo de la clave de pruebas: `npx tsx scripts/eval/gemini-comercial.ts --real 1 --solo "^(A|H|V|P|K)"` (y con `--convivencia` para el periodo en que los textos están a la vez en el prompt y en el CMS). El arnés ya guarda la respuesta completa de los casos que no son PASS.
- **Combos comprables desde el carrito** (Etapa 2): decisión tuya, fuera de este bloque.
- Recordar «sin CMS» unos segundos por negocio, si el costo de lecturas llegara a pesar.
- Que la administradora revise y publique los textos migrados (paso 10 de las instrucciones) y, más adelante, retirar del prompt los que ya estén verificados.

## 16. Instrucciones exactas de producción

Nada de esto se ejecuta solo. Todo es SQL en el **SQL Editor de Supabase**, una sentencia por script; cada script se niega a correr fuera de orden y se puede repetir sin efectos nuevos. Las reversas se corren en el orden inverso.

**A. Merge y despliegue.** Los cinco PR del Bloque 29 ya están en `main` y desplegados. El piloto por número (punto 17) va en un PR aparte con base `main`: fusiónalo y espera el despliegue **antes** del paso 9. Todo sigue inerte hasta que corras los scripts: sin el módulo ni la migración, todo se comporta como hoy. No hay variables de entorno nuevas.

**B. Base de datos y tienda** (`supabase/provisioning/delacour/`, detalle en su `README.md`):

| Paso | Script | Resultado esperado | Reversa |
|---|---|---|---|
| 1 | `supabase/migrations/20261210000000_dulabs_cms_comercial.sql` | Crea las 4 tablas y funciones | `supabase/rollbacks/20261210000000_dulabs_cms_comercial.down.sql` (se niega si hay contenido) |
| 2 | `01_verificar_cms_comercial_solo_lectura.sql` | `migracion_aplicada`, `rls_activa`, `funciones_solo_service` y `tienda_unica` en verdadero; `modulo_habilitado` en falso | — (solo lectura) |
| 3 | `02_habilitar_cms_comercial.sql` | Módulo `cms_comercial` habilitado | `update public.dulabs_tenant_modulos set habilitado = false …` (está en el encabezado del script) |
| 4 | `01_…` otra vez | `modulo_habilitado` verdadero y todo en 0 | — |
| 5 | `03_sembrar_vitrina_actual.sql` (con el PR 3 desplegado) | La tienda se ve IDÉNTICA; `publicados` = 1 | `03_sembrar_vitrina_actual.reversa.sql` |

**C. ARIA (PR 5)** — con el PR 5 desplegado:

| Paso | Qué haces | Script | Resultado esperado | Reversa |
|---|---|---|---|---|
| 6 | Ver el estado | `07_estado_migracion_textos_solo_lectura.sql` | Los 22 temas «en el prompt» y «no migrado»; `0 de 4 habilitadas` | — |
| 7 | Copiar los textos como borradores | `04_migrar_textos_a_borradores.sql` | 22 borradores; ARIA no cambia | `04_…reversa.sql` (archiva los que nadie tocó) |
| 8 | **La administradora revisa y publica** en Tienda → Contenido | (Dashboard) | El `07` muestra `prompt+cms` en los publicados | — |
| 9 | Habilitar las herramientas y la guarda **solo para tu número** | `set dulabs.piloto_comercial = '57XXXXXXXXXX';` y luego `05_habilitar_herramientas_comerciales.sql` (misma sesión) | Se niega sin números, con un número mal escrito, si no hay texto publicado, si queda sin publicar un tema crítico o si ya están abiertas a todos; al correr, `herramientas` suma las 4 y `negocio.comercial_piloto` guarda tus números: **solo ellos** las reciben, los demás clientes siguen como hoy | `05_…reversa.sql` (apaga de inmediato para todos y quita el piloto) |
| 10 | **Verificar con conversaciones reales** (tu número) | — | Ver la lista de abajo | — |
| 11 | Abrir a todos los clientes (cuando el paso 10 salió bien) | `05b_abrir_herramientas_comerciales_a_todos.sql` | Quita el piloto: todos los clientes reciben las herramientas; el `07` dice «abiertas a TODOS los clientes» | `05_…reversa.sql`; para volver a un piloto, el `05` otra vez con tu número |
| 12 | Retirar del prompt, tema por tema | `set dulabs.retirar_temas = 'promociones,envios';` y luego `06_retirar_textos_del_prompt.sql` | Se niega mientras haya piloto, si las herramientas no están habilitadas o el tema no está publicado | `set dulabs.restaurar_temas = '…';` y `06_…reversa.sql` |

**Qué probar en el paso 10** (desde tu número, como cliente detal y luego como mayorista): «¿qué promociones tienen?», «¿cuál es la garantía?», «¿horario?», «¿dónde están?», «¿hacen envíos?», «me dijeron que había 50 % de descuento», «dame un descuento por pagar de contado», «¿tienen combos?», una pregunta sobre lo mayorista como detal (debe pasar a una asesora sin llamar al modelo) y una pregunta sobre algo que el CMS no tiene (debe ofrecer una asesora, no inventar). Mientras estén en piloto, escribe también desde un número que NO esté en la lista: debe conversar exactamente como siempre. Si algo sale mal: reversa del `05` (un solo script) y listo.

**D. Apagado de emergencia.** Reversa del `05` (ARIA vuelve a ser exactamente la de antes) y, si hiciera falta, deshabilitar el módulo `cms_comercial` del negocio (la tienda y los precios vuelven a los de lista al instante).

**E. Para regenerar los scripts 03 a 07 (incluido el 05b)** (no se editan a mano): `ACTUALIZAR_SQL=1 npx tsx --test lib/cms-comercial/siembra-vitrina.test.ts lib/cms-comercial/migracion-textos.test.ts`.

## 17. Piloto por número (PR 6)

**Para qué.** Probar ARIA con el CMS **solo con tu número** antes de abrirla al público. Las herramientas de un agente se habilitan por *línea* del negocio (la fila de ARIA de ese número de WhatsApp), no por cliente: sin este PR, el script 05 habría activado las cuatro herramientas, la guarda anti-invención y la sección comercial del prompt para **todos** los clientes de Delacour a la vez.

**Cómo funciona.**
- `negocio.comercial_piloto`: lista de números de contacto (`wa_id`: solo dígitos con el indicativo del país, por ejemplo 57 + el celular; de 1 a 20).
- Con la lista, **solo esos contactos** reciben las herramientas comerciales, la guarda anti-invención y la sección «información comercial» del prompt. Todos los demás conversan **exactamente** como si el número no las tuviera: mismo prompt (byte a byte) y mismas herramientas, probado con el runtime real. Sin la lista, las reciben todos.
- Se aplica una sola vez, al entrar el turno (`aplicarPilotoComercial` en `lib/agente/piloto-comercial.ts`, llamada desde `runAgentTurn`); el resto del runtime no sabe que existe el piloto.
- Falla cerrada: una lista mal escrita deja la configuración inválida (ARIA no responde), nunca abierta a todos. El esquema y los scripts usan la misma expresión de número y una prueba lo exige.

**Scripts** (generados por código; ningún número real en el repositorio):

| Script | Cambio |
|---|---|
| `05_habilitar_herramientas_comerciales.sql` | Ahora **exige** los números (`set dulabs.piloto_comercial = '57…';` en la misma sesión): se niega sin números, con un celular sin el 57, con un número inválido, con más de 20 y si las herramientas ya están abiertas a todos. Acepta espacios, `+`, guiones y paréntesis; ordena y quita repetidos. Correrlo otra vez con otros números cambia el piloto |
| `05b_abrir_herramientas_comerciales_a_todos.sql` (nuevo) | Quita el piloto: desde ese momento, todos los clientes. Se niega si las herramientas no están habilitadas, si no queda texto publicado o si quedó sin publicar un tema crítico |
| `05_…reversa.sql` | Quita las herramientas **y** el piloto (se niega, como antes, si un tema crítico ya solo vive en el CMS) |
| `06_retirar_textos_del_prompt.sql` | Se niega mientras haya piloto: retirar un texto del prompt dejaría a los demás clientes sin esa información |
| `07_estado_migracion_textos_solo_lectura.sql` | Una fila más, «piloto de las herramientas»: sin herramientas · solo N número(s) con sus últimos 4 dígitos · abiertas a TODOS |

**Orden obligatorio.** Fusionar este PR y esperar a que Vercel termine el despliegue **antes** del paso 9. El esquema de la configuración es estricto y el código anterior no conoce `comercial_piloto`: si el `05` se corriera antes, ARIA recibiría una configuración inválida y dejaría de responder hasta correr la reversa del `05`.

**Números.**

| | |
|---|---|
| Pruebas nuevas | **28**: scripts con Postgres embebido 40 → 54 (+14), generación de los scripts 33 → 38 (+5), turno completo con el runtime real 51 → 60 (+9) |
| Regresión completa (`npm run test:flow`, sobre `main` + este PR) | **8.094 pruebas, 8.094 pasan, 0 fallan** (antes 8.066 con 1 falla: la de AMORE «Mi cita», que arregló #180) |
| Mutación | **28/28 detectados a la primera**: 26 nuevos (M449–M474) y 2 reapuntados (M426 y M428). El script suma 474 patrones y todos aplican exactamente una vez. Cada mutante de un script SQL corre solo la suite de ESE script |
| `tsc` | 0 errores (heap 4 GB) |
| ESLint | 0 problemas en 8 archivos |
| `next build` | OK (heap 4 GB) |

**Lo que cubren las pruebas.** El contacto del piloto recibe las 4 herramientas, el prompt comercial y la guarda (lo inventado no sale). Cualquier otro contacto: ni herramientas, ni sección, ni guarda (la traza queda sin cambios) y, si el modelo pidiera una herramienta comercial, `TOOL_NOT_ALLOWED` sin siquiera leer el CMS. Varios números en el piloto; sin piloto, todos; el piloto no hace nada en un número que no tiene las herramientas; una lista inválida en la base deja la configuración inválida. Cada guarda de los scripts (sin números, celular sin el 57, letras, ceros iniciales, largo, huecos entre comas, 20 y 21 números, repetidos, correr de nuevo con otros números, ya abiertas a todos) y que un intento fallido no deja nada; el negocio de otro no se toca.

**Límites.**
1. El piloto se compara con el número del contacto tal como lo entrega WhatsApp (`wa_id`). Si WhatsApp entregara un formato distinto para algún país, ese número no coincidiría y simplemente no recibiría las herramientas (falla segura: no abre a nadie).
2. El canal (detal o mayorista) de un contacto lo fija el backend la primera vez y solo una asesora puede cambiarlo: para probar los dos canales hacen falta dos números en el piloto (separados por coma) o que una asesora cambie el canal de tu número.
3. Mientras exista el piloto, el `06` está bloqueado a propósito.
4. Con el piloto activo, los demás clientes quedan sin la guarda comercial nueva (conversan como hoy). Es lo esperado: el piloto existe para no cambiarles nada.