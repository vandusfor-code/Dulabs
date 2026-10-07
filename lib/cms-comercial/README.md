# CMS comercial (Bloque 29)

Contenido comercial **administrable por negocio** (página principal, ofertas, combos, campañas y contenido como preguntas frecuentes o políticas) con un ciclo único:

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
| `testing/` | Fixtures, Postgres embebido (PGlite) y el puente que lleva las llamadas `rpc/dulabs_cms_*` de las rutas al SQL real |

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

## Pruebas

`npm run test:flow` (los archivos están en `scripts/test-flow-manifest.txt`). El SQL se ejecuta de verdad en Postgres embebido (`@electric-sql/pglite`): migración desde cero, sobre un estado previo, varias veces y con su reversa; el repositorio, el servicio y las rutas corren sobre ese SQL.
Mutación: `python3 scripts/mutacion/cms.py` (quita o invierte una protección a la vez; alguna prueba debe fallar).

## Activación en producción (nada se ejecuta solo)

1. Se fusiona y despliega el código: **inerte** (módulo apagado; sin la migración, el CMS «no existe» y todo sigue igual).
2. El dueño corre `supabase/migrations/20261210000000_dulabs_cms_comercial.sql` (idempotente). Reversa: `supabase/rollbacks/20261210000000_dulabs_cms_comercial.down.sql` (se niega a correr si hay contenido).
3. Se habilita el módulo `cms_comercial` del negocio (fila en `dulabs_tenant_modulos`).
4. Los siguientes PRs conectan el Dashboard, la tienda, el precio efectivo y ARIA.
