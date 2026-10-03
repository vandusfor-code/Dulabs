# catalog_sales · Fase 3B.7 — Panel operativo "Por aceptar" y gestión humana

> **Estado vigente:** este documento describe el cierre de ESA fase; frases como «sin commit», «sin aplicar» o `cierre_aceptacion_humana = false` eran ciertas entonces.
> Qué está aplicado hoy en producción y cómo se activa ASLC: [`CATALOG_SALES_FASE_3B9D.md`](CATALOG_SALES_FASE_3B9D.md).

Estado: implementada y verificada (sin commit, sin push, sin activar). **Sin migraciones ni SQL.** ASLC sigue pausado,
restringido a su número de prueba y con `cierre_aceptacion_humana = false`; Patricia no se creó y el catálogo real no se cargó.

## Auditoría inicial: qué ya existía (3B.5) y qué faltaba

| Pieza | Ya existía | Qué faltaba en 3B.7 |
|---|---|---|
| API lista / detalle / decidir | `GET /api/dashboard/pedidos/por-aceptar`, `GET|POST /api/dashboard/pedidos/{pedido}/aceptacion` (`lib/catalogo/pedidos/por-aceptar.ts`) | Paginación sin tope silencioso (cortaba en 100), orden definido, conversación, responsable, datos faltantes, detalle de un pedido YA procesado |
| Aceptar / rechazar / cancelar | `acceptOrder` (nunca `confirmOrder`), `closeOrder` con `expectedStatus`, idempotencia, documento enmascarado | Carrera simultánea: quien pierde la carrera con la MISMA decisión recibía un 409 en vez de "ya estaba hecho" |
| Permisos | `puedeDecidir` (responsable, respaldo, admins si el negocio lo eligió) + `withCatalog` (sesión, rol admin/agente, módulo) | Un módulo propio para el menú/la API: `pedidos` lo tiene Delacour y no debe ver el ítem |
| Página | `/dashboard/pedidos/por-aceptar` (tarjetas con acciones, solo por URL) | Entrada en el menú, lista/detalle separados, enlace correcto al Inbox (solo mandaba `telefono_cliente`), estados vacío/error/cargando/ya-procesado, testeable |
| Asignación / pausa / Inbox | `dulabs_conversacion_asignaciones`, `dulabs_pausas_chat`, `dulabs_conversacion_estado`, fuentes `asignadas` y `atencion` del panel de pedidos | Mostrar quién tiene la conversación, si la IA está pausada y el estado en el Inbox, y enlazarla (sin una segunda bandeja) |

No se duplicó nada: se extendió el manejador, las rutas y la página existentes.

## Qué se implementó

| Pieza | Archivo | Qué hace |
|---|---|---|
| Módulo propio | `lib/tenant-modulos.ts`, `lib/catalogo/auth.ts` | Id `pedidos_por_aceptar` (genérico en `dulabs_tenant_modulos`: **no necesita migración**; habilitarlo para ASLC es una fila de datos, de 3B.9). `POR_ACEPTAR_MODULE` y su mensaje en `decideCatalogAccess`. |
| Navegación | `components/dashboard/shell/nav.ts`, `Sidebar.tsx` | Ítem "Por aceptar" justo después de "Pedidos", visible solo con `pedidos` **y** `pedidos_por_aceptar`, roles admin/agente (los mismos que exige la API). `modulo` acepta una lista (todos requeridos); los demás ítems siguen con un solo id. `navItemActivo`: solo se ilumina el ítem más específico (no "Pedidos" + "Por aceptar" a la vez). |
| Único camino de las rutas | `por-aceptar-produccion.ts` (`conPorAceptar`) | Sesión + rol que atiende + módulo `pedidos_por_aceptar` + módulo `pedidos`; el negocio sale de la sesión. Las tres rutas (lista, detalle, decisión) pasan por aquí. |
| Lista paginada | `motor.ts` (`listPendingAcceptancePage`, aditivo) + `por-aceptar.ts` | Reutiliza el keyset del historial (`created_at`, número público): más recientes primero, `?limite=1..50` (25), `?cursor=` opaco, respuesta `{ pedidos, siguiente }`. Sin tope silencioso. Cursor/limite inválidos → 400. |
| Datos que la persona necesita | `por-aceptar.ts` | Pedido, cliente, producto (referencia, cantidad, valor), ciudad, departamento, dirección, barrio, referencia de entrega, oficina, modalidad, pago, teléfono, estado, fechas, aviso enviado, respuesta del cliente, documento **enmascarado**, `responsable` (principal, respaldo, quién puede aceptar), `conversacion` (número, teléfono, asignada, IA pausada, estado Inbox), `faltantes` (datos del checkout que no llegaron). |
| Detalle de un pedido ya procesado | `por-aceptar.ts` | Si el pedido pasó por la aceptación y otra persona (o el tiempo) ya lo cerró/aceptó: `200 { pedido: null, procesado: { estado, por, fecha, motivo } }`, **sin datos del cliente**. Un pedido que nunca pasó por la aceptación, o de otro negocio → 404. |
| Concurrencia | `por-aceptar.ts` (`carreraPerdida`) | Si dos personas deciden a la vez y la BD deja pasar a una (compare-and-set), la que pierde con la **misma** decisión recibe `repetido: true` (nada se duplica); con una decisión distinta, 409 y la pantalla recarga el estado actual. |
| Gancho 3B.8 | `por-aceptar.ts` (`alDecidir`) | Se llama una vez por decisión aplicada (negocio, pedido, acción, estado, quién, contacto). Un fallo del gancho no cambia la decisión. **En producción no hay gancho cableado**: aceptar o rechazar no le escribe nada al cliente. |
| Interfaz | `components/dashboard/pedidos/PorAceptar.tsx`, `app/dashboard/pedidos/por-aceptar/{layout,page,[pedido]/page}.tsx` | Lista (vacío / cargando / error con reintento / cargar más / faltan datos / respondió "sí") y detalle (aviso "Pendiente de aceptación humana: NO es una venta", producto y valor, cliente y envío, seguimiento, conversación enlazada, decisión con confirmación y motivo obligatorio, historial). Los componentes reciben `client`/`t`/`toast` por props: se prueban sin sesión real. |

## Flujo final

1. El cliente completa el checkout y recibe el aviso (3B.4/3B.5): el pedido queda `pending_acceptance`, la conversación se asigna a la
   responsable y la IA se pausa.
2. La responsable (o su respaldo, o un admin si el negocio lo eligió) entra a **Pedidos → Por aceptar**: lista paginada, más
   recientes primero.
3. Abre el detalle: ve todo, el aviso, si el cliente respondió "sí" (informativo: no acepta), quién tiene la conversación y el enlace
   al Inbox que ya existe.
4. Decide: **Aceptar** (confirmación explícita → `acceptOrder`: nace la venta y el stock se aparta según la política del negocio),
   **Rechazar** o **Cancelar** (motivo obligatorio; sin venta ni reserva).
5. La pantalla recarga el estado real. Si otra persona decidió primero, ve "Este pedido ya fue procesado" con quién y cuándo.

## Seguridad

- El frontend no es la autoridad: cada llamada revalida sesión, rol (admin/agente), módulos, negocio de la sesión, estado y
  decisión permitida; la BD vuelve a validar (compare-and-set, disparadores).
- El negocio sale **siempre** de la sesión: ni `tenant_id` en la consulta o el cuerpo, ni el número de pedido, ni el cursor lo cambian.
- Documento: solo `•••• últimos4` en lista, detalle, historial, `procesado`, respuesta de decisión, URL y HTML. El documento completo
  nunca llega al modelo ni a este panel (política 3B.4/3B.5 sin cambios).
- Enlace al Inbox: `/dashboard/mensajes?phone_number_id=…&telefono_cliente=…` (el mismo patrón del módulo Pedidos; sin documento ni
  otros datos). Sin permiso para ver el teléfono no hay enlace.
- Fail-closed: sin configuración de aceptación (o inválida) nadie decide (503); lectura de módulos que falla → 500, no se asume habilitado.
- Aceptar usa solo `acceptOrder`; el panel no importa ningún envío al cliente (test estático).

## Multi-negocio

Cada negocio ve y decide solo lo suyo (lista, detalle, procesado, aceptar, rechazar, cancelar). Delacour (sin `pedidos_por_aceptar`)
recibe 403 `MODULE_DISABLED` en las tres rutas y no ve el ítem. Una persona de otro negocio recibe 404 sin ningún dato. Habilitar el
módulo para ASLC no cambia ningún otro ítem del menú.

## Verificación

- Tests nuevos (113, registrados en `scripts/test-flow-manifest.txt`): `lib/catalogo/pedidos/por-aceptar-b37.test.ts` (50: lista, paginación,
  detalle, procesados, acceso, decisión, concurrencia, conversación, multi-negocio, gancho), `app/api/dashboard/pedidos/por-aceptar/por-aceptar-rutas.test.ts`
  (14: sesión, rol, módulos, tenant, parámetros), `components/dashboard/shell/nav-por-aceptar.test.ts` (12: visibilidad y activo único),
  `components/dashboard/pedidos/por-aceptar.dom.test.tsx` (37: interfaz real con jsdom + Testing Library).
- 29 mutaciones (cada una rompe UNA garantía y la suite debe fallar; archivos restaurados con hash verificado): negocio tomado de la petición
  (lista, decisión, detalle), sin autorización, `puede_decidir` para todos, ruta sin módulo propio / sin módulo pedidos / con rol lectura, aceptar o
  rechazar en estado incorrecto, detalle de pedidos que nunca pasaron por aceptación, `confirmOrder` en vez de `acceptOrder`, documento sin máscara,
  datos del cliente en el procesado, documento en la URL, sin protección de carrera, sin compare-and-set, sin protección de doble clic, sin recarga tras
  409, gancho en decisión repetida, paginación cortada, duplicados al cargar más, acciones sin permiso, aceptar sin confirmación, rechazar sin motivo,
  pendiente mostrado como confirmado, nav sin módulo / sin rol / doble activo. Una (negocio en la lista) sobrevivió al principio: el test comprobaba la
  lista después de rechazar el pedido; se corrigió y se repitió.
- Regresión: `tsc --noEmit` y `eslint --max-warnings=0` limpios; `npm run test:flow` 6517 tests, 6516 OK y 1 fallo (B30, preexistente: regex con
  `
` sobre `app/webhook-dulabs/route.ts` contra CRLF de Windows; falla igual en la base 7207d79; no se tocó); 3B.4, 3B.5 (79), 3B.6 (51), perfil,
  aceptación y fase7 en verde; evaluaciones de Delacour (cooperativo y adversario) idénticas a la línea base salvo el token aleatorio de MD05.
- No verificado en navegador real: la página exige sesión real contra Supabase (no se ingresan credenciales) y el servidor de vista previa de esta
  sesión corre sobre otro checkout; la interfaz se verificó con jsdom y la compilación con `tsc`.

## Para 3B.8 (no implementado aquí)

- Textos y envío al cliente tras aceptar/rechazar/cancelar (plantillas, ventana de 24 h, quién los redacta): se engancha en
  `PorAceptarCtx.alDecidir` (ver `DecisionPorAceptar`) desde `por-aceptar-produccion.ts`. Hoy no hay ningún texto aprobado.
- Mensaje al derivar un envío / "no hay cobertura" (viene de 3B.6).

## Para 3B.9 (no implementado aquí)

- Habilitar para ASLC las filas `dulabs_tenant_modulos` (`pedidos` y `pedidos_por_aceptar`) — **datos, con autorización**; sin ellas el
  menú, la página y la API no existen para el negocio.
- Crear a la persona responsable, cargar el catálogo y las reglas de envío reales, `cierre_aceptacion_humana = true` y la activación.

## Límites y riesgos conocidos

- Orden: más recientes primero (keyset reutilizado). La más antigua queda en la última página; si se quiere "la más antigua primero"
  hace falta un keyset ascendente en el repositorio (cambio mayor, no hecho).
- `faltantes` es informativo: el motor ya exige nombre, y dirección y ciudad en domicilio; el resto lo decide el negocio.
- "Contexto mínimo" de la conversación = quién la tiene, IA pausada y estado en el Inbox + enlace; no se copian mensajes al panel
  (podrían contener datos sensibles, p. ej. un documento escrito en el chat).
- Los tests con Supabase en memoria no ejercen el SQL real (`dulabs_catalogo_pedido_transicion`); esa garantía sigue probada por las
  pruebas de 3B.4/3B.5 contra las mismas reglas y por la migración ya aplicada.
