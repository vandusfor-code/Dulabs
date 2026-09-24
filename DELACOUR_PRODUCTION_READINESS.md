# Delacour — preparación para producción (Catálogo + Agente)

Estado al **24-sep-2026**, actualizado en el **Bloque 23** (robustez del agente antes del piloto).
Documento operativo: qué está listo, cómo se comprobó, qué falta comprobar con servicios reales y
el procedimiento para cargar los productos reales (secciones escritas en el Bloque 21).

**Piloto (Bloque 24):** barreras, matriz de punta a punta, diagnóstico, costo, verificación de
producción de solo lectura y la lista de pruebas manuales están en `DELACOUR_PILOTO.md`.

Leyenda de cómo se comprobó cada cosa:

| Marca | Qué significa |
| --- | --- |
| **U** | Prueba automática sin red (repositorios en memoria que emulan las reglas de la BD) |
| **PG** | PostgreSQL 16 local con las migraciones reales (pruebas SQL y de concurrencia con sesiones paralelas) |
| **E2E** | La app compilada (`next start`) contra PostgreSQL + PostgREST locales con datos sintéticos (hasta 10.000 productos y 2 negocios), y Chromium emulando un celular con 4G lenta |
| **W** | El webhook REAL (`registrarMensajesEntrantesSincrono` + `procesarCambio`) con Supabase emulado en memoria y Meta simulado (B23) |
| **PROD** | Verificado en producción |

---

## 1. Qué está listo

### Catálogo

| Qué | Cómo se comprobó |
| --- | --- |
| Productos, categorías, precio detal y mayorista, stock, activo/inactivo; referencia `DL-…` asignada por la BD e inmutable | U, PG |
| Fotos con 3 versiones (principal ≤2048 px, detalle ≤1200 px, miniatura ≤400 px) | U, E2E |
| Firma de la foto verificada al confirmar; rechazo de fotos inválidas | U, E2E |
| URL pública sin ids internos | U, E2E |
| Fotos: solo se sirve la URL canónica (`?v=`); cualquier otra redirige sin tocar Storage | U, E2E (B20) |
| Carga masiva CSV/XLSX + carpeta o ZIP de fotos, con preview, decisiones por fila, reintentos idempotentes, historial de cargas y compleción posterior de fotos | U, PG |
| Tienda **detal** (`/catalogo/{slug}`) y **mayorista** (`/catalogo/{slug}/mayor/{token}`, token de 64 caracteres, comparación en tiempo constante) | U, E2E |
| Listado paginado de 48 productos; búsqueda indexada (sin tildes, plurales, color, material, categoría) | U, PG, E2E, PROD (migración B20 aplicada) |
| Carrito (≤60 referencias) y pedido por WhatsApp; precio, stock y total calculados SIEMPRE en el servidor; cotización firmada | U, E2E |
| Reserva de stock ATÓMICA al confirmar; cancelar o vencer devuelve el stock | U, PG (30 confirmaciones simultáneas por 5 unidades ⇒ exactamente 5), PROD (migración B19 aplicada) |
| Vencimiento de reservas a las 72 h: cron diario + al abrir el panel | U, PG |
| Panel de pedidos: abiertos (cerrar venta o cancelar) e **historial de cerrados paginado por cursor** (B21) | U, PG, E2E |
| Límites de tasa distribuidos | U, PG |

Detalle de los límites de tasa:

| Ruta | Límite |
| --- | --- |
| Pedido | 20 por IP cada 10 min + 1.000 por catálogo por hora |
| Carrito | 120 por IP por minuto |
| Páginas (B21) | 600 por cliente por minuto |
| Búsquedas (B21) | 120 por cliente por minuto + 3.000 por catálogo por minuto |

### Agente (Gemini, exclusivo de Delacour)

| Qué | Cómo se comprobó |
| --- | --- |
| Gemini es el único proveedor; sin clave, el agente no responde (nunca cae a otro modelo) | U |
| Herramientas deterministas: el backend resuelve producto, precio del canal, stock, carrito, pedido y confirmación. Gemini nunca calcula precios, stock ni totales | U |
| Contexto mínimo por turno: entre 0,1 y 1,9 KB por herramienta, nunca el catálogo | U, E2E |
| Fotos por WhatsApp resueltas por el backend (JPEG por URL canónica) | U, E2E |
| Respuesta a una foto enviada ⇒ producto exacto | U |
| Buzón y turno único por conversación | U, PG |
| Topes de costo y abuso por cliente y por negocio | U |
| Traspaso a asesora con motivo | U |
| Trazas, diagnóstico e Inbox | U, PROD |
| Retención de datos | U |
| Mensajes sin texto (B23): nota de voz ⇒ aviso fijo (nombra el producto si responde a una foto); imagen, video, documento, ubicación o contacto ⇒ asesora; sticker y reacción ⇒ nada. Sin Gemini, visibles en el Inbox | U, W |
| Una escritura (pedido, confirmación) que no responde a tiempo ⇒ mensaje fijo "estoy verificando", nunca "falló" ni "listo" (B23) | U |
| Nunca se guarda un pedido sin productos; los pedidos de conversación sin confirmar vencen a las 72 h sin cambios (B23) | U, PG |

### Seguridad (auditada en B20/B21)

- **Aislamiento por negocio.** Todas las consultas filtran por negocio, que sale de la sesión o de
  la publicación, nunca del navegador ni de Gemini. Se probó con 2 negocios que comparten las
  mismas referencias `DL-…`: 0 fugas en búsquedas, carritos, fotos, historial y última unidad.
  Comprobado con U y E2E.
- **RLS.** Está activo en todas las tablas del catálogo, sin políticas para `anon` ni
  `authenticated`: el rol `anon` ve 0 filas. Las funciones con privilegios elevados son triggers
  (no se pueden invocar) o están restringidas a `service_role`. Comprobado con PG.
- **Validación de datos en dos capas** (dominio y restricciones de la BD):
  - precio ≥ 0 y stock ≥ 0;
  - cantidades entre 1 y 99;
  - hasta 60 líneas por pedido;
  - formato de referencia;
  - textos con largo máximo.
- **Manipulación desde el navegador.** Ni el precio ni el canal (detal/mayor) se aceptan del
  cliente; el canal lo decide la ruta autorizada. El cursor del historial es opaco y se valida;
  si llega manipulado, se rechaza con 400.
- **Errores.** Los inesperados devuelven un mensaje genérico; el detalle solo va al log del
  servidor.
- **Logs.** No registran teléfonos, cuerpos de mensajes ni IPs en claro.
- **Secretos.** Ningún componente de cliente importa el cliente de Supabase con privilegios. Las
  únicas variables `NEXT_PUBLIC_*` con nombre de clave son claves públicas por diseño.
- **Caché y cabeceras.**
  - Tienda y mayorista: `private, no-store`.
  - Fotos: caché de 1 día por versión.
  - La página 429 nunca se cachea.
  - Política de referrer: `strict-origin-when-cross-origin`, así el token mayorista no viaja a
    otros sitios.
  - Hay CSP, `X-Frame-Options`, `nosniff` y HSTS.

### Rendimiento (con 10.000 productos sintéticos, E2E)

| Métrica | Resultado |
| --- | --- |
| Páginas de la tienda | 27–56 ms, de 7 a 9 consultas (incluida la del límite de tasa) |
| HTML de la página | 8–19 KB comprimido |
| LCP en celular con 4G lenta | ~1,9–2,2 s |
| Fotos que descarga el listado al abrir | 11 de 43 |
| Precargas al abrir el listado y hacer scroll | 2 (antes del B21: 53 precargas y 470 consultas) |
| Historial de pedidos con 100.000 pedidos cerrados | ~0,1 ms por página con el índice del B21 |

---

## 2. Qué requiere servicios reales (no se puede probar localmente)

| Área | Qué falta comprobar en real |
| --- | --- |
| **Supabase real** | Aplicar la migración opcional `20261118000000_dulabs_catalogo_pedidos_historial.sql` (ver `PENDING_MIGRATIONS.md`). Subida real de fotos al bucket `inventario-productos` (URLs firmadas). La primera carga masiva real. Latencia real Vercel→Supabase (en local cada consulta tarda ~1–5 ms; en producción serán algunos ms más). |
| **Meta / WhatsApp** | Que Meta descargue las fotos `whatsapp.jpg` (URL pública y JPEG). Webhook entrante con el número de Delacour. Ventana de 24 h. Botón "pedir por WhatsApp" desde la tienda abriendo el chat real. |
| **Gemini** | Configurar la variable `GEMINI_KEY_DELACOUR` en Vercel. Revisar la calidad real de las respuestas, la latencia y el costo por conversación. El agente solo se activa con `ia_restringida_a` limitado a números de prueba (ver la sección 5). |
| **Vercel** | Que el proxy (`proxy.ts`) aplique los límites en producción: el contador se comparte entre instancias en Postgres. Core Web Vitals reales con las fotos reales (PageSpeed Insights sobre la URL de la tienda en móvil). |

## 3. Qué NO se debe probar todavía

- Abrir el agente a clientes reales o a más números: `ia_restringida_a` debe seguir limitado a
  los números de prueba.
- Ajustar la personalidad o los textos del agente.
- Cargar el catálogo completo sin hacer antes el piloto de la sección 4.
- Pruebas de carga o de abuso contra producción. Las pruebas de carga se hacen en local con
  `scripts/perf`.
- Campañas o tráfico masivo hacia la tienda antes de revisar las Core Web Vitals con las fotos
  reales.

---

## 4. Procedimiento exacto para cargar los productos reales

### 4.0 Antes de empezar (una sola vez)

1. Revisar en `PENDING_MIGRATIONS.md` que todas las migraciones del catálogo estén aplicadas (B10
   a B21). La del B21 es opcional: sin ella el historial funciona igual, solo más lento con mucho
   volumen.
2. En el panel:
   - el módulo **Catálogo** está habilitado;
   - existe la **publicación**, con su link detal y su link mayorista;
   - el negocio tiene su **número de WhatsApp** conectado (es el destino de los pedidos de la
     tienda).
3. Las categorías pueden crearse en el preview de la carga. No hace falta crearlas antes.

### 4.1 Preparar las fotos

- Cuadradas, 2048×2048 px, JPG o WebP, fondo claro uniforme y la pieza centrada (ver la
  instrucción de fotos usada con ChatGPT).
- HEIC no se acepta: hay que exportarlas a JPG.
- Cada foto pesa como máximo 30 MB antes de optimizarla; el navegador la optimiza antes de
  subirla.
- Hasta 12 fotos por producto, y la primera es la principal.
- **Nombres:** la foto se relaciona con el producto de forma determinista, nunca por parecido.
  Hay tres formas:
  - con el `codigo` interno (`AN-014.jpg`, `AN-014-2.jpg`);
  - con el nombre (`anillo-corazon.jpg`, `anillo-corazon-2.jpg`);
  - con una **carpeta por producto** (`Anillo Corazón/1.jpg`, `2.jpg`…).

  Si hay duda, la foto no se asigna sola: el preview muestra los candidatos para elegir.
- Entregarlas como **carpeta**, que es lo recomendado: el navegador no carga toda la carpeta en
  memoria. También se acepta un ZIP de hasta 600 MB y 5.000 entradas; los ZIP cifrados o
  manipulados se rechazan.

### 4.2 Preparar la planilla (CSV o XLSX)

- Columnas obligatorias: `nombre`, `precio_detal` (pesos enteros) y `stock`.
- Columnas opcionales: `categoria`, `precio_mayor`, `material`, `color`, `descripcion`, `codigo`
  (solo sirve para encontrar fotos) e `imagenes`.
- **No incluir la columna de referencia:** la asigna el sistema (`DL-000001`…).
- **Máximo 2.000 filas y 4 MB por archivo.** Si el catálogo supera las 2.000 filas, dividirlo.
  Se recomienda un archivo por categoría (300–600 filas): cada preview es más fácil de revisar.
  Dividir es seguro, porque un archivo nunca duplica lo que ya importó otro.

### 4.3 Piloto (obligatorio)

1. Importar **10–20 productos** con sus fotos, de categorías distintas y con y sin precio
   mayorista.
2. Comprobar en la tienda detal y en la mayorista:
   - el listado, la búsqueda por nombre y por referencia, y un filtro de categoría;
   - la ficha, las fotos y el precio de cada canal;
   - agregar al carrito y el botón de WhatsApp.
3. Comprobar en el panel que las referencias asignadas, el stock y las fotos sean correctos.
4. Si algo está mal, corregir los productos del piloto (editar o desactivar) antes de seguir.
   **Una carga no se puede deshacer en bloque**: por eso existe el piloto.

### 4.4 Carga completa, por archivos

Por cada archivo:

1. Subir la planilla y la carpeta de fotos.
2. Revisar el preview **antes de confirmar**:
   - filas con error (se corrigen en el archivo y se vuelve a subir);
   - **repetidos** ("ya importado" o "posible repetido": se omiten, salvo que se marque
     "importarlo de todas formas");
   - **fotos con duda** (elegir la correcta);
   - **fotos sin usar** (fotos que no coincidieron con ningún producto);
   - **categorías nuevas** (crear, usar una existente o dejar sin categoría).
3. Confirmar y esperar el resultado.
   - Las filas se procesan en lotes de 20 y las fotos en lotes de 10.
   - Una fila con error no detiene a las demás.
   - Ante un error de red, el lote se reintenta solo.
   - **No importar el mismo archivo en dos pestañas a la vez.**
4. Si la carga queda **"Interrumpida"** (se cerró la pestaña o se cayó la red), volver a subir **el
   mismo archivo con las mismas fotos**. Lo ya creado sale como "ya importado" y solo se completa
   lo que falta, incluidas las fotos pendientes.

### 4.5 Después de cargar

1. En el panel, comprobar el total de productos y los que quedaron **sin foto**. Las fotos se
   pueden completar después: se vuelve a subir el mismo archivo con las fotos y solo se agregan a
   los productos importados sin foto, sin tocar sus datos.
2. Revisar 20 productos al azar en la tienda.
3. Probar búsquedas reales: "aretes dorados", un material, un color y una referencia.
4. Medir las Core Web Vitals reales con PageSpeed Insights en móvil sobre la URL de la tienda.
   Objetivo: LCP < 2,5 s.
5. Recién entonces, activar el agente con los números de prueba (sección 5).

## 5. Activación del agente (después de la carga, con números de prueba)

Sigue el procedimiento de `PENDING_MIGRATIONS.md` (Fase 8, "Activación del piloto de Delacour"):

1. Configurar `GEMINI_KEY_DELACOUR` en Vercel.
2. Crear la fila de configuración del agente.
3. Poner en `ia_restringida_a` solo los números de prueba.
4. Solo al final, `ia_pausada = false`. Nunca poner `ia_pausada = false` antes de que exista la
   fila del agente.

---

## 6. Límites conocidos (por diseño)

| Límite | Valor | Por qué |
| --- | --- | --- |
| Filas por archivo de carga | 2.000 (4 MB) | El preview muestra todas las filas para revisarlas; se divide el archivo |
| Fotos por carga | 6.000 (ZIP ≤600 MB, 5.000 entradas) | Memoria del navegador |
| Fotos por producto | 12 | Galería de la ficha |
| Productos por página de la tienda | 48 | Carga incremental; nunca el catálogo completo |
| Carrito | 60 referencias; hasta 99 unidades por línea | Abuso y tamaño del mensaje |
| Resultados de búsqueda | hasta 220 (11 páginas) | Más allá, se pide refinar |
| Pedidos abiertos en el panel | 100 más recientes | Los cerrados están en el historial, paginado |
| Reserva de stock | 72 h (los pedidos con asesora no vencen solos) | Regla del negocio |
| Pedido de conversación sin confirmar (borrador o propuesta) | vence a las 72 h sin cambios (B23) | No queda "abierto" para siempre |
| Aviso "no puedo escuchar audios" | uno cada 10 min por conversación | Diez audios seguidos no generan diez avisos |
| Espera de una escritura del agente | 20 s (lecturas: 5 s) | Cortar antes solo crea incertidumbre |
| Páginas por cliente | 600/min (búsquedas 120/min; 3.000/min por catálogo) | Frena scripts, no a personas |

Otros comportamientos por diseño:

- El cron de vencimiento es diario (plan de Vercel); además, el vencimiento corre al abrir el
  panel. Desde B23 también vence los pedidos de conversación abandonados.
- Mensajes sin texto en el número del agente (B23): el Inbox muestra el tipo (`[nota de voz]`,
  `[imagen] leyenda`, `[documento] archivo.pdf`, `[ubicación]`, `[contacto]`), nunca coordenadas ni
  teléfonos de terceros. La asesora ve la imagen o el archivo en WhatsApp: el Inbox todavía no
  descarga la media entrante. Motivo de la asesora: "algo que el asistente no puede resolver"; el
  tipo exacto queda en la traza (`non_text`).
- La tienda no se indexa en buscadores (`noindex`).

## 7. Riesgos restantes

1. **Fotos subidas y nunca confirmadas.** Si alguien abandona una carga a mitad de la subida,
   el archivo queda en el bucket sin usarse. Solo pueden subir usuarios con permiso de escritura
   del catálogo. El bucket `inventario-productos` es **compartido con AMORE**, así que no se le
   pusieron límites a nivel de bucket ni un barrido automático, para no afectar a AMORE. Si hace
   falta, se agrega una limpieza acotada a las rutas del catálogo.
2. **Una carga no se deshace en bloque.** Por eso el piloto es obligatorio. Los productos se
   pueden editar o desactivar uno por uno.
3. **Dos cargas simultáneas del mismo archivo** (dos pestañas) podrían duplicar productos: la
   detección de "ya importado" ocurre al analizar. Mitigación: la regla de operación "una carga a
   la vez".
4. **Ataques distribuidos grandes** (miles de IPs). Los límites por cliente y el tope de
   búsquedas por catálogo protegen la base, pero la defensa de red corresponde al firewall de
   Vercel. Si hubiera un ataque, conviene configurar allí una regla para `/catalogo/*`.
5. **Latencia real Vercel→Supabase** no medida; en local cada consulta toma ~1–5 ms. El límite de
   tasa suma una consulta por página, y si el limitador no responde en 400 ms se permite la
   visita.
6. **Imágenes que llegan al número del agente.** Pasan a una asesora siempre (pueden ser un
   comprobante de pago o una captura de un producto): la asesora debe revisarlas en WhatsApp. Si
   el volumen de capturas de productos fuera alto, el siguiente paso sería una búsqueda por imagen,
   que hoy no existe (Gemini no ve imágenes en este flujo).
7. **Solicitudes del catálogo nunca enviadas por WhatsApp** (el cliente armó el carrito y no
   envió el mensaje): quedan como `validated` sin contacto. No aparecen en el panel ni en ninguna
   conversación, y no se vencen para no romper un envío tardío; son registros inertes.
8. **Pruebas dependientes del reloj (preexistentes, de AMORE/agenda).**
   `lib/agenda-v2/disponibilidad-cadena-real.test.ts` y `lib/amore-conversacion-matriz.test.ts`
   eligen el día con la fecha real y fallan a ciertas horas. Fallan igual en `main`, no son del
   catálogo y no se tocaron.
