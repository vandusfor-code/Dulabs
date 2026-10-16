# CMS comercial (Bloque 29)

Contenido comercial **administrable por negocio** (página principal, pie de página, páginas propias de la tienda, ofertas, combos, campañas y contenido como preguntas frecuentes o políticas) con un ciclo único:

```
BORRADOR → VALIDACIÓN → PUBLICAR → VERSIÓN ACTIVA   (+ pausar · despublicar · restaurar · archivar · historial y auditoría)
```

Lo único que ven la tienda, el carrito/pedido y ARIA es lo **publicado, vigente y aplicable al canal del cliente**. Los borradores solo los lee el editor del Dashboard.
Un negocio sin el módulo `cms_comercial` no tiene nada de esto: ni API, ni menú, ni lectura publicada (todo se comporta exactamente como antes).

## Principios (cada uno tiene su prueba y su mutante en `scripts/mutacion/cms.py`)

1. **Una sola fuente de verdad**: la base de datos. Ningún dato comercial vive en el prompt de ARIA.
2. **Lo que escribe la administradora es DATO, nunca instrucción.** El contenido llega a ARIA solo como resultado de una herramienta del backend; además se bloquean las frases que intentan dar órdenes al asistente, el HTML y las claves pegadas (`texto-seguro.ts`).
3. **El modelo interpreta, el backend autoriza.** Vigencia, modalidad (detal/mayorista), campaña, prioridad y precio los decide `evaluacion.ts`, pura y con el reloj y el canal inyectados. El canal lo decide el backend, nunca el modelo.
4. **Publicado y borrador no se mezclan**: un único lector (`lector.ts`) y una única función SQL (`dulabs_cms_lectura_activa`) entregan lo publicado.
5. **«Vencida» se deriva al leer**, sin procesos programados: una oferta deja de valer en el instante exacto de su fin (hora de Bogotá, `[desde, hasta)`).
6. **Aditivo y apagable**: tablas nuevas, ninguna existente cambia; todo cuelga del módulo.

## Piezas

| Archivo | Qué es |
|---|---|
| `contrato.ts` | Tipos y constantes compartidas (estados, modalidades, roles, auditoría) |
| `esquemas.ts` | Esquemas zod de cada tipo (contenido PUBLICABLE, estricto) y `normalizarBorrador` (JSON seguro, aunque esté incompleto) |
| `tiempo.ts` | Fechas de Bogotá, `estadoDeVigencia`, fechas en palabras para el cliente |
| `texto-seguro.ts` | Texto plano, órdenes al asistente, enlace mayorista, secretos |
| `variables.ts` | Variables cerradas (`{{minimo_mayorista}}`): un número que ya existe en la configuración no se escribe a mano |
| `validacion.ts` | Errores que bloquean y advertencias, con mensajes claros; recibe un contexto ya cargado |
| `evaluacion.ts` | **El único lugar** donde se decide qué está activo, qué oferta aplica a un producto, a qué precio y qué combo está disponible |
| `publicado.ts` · `lector.ts` | La instantánea de lo publicado; el lector verifica estado, checksum y esquema y descarta lo que no pase |
| `servicio.ts` | El ciclo completo con permisos por rol |
| `repositorio.ts` · `repositorio-supabase.ts` | Contrato y adaptador: TODO pasa por funciones SQL `dulabs_cms_*` |
| `adaptadores-supabase.ts` | Puertos de solo lectura al catálogo (productos y categorías) y a las variables del negocio |
| `auth.ts` · `http.ts` · `http-esquemas.ts` | Sesión + rol + módulo (fail-closed), límite de peticiones, envelope de errores |
| `imagen-servidor.ts` · `almacen.ts` · `imagenes.ts` | **Imágenes** (PR 2): la foto sube directo a Storage con URL firmada; el servidor la verifica (firma real, ≤ 6 MB, ≤ 40 megapíxeles, no animada) y la re-codifica a WebP ≤ 2400 px sin metadatos, siempre bajo `{negocio}/cms/{id}/` |
| `previa.ts` | **Vista previa** (PR 2): usa las MISMAS funciones de `evaluacion.ts` (precio con oferta, ahorro, precio normal y disponibilidad del combo, variables): lo que se ve es lo que el backend calcularía |
| `json-canonico.ts` | JSON canónico apto para el navegador (checksum del servidor y detección de cambios del editor) |
| `../cms-comercial-client.ts` | Cliente del navegador de `/api/dashboard/tienda/*`: resultados tipados que nunca lanzan; la subida de imágenes en etapas (preparar → URL firmada → Storage → confirmar) |
| `vitrina.ts` | **La tienda lee del CMS** (PR 3), PURO: `vitrinaDesdeCms` convierte lo publicado en la vitrina de la tienda; `hrefDeDestino` decide a dónde lleva un botón (solo si el destino existe y está activo hoy); `imagenDeVitrina` y `assetsReferenciados` (qué imágenes puede servir la ruta pública) |
| `vitrina-publica.ts` · `publico-supabase.ts` | Carga de la vitrina CON RESPALDO (inyectable) y su cableado real (perezoso): ante cualquier problema la tienda usa la vitrina de siempre, sin error para el cliente |
| `lectura-publicada.ts` | La lectura de lo publicado que comparte una página (`cache` de React): la vitrina, los combos y los precios de un mismo inicio leen el contenido UNA vez por render (antes eran 3 lecturas); fuera de un render del servidor (rutas, motor de pedidos, ARIA) no memoiza |
| `precios.ts` · `precios-supabase.ts` | **El precio efectivo** (PR 4): implementa el puerto de precios del catálogo con lo PUBLICADO (`crearEvaluadorPrecios`, `crearPuertoPreciosCms`) y su cableado real (`repositorioConPrecios`) |
| `imagen-publica.ts` | Ruta pública de imágenes `/catalogo/{tienda}/vitrina/{id}.webp`: solo imágenes LISTAS, usadas por contenido PUBLICADO y de la carpeta del propio negocio; todo lo demás, el mismo 404 |
| `siembra-vitrina.ts` | Genera la página principal equivalente a la tienda de hoy y el SQL que la siembra (y su reversa) en `supabase/provisioning/<tienda>/` |
| `consulta.ts` | **Lo que ARIA puede saber** (PR 5), PURO: arma la respuesta de cada herramienta comercial (`ofertasVigentes`, `ofertaDeProducto`, `combosVigentes`, `campanasVigentes`, `contenidoComercial`) con `evaluacion.ts`, el reloj y el canal del turno, y sus esquemas de salida estrictos |
| `variables-negocio.ts` | Los valores de las variables de los textos a partir de la configuración de ARIA (`negocio`): un solo cálculo para el Dashboard y para el runtime |
| `pagina-mayoristas.ts` · `pagina-mayoristas-publica.ts` | **La página «Mayoristas» de la tienda** (Bloque 30), PURA y su carga con respaldo: arma lo que muestra `/catalogo/{tienda}/mayoristas` a partir de lo PUBLICADO con tema «Mayoristas» (las mismas reglas que ARIA: audiencia, vigencia, variables); la tienda solo dice cuál entrada es la introducción, cuáles omitir y cuáles de otros temas sumar, por su código. Nunca lanza: ante cualquier problema devuelve null y la página sale con el texto de la tienda |
| `enlaces.ts` | **Enlaces del pie** (pie editable), PURO: qué dirección externa se puede poner en la tienda (solo https, sin usuario ni puerto, sin IP ni red local ni dominios disfrazados), el dominio que exige cada red social, el usuario que se muestra y teléfono y correo válidos |
| `pagina.ts` · `pagina-publica.ts` · `plazo.ts` | **Páginas propias de la tienda** (política de privacidad, términos…): el texto que escribe la administradora ↔ bloques, la dirección `/p/{código}`, los problemas del texto mientras se escribe y el resumen de cambios (PURO); la carga de una página publicada (`ok` / `no_existe` / `error`, nunca lanza) y el tope de espera compartido |
| `pie.ts` · `pie-publico.ts` | **El pie de la tienda**: `pieDesdeCms` resuelve lo publicado contra lo que la tienda tiene hoy (destinos que no existen se omiten), `pieDeRespaldo` es el pie de siempre y `pieInicial` el borrador con el que arranca la administradora; la carga con respaldo nunca lanza ni tarda más de 2 s |
| `video-mp4.ts` · `video-requisitos.ts` · `video-navegador.ts` | **Videos de la tienda** (fotos y videos): el lector de MP4 (PURO, el mismo código en el navegador y en el servidor: cajas, códec, medidas con giro, duración, fotogramas, sonido, índice al principio), la tabla de medidas por espacio y cada regla con su mensaje, y la revisión en el navegador antes de subir (abre el video y le toma la imagen fija) |
| `videos.ts` · `video-publico.ts` | El servicio de videos (URL firmada, subida directa a Storage de hasta 3 MB y verificación del servidor, que es la que manda) y la ruta pública `/catalogo/{tienda}/vitrina/{id}.mp4` con `Range` (Safari lo exige): solo videos listos, usados por contenido PUBLICADO y de la carpeta del propio negocio |
| `multimedia-tienda.ts` · `multimedia-publica.ts` | Lo que la tienda dibuja con las fotos y videos publicados: cada video reemplaza al de siempre solo en su espacio (si algo no cuadra, vuelve el de siempre), y la imagen de una categoría reemplaza la foto automática; la carga nunca lanza ni tarda más de 2 s |
| `migracion-textos.ts` | Genera los scripts SQL 04 a 07 de `supabase/provisioning/<tienda>/` (migrar los textos del prompt de ARIA al CMS, habilitar las herramientas, retirar del prompt, estado) y su tabla de correspondencia |
| `testing/` | Fixtures, Postgres embebido (PGlite), el puente que lleva las llamadas `rpc/dulabs_cms_*` de las rutas al SQL real, un almacén de imágenes en memoria, `fetch-rutas.ts` (lleva el cliente del navegador a las rutas reales) y un Delacour sintético (tienda, módulo y la tabla real de la configuración de ARIA) |

## Datos (migración `20261210000000_dulabs_cms_comercial.sql`)

- `dulabs_cms_entidades`: un elemento por fila, con `borrador`, `estado` (`borrador|publicada|pausada`), `version_activa` y `rev` (control optimista).
- `dulabs_cms_versiones`: instantánea **inmutable** (append-only) de cada publicación o restauración, con checksum SHA-256 del JSON canónico.
- `dulabs_cms_auditoria`: quién, qué, cuándo, antes y después (append-only), escrita en la **misma transacción** del cambio.
- `dulabs_cms_assets`: imágenes subidas; la ruta queda siempre bajo `{negocio}/cms/{id}/`.

Aislamiento: `id_tenant` en cada tabla, claves foráneas compuestas (una versión o un puntero nunca cuelgan de otro negocio), cada función recibe el negocio y lo filtra siempre; RLS sin políticas y funciones ejecutables solo por `service_role`.

## Ciclo de vida

```
crear ──► borrador ──guardar──► (rev+1)
              │ publicar (valida; publica EXACTAMENTE la revisión validada)
              ▼
          publicada ◄──reanudar── pausada
              │  ▲ restaurar (versión nueva)
              │  └──────────────────────────────┐
              └──despublicar──► borrador ──archivar──► archivada
```

- Publicar exige que la validación no tenga errores y que `rev` y la versión activa sean las esperadas (si no: conflicto, no se publica nada).
- Restaurar copia una versión anterior como versión **nueva**, la vuelve a validar con las reglas de hoy y verifica su checksum; no descarta el borrador pendiente.
- Despublicar conserva lo que estaba publicado como borrador: no se pierde nada.

## Reglas comerciales (decididas por el negocio)

- Las ofertas modifican el precio efectivo real; no se acumulan: gana UNA (mayor prioridad; empate: mejor precio final para el cliente; luego la más antigua; luego el código).
- Los combos se administran, se muestran y ARIA los consulta; **no** se compran desde el carrito (los cierra una asesora).
- El mínimo mayorista se calcula sobre el valor final tras descuentos y existe una sola vez (`negocio.pedido.minimo_mayorista`; los textos usan `{{minimo_mayorista}}`).
- Un cliente detal nunca recibe precios, ofertas, combos ni enlaces mayoristas; sí puede recibir información general sobre la venta mayorista y su mínimo.

## API (`/api/dashboard/tienda/*`)

Lectura (admin, agente, lectura) y escritura (solo admin). El negocio sale de la sesión.
`GET/POST entidades` · `GET entidades/{id}` · `PUT entidades/{id}/borrador` · `POST entidades/{id}/{validar|publicar|restaurar|pausar|reanudar|despublicar|archivar|desarchivar}` · `GET entidades/{id}/versiones` · `GET auditoria`.
Para el editor (PR 2): `GET imagenes` (galería) · `POST imagenes/upload-url` (URL firmada; solo admin) · `POST imagenes/{id}/confirmar` (verifica y re-codifica; idempotente; solo admin) · `GET productos` (`?q=` o `?referencias=`; sin ids internos) · `GET contexto` (categorías, variables con su valor, zona horaria).

## Dashboard · «Tienda» (`/dashboard/tienda`, PR 2)

Entrada del menú **Tienda**, visible solo en los negocios con el módulo `cms_comercial` (todos los roles consultan; la API exige administrador para modificar). Pestañas: Página principal · Ofertas · Combos · Campañas · Contenido · Historial.
Cada elemento se edita con el ciclo **borrador → revisar → vista previa → publicar → versiones → restaurar**:

- Se guarda un borrador sin afectar la tienda; **Revisar** valida en el servidor (mismos mensajes claros de siempre, marcados junto a cada campo); **Publicar** guarda lo pendiente, revisa y publica EXACTAMENTE la revisión validada (si otra persona cambió algo, hay conflicto y no se publica nada).
- Antes de publicar se muestra qué cambia («Porcentaje de descuento: 20% → 25%»); el historial y las versiones usan el mismo resumen. Restaurar crea una versión nueva y no se permite con cambios sin guardar.
- Cambios sin guardar: el navegador avisa al cerrar y la pantalla pregunta al volver o al tocar un enlace del menú.
- Todo el contenido editable es **dato**: no hay campos para «instrucciones»; el servidor rechaza textos con órdenes al asistente, HTML y claves, y el editor lo dice en cada campo de texto.
- Un administrador edita; agente y lectura ven todo sin poder tocar nada (y aunque una pantalla manipulada lo intentara, la API responde 403).

## La tienda pública lee del CMS (PR 3)

El inicio de la tienda (`/catalogo/{tienda}`) usa lo PUBLICADO en la página principal del CMS. El catálogo sigue siendo la fuente de productos, precios y fotos: el CMS solo **elige** qué mostrar y en qué orden. Este PR **no cambia ningún precio** (el precio efectivo llega con el PR 4, más abajo).

- **Respaldo total**: sin el módulo, sin migración, sin página principal publicada, con la tienda de tecnología (tiene su propio contenido), ante un error de la base o una lectura de más de 2,5 s, la tienda usa su vitrina de siempre. El HTML del inicio con la configuración de hoy queda guardado en `components/catalogo-publico/tienda/__dorados__/` y una prueba exige que sea idéntico byte a byte.
- **Nunca a medias**: la portada solo sale con imagen LISTA y título; un botón o banner solo existe si su destino existe y está activo hoy (categoría borrada, oferta vencida, campaña de otra modalidad, número de WhatsApp inválido: no se muestra).
- **Imágenes**: salen por `/catalogo/{tienda}/vitrina/{id}.webp` (nunca la dirección de Storage), con las medidas reales del archivo y solo si están usadas por contenido publicado.
- **Secciones**: las visibles que la tienda sabe dibujar (portada, categorías, destacados, banner, campaña y —desde el PR 4— ofertas y combos), en el orden elegido. Si no hay lista, el orden de siempre.
- **Destacados, categorías y productos de la campaña** se resuelven contra el catálogo real (activos y del negocio); si ninguno sirve, el criterio automático de siempre.
- **Campaña**: una sola, la vigente de mayor prioridad que tenga portada o productos (modalidad detal, `[desde, hasta)` en hora de Bogotá).
- **Siembra**: `supabase/provisioning/delacour/03_sembrar_vitrina_actual.sql` (generado por `siembra-vitrina.ts`) publica la portada y el banner de hoy como versión 1; la tienda leída del CMS es idéntica a la de hoy (prueba `inicio-siembra.pglite.test.tsx`).

## El precio efectivo: ofertas y combos en la tienda, el carrito y el pedido (PR 4)

**Una sola decisión de precio.** El precio que se *muestra* (tarjeta, ficha, carrito), el que se *firma* (cotización) y el que se *cobra* (pedido, motor de pedidos, herramientas de ARIA) sale del mismo cálculo: la oferta publicada baja el precio de verdad y no puede existir una diferencia entre lo mostrado y lo cobrado.

- **Puerto** (`lib/catalogo/precios.ts`, sin dependencia del CMS): `precioQueRige(producto, canal, efectivo)` es la decisión única. La oferta solo rige si deja un precio entero, positivo y MENOR que el de lista del mismo producto y canal, y fue calculada sobre ese mismo precio de lista; en cualquier otro caso rige el precio de lista. El repositorio del catálogo puede traer un `PuertoPrecios` opcional (`conPrecios`); sin él —módulo apagado, sin migración— el precio es exactamente el de lista de siempre.
- **CMS** (`precios.ts`): implementa el puerto preguntando a `evaluacion.ts` con lo PUBLICADO y el reloj inyectado. Una sola oferta por producto (mayor prioridad; empate: mejor precio para el cliente; luego la más antigua; luego el código). Con el módulo encendido siempre hay evaluador (aunque no haya ofertas): así la tienda sabe que sus precios pueden cambiar al publicar. `precios-supabase.ts` es el cableado real (`repositorioConPrecios`).
- **Falla cerrada para quien cobra.** La cotización y el pedido verifican las ofertas de forma ESTRICTA: si el negocio usa ofertas y no se pudieron leer, el pedido no se prepara (`PreciosNoDisponibles`). Las vitrinas y listados NO se caen: muestran el precio de lista y dejan el aviso en el registro.
- **Sin precios viejos**: con ofertas (o en el canal mayorista) la selección de la tienda responde `private, no-store`; sin el módulo queda la caché corta de siempre. Si una oferta se pausa o vence entre la cotización y el pedido, el pedido NO sale con el precio viejo: se ajusta (`price_changed`) y el cliente confirma de nuevo.
- **Evidencia en el pedido**: la línea guarda el precio efectivo y, solo si una oferta fijó ese precio, `list_price` y `offer {key, name, version}` en el mismo JSON de las líneas (la función SQL solo lee referencia y cantidad: sin migración). Los eventos v2 del pedido NO cambian de contrato (precio efectivo y nada más). El panel y la vista de ARIA muestran el precio de lista y el nombre público de la oferta, nunca su código.
- **Mensaje de WhatsApp**: solo suma «Incluye ofertas vigentes (ahorro: $X)» (un monto): ningún texto escrito por la administradora entra al mensaje que lee el webhook.
- **Mínimo mayorista**: se calcula sobre `order.total`, que ya es el valor final con las ofertas aplicadas.
- **Canal** siempre por backend: la oferta mayorista no toca el precio detal ni viceversa, y el cliente detal jamás recibe precios, ofertas ni combos mayoristas.
- **Combos (Etapa 1)**: se muestran en el inicio con lo que incluyen, su precio, el «precio normal» (la suma de lo que se paga hoy por separado, ofertas incluidas) y su disponibilidad (la calcula el backend con el inventario real; nunca el stock exacto). No se compran desde el carrito: el único botón es «Pedir con una asesora» (WhatsApp) y solo aparece si el combo está disponible y el negocio tiene un número válido.
- **Ofertas en la home**: la sección anuncia el beneficio, qué cubre, hasta cuándo y las condiciones; los botones y banners solo llevan a una sección que está en la página (o a la campaña que esa sección muestra), nunca a un ancla vacía.
- **Una lectura por página**: la vitrina, los datos de los combos y los precios del inicio comparten una sola lectura de lo publicado (`lectura-publicada.ts`); las rutas de selección y pedido, el motor de pedidos y ARIA no memoizan: siempre leen lo vigente en ese momento. Cada visita a la tienda de un negocio SIN el módulo suma una consulta pequeña que responde «sin CMS» (si esto pesara, el siguiente paso sería recordar «sin CMS» unos segundos por negocio).
- **Límite conocido**: el filtro de precio máximo de la búsqueda de ARIA (consulta SQL sobre el precio de lista) puede no incluir un producto con descuento cuyo precio de lista supere el máximo; nunca incluye de más.

## ARIA lee del CMS (PR 5)

ARIA (Gemini) conoce lo comercial **solo** por cuatro herramientas de lectura del backend, nunca por el prompt: lo que escribe la administradora es DATO estructurado, jamás instrucción.

| Herramienta | Qué devuelve |
|---|---|
| `consultar_ofertas` | Las ofertas vigentes del canal; con una `referencia` ya vista, la ÚNICA oferta que le aplica con su precio de lista y el que paga hoy; con una `categoria`, las que cubren esa categoría completa |
| `consultar_combos` | Los combos vigentes: componentes, cantidades, precio, ahorro, disponibilidad (con el inventario real; nunca el stock exacto) y vigencia. No se compran desde el carrito: los cierra una asesora |
| `consultar_campanas` | Las campañas vigentes y las ofertas y combos que incluyen |
| `consultar_contenido_comercial` | Los textos publicados de un tema de lista cerrada (horarios, ubicación, pagos, envíos, garantías, cambios, devoluciones, mayoristas, materiales, promociones, preguntas frecuentes) con las variables ya resueltas (`{{minimo_mayorista}}` → `$750.000`) |

**Contrato.** Entradas estrictas: el modelo no puede pasar negocio, canal, fecha ni precio (salen del turno). Salidas estrictas: `empty: true` es la ÚNICA base para decir «por ahora no hay»; si no hay lector, el módulo está apagado, la lectura falla o la instantánea es de otro negocio, la herramienta responde `UNAVAILABLE` (nunca un vacío falso) y `FORBIDDEN` si el número no es del negocio. Solo lo publicado, vigente y aplicable al canal del cliente (un texto «mayorista» o una oferta mayorista jamás llegan a un cliente detal). Siempre se lee en el momento: nada se memoiza entre turnos.

**La guarda de anclaje comercial** (`lib/agente/comercial-anclaje.ts`) vigila lo que el modelo escribe y solo lo deja salir si lo que devolvieron las herramientas **en ese turno** lo respalda (el porcentaje que escribe el cliente, o un texto del prompt, no respaldan nada: así no hay dos verdades). Códigos: `percent_unbacked`, `discount_unbacked`, `offer_unbacked`, `combo_unbacked`, `campaign_unbacked`, `absence_unbacked` («no hay…» sin una lectura vacía), `validity_unbacked` (fechas, rangos «hasta…», urgencias), `wholesale_leak` y `policy_figure_unbacked` (plazos de garantía, cambios, etc.). Las preguntas, las negaciones y los condicionales no cuentan como afirmaciones. Si el modelo afirma algo sin respaldo, se le pide corregir UNA vez; si insiste, el cliente recibe un mensaje fijo y la conversación pasa a una asesora (nunca se envía lo que dijo). La traza solo guarda los códigos, sin ningún texto. **Límite honesto**: una paráfrasis cualitativa de una política («aceptamos todo tipo de cambios») o una respuesta elíptica sin palabras clave no se puede verificar por palabras.

**Dónde corre.** En el turno normal y también en las preguntas durante el checkout (lectura pura: el checkout no cambia). Solo en los números que tengan alguna de las cuatro herramientas en su lista: sin ellas (Delacour hoy, ASLC, AMORE) el prompt, la guarda y la traza son EXACTAMENTE los de siempre (`HERRAMIENTAS_ASLC` las excluye a propósito).

**El prompt no lleva ningún dato comercial**: con las herramientas, solo se agrega una sección corta con CÓMO consultarlas (antes del estado de la conversación, que sigue siendo lo último).

**Migración de los textos del prompt** (decisión del dueño: el CMS publicado es la única fuente de verdad, pero NO se retira nada de golpe). Los 22 textos comerciales de ARIA pasan al CMS como borradores (script 04), la administradora los revisa y publica, se habilitan las herramientas SOLO para un piloto de números (05, con `negocio.comercial_piloto`), se verifica con conversaciones reales, se abren a todos los clientes (05b) y recién entonces se retiran del prompt tema por tema (06). Cada paso se niega a correr fuera de orden, tiene su reversa y lo prueba Postgres embebido con datos sintéticos (ver `supabase/provisioning/delacour/README.md`).

**Piloto por número** (`negocio.comercial_piloto`, `lib/agente/piloto-comercial.ts`). Las herramientas se habilitan por LÍNEA del negocio, no por cliente; para probar el CMS con ARIA sin abrirlo al público, la configuración admite una lista de números (`wa_id`: solo dígitos con el indicativo del país, de 1 a 20). Con la lista, solo esos contactos reciben las herramientas, la guarda anti-invención y la sección «información comercial» del prompt; todos los demás conversan EXACTAMENTE como si el número no las tuviera (mismo prompt byte a byte y mismas herramientas; está probado). Sin la lista, las reciben todos. Se aplica una sola vez, al entrar el turno (`runAgentTurn`). Una lista mal escrita deja la configuración inválida (ARIA no responde): falla cerrada, nunca abierta a todos; los scripts validan cada número con la misma expresión que el esquema (una prueba lo comprueba).

## El pie de página y las preguntas frecuentes (tipo `pie`)

El pie de la tienda «joyería» sale del CMS: la administradora lo edita en **Tienda → Pie de página** (descripción, hasta 3 columnas de enlaces, categorías, contacto, redes sociales y línea de derechos) con el mismo ciclo borrador → revisar → publicar → versión activa, historial y restauración. Hay **uno por negocio** (código fijo `pie`) y solo un administrador lo cambia.

- **Sin pie publicado la tienda no cambia**: `pieDeRespaldo` es el pie de siempre y sus pruebas doradas (`components/catalogo-publico/tienda/__dorados__/pie-*.html`) no pueden variar. Al crearlo, el panel parte de ESE mismo pie (`pieInicial`): publicado tal cual, la tienda se ve igual.
- **Enlaces con cinturón** (`enlaces.ts`): a diferencia de un botón de la portada (lista cerrada de destinos de la tienda), el pie sí sale de la tienda (redes y direcciones propias). Solo `https`, sin usuario/clave ni puerto en la dirección, sin IP, sin nombres de red local ni dominios disfrazados (punycode); una red social exige el dominio de ESA red; los destinos de la tienda son una lista cerrada (inicio, catálogo, mayoristas, categoría, una de sus páginas propias, WhatsApp). El enlace del catálogo mayorista (token secreto) está prohibido en cualquier texto o dirección del pie. `pie.ts` vuelve a revisar al armar los `href`: nada llega al navegador sin pasar dos veces.
- **Nunca un enlace que no lleve a ningún lado**: un destino que hoy no existe (categoría borrada, «Mayoristas» sin mayoristas, WhatsApp sin número) se omite, y una columna sin enlaces disponibles también. El contacto por WhatsApp sale del número de la tienda, nunca de un texto.
- **Carga que nunca rompe la tienda** (`pie-publico.ts`): sin CMS, sin pie, ante un error o pasados 2 s → el pie de siempre. Se pide a la vez que la tienda (no suma espera) y el negocio de la tienda se busca una sola vez por petición (`publico-supabase.ts`).
- **Preguntas frecuentes**: la pestaña **Tienda → Preguntas frecuentes** muestra la página «Mayoristas» como la ve el cliente (introducción, preguntas por `orden`, lo que se suma al final y lo que no se muestra) y agrega una pregunta con solo pregunta + respuesta (tema «Mayoristas», al final del orden, como borrador). Es el mismo contenido que usa ARIA. Ambas pestañas solo se ofrecen donde la tienda las dibuja: el contexto del panel (`GET /contexto`) trae el tema y la configuración de la tienda (`tienda`).

## Páginas propias de la tienda (tipo `pagina`)

La administradora escribe sus propias páginas (política de privacidad, términos y condiciones, cambios y garantías…) en **Tienda → Páginas** y las publica con el mismo ciclo (borrador → revisar → publicar → versión activa, pausar, historial y restauración). Cada una vive en `/catalogo/{tienda}/p/{código}` (el código sale del título al crearla y ya no cambia aunque cambie el título). Hasta 30 por negocio (`LIMITE_POR_TIPO`); solo un administrador las cambia.

- **Se escribe como un mensaje** (`pagina.ts`, PURO): una línea en blanco separa los párrafos, `## ` al principio de una línea hace un subtítulo y `- ` un elemento de lista. Lo que se guarda son **bloques** (`subtitulo`, `parrafo`, `lista`); `bloquesDeTexto` y `textoDeBloques` convierten en los dos sentidos y el panel muestra los problemas mientras se escribe con el MISMO esquema con el que se valida al publicar (`problemasDeBloques`).
- **Solo texto plano**: sin HTML, sin enlaces, sin imágenes ni formato (`bloquePaginaSchema` es estricto: un bloque o campo desconocido se rechaza y el lector lo descarta). React lo escapa al dibujar; una dirección escrita en el texto sale como texto, nunca como enlace. Topes: 200 bloques, párrafo 2000 caracteres, subtítulo 120, lista de hasta 50 elementos de 500, 50.000 caracteres en total. El enlace del catálogo mayorista (token secreto), las variables `{{…}}`, las órdenes al asistente y las claves se rechazan como en cualquier texto del CMS.
- **La tienda solo ve lo publicado** (`pagina-publica.ts`): `cargarPaginaPublica` devuelve `ok`, `no_existe` (404: tienda inexistente, código inválido o página no publicada hoy) o `error` (la base falló o tardó más de 2,5 s: se dice «no está disponible en este momento», no se finge un 404). Las páginas son del tema «joyería»: en otra tienda, la ruta es un 404.
- **El pie enlaza a ellas** (destino `pagina` en `destinoPieSchema`): `pieDesdeCms` solo dibuja el enlace si la página está publicada HOY (el pie se pide junto con los códigos de las páginas publicadas, en una sola lectura: `cargarPiePublico` devuelve `{ pie, paginas }`). Al publicar el pie, un enlace a una página sin publicar es solo una advertencia (`pagina_no_publicada`); una página inexistente o archivada es un error (`elemento_inexistente`).
- **Historial legible**: el texto de una página se resume en una fila («12 bloques → 13 bloques, 2 con cambios»), no un renglón por bloque (`resumenDeCambiosDeBloques`).
- **No las usa ARIA**: son páginas de la tienda para los clientes; lo que ARIA sabe sigue saliendo de **Contenido** (temas como cambios, garantías o devoluciones).

Migración `20261211000000_dulabs_cms_pie_y_paginas.sql` (idempotente; reversa en `supabase/rollbacks/`, que se niega a correr si ya existe un pie o una página): solo amplía dos restricciones (`dulabs_cms_entidades.tipo` y `dulabs_cms_auditoria.entidad_tipo` admiten `pie` y `pagina`, y un único código `pie` por negocio); no crea tablas ni funciones. Antes de aplicarla, crear el pie o una página responde 503 con un aviso claro y todo lo demás funciona.

## Fotos y videos del inicio (tipo `multimedia`)

La administradora cambia sola los videos de la portada, la colección, la marca y los mayoristas, y la imagen de cada categoría, en **Tienda → Fotos y videos** (solo en la tienda «joyería»), con el mismo ciclo borrador → revisar → publicar. Hay **uno por negocio** (código fijo `multimedia`). Lo que no cambia se sigue viendo como siempre (los videos de DuLabs del registro de la tienda).

- **Requisitos por archivo** (`video-requisitos.ts`, una sola fuente para la guía del panel, el aviso del navegador, el servidor y la validación al publicar): MP4 con video H.264 (Baseline, Main o High, 8 bits, nivel ≤ 4.2), sin sonido, no fragmentado, hasta 3 MB (ideal 2), de 4 a 15 s (ideal 6 a 10) y hasta 30 fotogramas por segundo. Medidas ideales: portada y colección 1280×720 y, opcional para el celular, 720×1280; marca 720×900; mayoristas 1280×576. Cada espacio acepta un rango (por ejemplo, portada horizontal de 960×540 a 1920×1080 en 16:9). El índice al final del archivo no es un fallo: el servidor lo mueve al principio.
- **El aviso es inmediato y explica qué arreglar**: antes de subir, el navegador revisa el archivo con el MISMO código que usa el servidor y comprueba que su propio navegador lo abre; la lista muestra cada regla en verde o en rojo con qué hacer. Un video que no cumple no se puede usar. El servidor vuelve a analizarlo al confirmar (la que manda) y al publicar compara lo que la base conoce del archivo (tipo, medidas y peso) con el espacio donde se usa (`video_no_cumple`).
- **La imagen fija** del video (el fotograma que se ve mientras carga) la toma el navegador y sube como imagen. Las imágenes de categoría (ideal 960×1200 px, 4:5, una foto limpia sin texto) se reducen a 1200 px en su lado más largo al subirlas, y su vista previa en el panel tiene la forma real de la tarjeta.
- **Ruta pública con `Range`** (`video-publico.ts`): igual que las imágenes, solo se sirve lo publicado y del propio negocio, con el mismo 404 para todo lo demás; un pedazo (206) no se guarda en cachés compartidas.
- **Un video no se transforma en el servidor** (no hay codificador): se acepta tal cual o se rechaza. Tope de 120 videos por negocio (no existe borrar archivos, porque una versión vieja puede volver a usarlos).

Migración `20261212000000_dulabs_cms_multimedia.sql` (idempotente; reversa en `supabase/rollbacks/`, que se niega a correr si ya existen fotos y videos o algún video): solo amplía tres restricciones (`tipo` de elementos, `entidad_tipo` de la auditoría y `mime_type` de los archivos admite `video/mp4`) y agrega la del código fijo. Antes de aplicarla, crear las fotos y videos responde 503 con un aviso claro y todo lo demás funciona.

## Pruebas

`npm run test:flow` (los archivos están en `scripts/test-flow-manifest.txt`). El SQL se ejecuta de verdad en Postgres embebido (`@electric-sql/pglite`): migración desde cero, sobre un estado previo, varias veces y con su reversa; el repositorio, el servicio y las rutas corren sobre ese SQL.
Las pruebas de **pantalla** (`components/dashboard/tienda/tienda.dom.test.tsx`, jsdom + Testing Library) recorren la interfaz completa contra la API REAL y el SQL REAL: pantalla → cliente → rutas (sesión, rol, módulo) → servicio → base. Importan `@electric-sql/pglite` ANTES que jsdom (PGlite decide de dónde carga su WASM al cargarse el módulo).
Mutación: `python3 scripts/mutacion/cms.py` (quita o invierte una protección a la vez; alguna prueba debe fallar); el pie y las páginas propias tienen la suya: `python3 scripts/mutacion/pie.py` (en Windows: `PYTHONIOENCODING=utf-8 py -3 -X utf8 scripts/mutacion/pie.py`).

## Activación en producción (nada se ejecuta solo)

1. Se fusiona y despliega el código: **inerte** (módulo apagado; sin la migración, el CMS «no existe» y todo sigue igual).
2. El dueño corre `supabase/migrations/20261210000000_dulabs_cms_comercial.sql` (idempotente). Reversa: `supabase/rollbacks/20261210000000_dulabs_cms_comercial.down.sql` (se niega a correr si hay contenido).
3. Se habilita el módulo `cms_comercial` del negocio (fila en `dulabs_tenant_modulos`).
4. El PR 2 (Dashboard) no agrega migraciones: la entrada **Tienda** aparece sola donde el módulo esté habilitado.
5. PR 3 (la tienda lee del CMS): sin cambios de esquema. Con el módulo habilitado y NADA publicado, la tienda sigue idéntica. Se corre `supabase/provisioning/delacour/03_sembrar_vitrina_actual.sql` (después del 02): publica la portada y el banner de hoy como contenido del CMS (la tienda se ve igual) y la administradora los encuentra listos para editar. Reversa: `03_sembrar_vitrina_actual.reversa.sql`.
6. PR 4 (precio efectivo): sin cambios de esquema ni SQL nuevo. Con el módulo habilitado la tienda empieza a leer las ofertas y los combos que la administradora publique; mientras no publique nada, todo sigue idéntico (precio de lista). Para apagarlo basta deshabilitar el módulo del negocio: vuelve el precio de lista.
7. PR 5 (ARIA): el código es **inerte** hasta que el número de ARIA tenga las herramientas comerciales en su lista (`dulabs_agente_runtime_config.herramientas`). El orden, con el SQL ya hecho en `supabase/provisioning/delacour/` (cada script se niega si el anterior no está): desplegar el PR 5 → `07` (estado) → `04` (borradores) → la administradora revisa y publica en Tienda → Contenido → `05` (habilita las herramientas y la guarda SOLO para tu número de piloto: `set dulabs.piloto_comercial = '57XXXXXXXXXX';`) → verificar con conversaciones reales → `05b` (las abre a todos los clientes) → `06` (retira del prompt, de a pocos temas; se niega mientras haya piloto). Reversas: `06_…reversa` → `05_…reversa` (quita también el piloto) → `04_…reversa`. Para apagar ARIA-CMS de inmediato basta la reversa del `05`: ARIA vuelve a ser exactamente la de antes.
8. Pie de página y páginas propias editables: se despliega el código (**inerte**: sin pie ni páginas publicados la tienda es idéntica) y el dueño corre `supabase/migrations/20261211000000_dulabs_cms_pie_y_paginas.sql` en el SQL Editor de Supabase, DESPUÉS de la 20261210000000. Sin ella, «Pie de página» y «Páginas» avisan que todavía no están disponibles. Para comprobar que se aplicó (solo lectura): `select conname, pg_get_constraintdef(oid) from pg_constraint where conname in ('dulabs_cms_entidades_tipo_ck', 'dulabs_cms_entidades_pie_ck', 'dulabs_cms_auditoria_tipo_ck') order by 1;` debe devolver tres filas y las dos restricciones de tipos deben nombrar `'pie'` y `'pagina'`. Reversa: `supabase/rollbacks/20261211000000_dulabs_cms_pie_y_paginas.down.sql`.
9. Fotos y videos editables: se despliega el código (**inerte**: sin nada publicado la tienda es idéntica) y el dueño corre `supabase/migrations/20261212000000_dulabs_cms_multimedia.sql` en el SQL Editor de Supabase, DESPUÉS de la 20261211. Sin ella, «Fotos y videos» avisa que todavía no está disponible y subir un video falla con un aviso. Para comprobar que se aplicó (solo lectura): `select conname, pg_get_constraintdef(oid) from pg_constraint where conname in ('dulabs_cms_entidades_tipo_ck', 'dulabs_cms_entidades_multimedia_ck', 'dulabs_cms_auditoria_tipo_ck', 'dulabs_cms_assets_mime_ck') order by 1;` debe devolver cuatro filas: las restricciones de tipos nombran `'multimedia'` y la de archivos nombra `video/mp4`. Reversa: `supabase/rollbacks/20261212000000_dulabs_cms_multimedia.down.sql` (primero esta y después, si hiciera falta, la del pie).
