# Fotos y videos de tu tienda: medidas, peso y formato

Guía para quien administra la tienda (en Delacour, la administradora) y para el equipo de DuLabs. Se usa en **Tienda → Fotos y videos** del panel.

> Todo lo que está en las tablas de esta guía lo comprueba una prueba automática contra el código (`lib/cms-comercial/guia-videos.test.ts`): si cambia un límite en el sistema y esta guía no se actualiza, la prueba falla.

## Qué puedes cambiar tú

| Qué | Dónde se ve en la tienda | Dónde se cambia |
|---|---|---|
| Video de la **portada** (horizontal y, si quieres, vertical para el celular) | Detrás del texto de lo primero que ve el cliente | Tienda → Fotos y videos |
| Video de la **colección** (horizontal y, si quieres, vertical) | El video a pantalla completa que aparece al bajar de la portada | Tienda → Fotos y videos |
| Video de la **marca** | La tarjeta junto al texto de presentación de tu marca | Tienda → Fotos y videos |
| Video de **mayoristas** | El fondo de la banda «Compra al por mayor» y de la página de mayoristas | Tienda → Fotos y videos |
| **Imagen de cada categoría** | El carrusel de categorías del inicio | Tienda → Fotos y videos |
| Productos destacados, categorías que aparecen en el inicio (y su orden), foto de la portada, banner y orden de las secciones | El inicio | Tienda → Página principal |
| Pie de página, redes sociales, páginas (políticas y términos) y preguntas frecuentes | Todas las pantallas / sus propias páginas | Tienda → Pie de página, Páginas y Preguntas frecuentes |

Lo que no cambias sigue viéndose como siempre. **Nada se ve en tu tienda hasta que pulsas «Publicar»**, y siempre puedes volver al video de siempre con «Volver al video de siempre».

## Cómo se cambia un video (4 pasos)

1. Entra a **Tienda → Fotos y videos** y, en el espacio que quieras cambiar, pulsa **Elegir un video**.
2. El sistema **revisa el video al instante** (sin subirlo todavía) y te muestra una lista: cada regla en verde si cumple o en rojo si no, y qué hacer para arreglarla. Un video que no cumple **no se puede usar**.
3. Si todo está en verde, pulsa **Usar este video**. Se sube y el servidor lo vuelve a revisar.
4. Pulsa **Guardar borrador** y luego **Publicar**.

## Medidas de cada espacio

| Espacio | Medidas ideales (px) | Se acepta entre (px) | Proporción |
|---|---|---|---|
| Portada · pantalla horizontal | 1280 × 720 | 960 × 540 — 1920 × 1080 | 16:9 |
| Portada · pantalla vertical (celular) | 720 × 1280 | 540 × 960 — 1080 × 1920 | 9:16 |
| Colección · pantalla horizontal | 1280 × 720 | 960 × 540 — 1920 × 1080 | 16:9 |
| Colección · pantalla vertical (celular) | 720 × 1280 | 540 × 960 — 1080 × 1920 | 9:16 |
| Marca · tarjeta | 720 × 900 | 576 × 720 — 1080 × 1350 | 4:5 |
| Mayoristas · banda de fondo | 1280 × 576 | 960 × 432 — 1920 × 864 | 20:9 (o 16:9) |

El video vertical de la portada y de la colección es **opcional**: si no lo subes, el celular usa el horizontal, recortado. Si subes un vertical, primero tiene que existir el horizontal.

## Reglas para todos los videos

| Regla | Límite |
|---|---|
| Formato | MP4 con video H.264 (el que se ve en todos los navegadores y celulares) |
| Peso | hasta 3 MB por archivo (lo ideal: 2 MB o menos) |
| Duración | de 4 a 15 segundos (lo ideal: 6 a 10); el video se repite sin fin |
| Fotogramas | hasta 30 por segundo (24 o 30) |
| Perfil de H.264 | Baseline, Main o High, de 8 bits, nivel 4.2 o menor |
| Sonido | ninguno (sin pista de audio) |
| Estructura | MP4 normal (no fragmentado). Si la información de reproducción quedó al final del archivo, el sistema la mueve al principio solo |

Además, por buen resultado:

- **Sin texto dentro del video**: el texto de tu tienda se escribe encima y se lee mejor.
- Sin destellos ni parpadeos fuertes, y con lo importante hacia el centro (en el celular se recorta).
- Solo videos propios o con licencia. Va sin sonido, así que no pongas música.
- Un archivo de más de 60 MB ni siquiera se abre: solo se te dice cuánto pesa y a cuánto bajarlo.
- Hasta 120 videos subidos por tienda en total (no se pueden borrar: una versión anterior publicada puede volver a usarlos).

## Imagen de cada categoría

- Medidas ideales: **960 × 1200 px** (vertical, proporción 4:5); mínimo 600 × 750 px.
- JPG, PNG o WebP. En pantallas grandes se ve hasta a unos 480 px de ancho (el doble de nítida en las de alta definición); si tu foto es más grande, **se reduce sola a 1200 px** en su lado más largo al subirla.
- **Elige una foto limpia, sin texto ni collage de varias fotos**: la tienda la recorta a 4:5 y escribe encima el nombre de la categoría. Una foto de producto con letras o con varias fotos juntas queda recortada a medias.
- En el panel, la vista previa de cada categoría tiene la forma real de la tarjeta (4:5), para que veas cómo se recorta.
- Si una categoría no tiene imagen elegida, la tienda usa la foto de uno de sus productos (y si ninguno tiene foto, solo muestra su inicial).
- Hasta 60 categorías con imagen.

## Cómo preparar tu video

**Con HandBrake** (gratis, para computador):
1. Abre tu video y elige el ajuste **«Fast 720p30»**.
2. Formato: **MP4**. Marca **«Optimizado para web»**.
3. Calidad: **RF 28**.
4. En «Audio», borra la pista de audio.
5. Recorta el video a 6–10 segundos y guarda.

**Con CapCut, Canva, Clipchamp o Adobe Express:** exporta a 720p y 30 fotogramas por segundo, con el sonido silenciado, y recorta el video a 6–10 segundos.

**Si grabaste con un iPhone:** Ajustes › Cámara › Formatos › **«Más compatible»** (así graba en H.264 y no en HEVC).

**Para quien usa ffmpeg**, un comando por tamaño (recorta al centro, quita el sonido, 30 fps, H.264 estándar, índice al principio y un tope de velocidad que mantiene el peso bajo 2 MB en 10 segundos):

Portada y colección, horizontal (1280 × 720):

```bash
ffmpeg -i entrada.mp4 -an -t 10 -vf "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=30" -c:v libx264 -profile:v main -level 4.0 -pix_fmt yuv420p -crf 28 -preset slow -maxrate 1500k -bufsize 3000k -movflags +faststart salida.mp4
```

Portada y colección, vertical (720 × 1280):

```bash
ffmpeg -i entrada.mp4 -an -t 10 -vf "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=30" -c:v libx264 -profile:v main -level 4.0 -pix_fmt yuv420p -crf 28 -preset slow -maxrate 1500k -bufsize 3000k -movflags +faststart salida.mp4
```

Marca (720 × 900):

```bash
ffmpeg -i entrada.mp4 -an -t 10 -vf "scale=720:900:force_original_aspect_ratio=increase,crop=720:900,fps=30" -c:v libx264 -profile:v main -level 4.0 -pix_fmt yuv420p -crf 28 -preset slow -maxrate 1500k -bufsize 3000k -movflags +faststart salida.mp4
```

Mayoristas (1280 × 576):

```bash
ffmpeg -i entrada.mp4 -an -t 10 -vf "scale=1280:576:force_original_aspect_ratio=increase,crop=1280:576,fps=30" -c:v libx264 -profile:v main -level 4.0 -pix_fmt yuv420p -crf 28 -preset slow -maxrate 1500k -bufsize 3000k -movflags +faststart salida.mp4
```

## Qué te dice el sistema cuando un video no sirve

| Lo que ves | Qué significa | Qué hacer |
|---|---|---|
| «No es un video MP4» | El archivo es MOV, AVI, MKV o WebM, o no es un video, o está dañado o incompleto | Expórtalo de nuevo como MP4 con video H.264 |
| «Pesa más de 3 MB» | Es demasiado pesado para cargar rápido en un celular | Baja las medidas al ideal de ese espacio, recórtalo a 6–10 s y exporta con calidad media (HandBrake: «Fast 720p30», RF 28) |
| «Dura más de 15 s» o «menos de 4 s» | Fuera del rango | Recórtalo a unos 8 s, o alárgalo o repítelo hasta 4 s |
| «El video es H.265 (HEVC)» u otro códec | El formato de los iPhone y de muchas cámaras no se ve en todos los navegadores | Expórtalo como H.264 (iPhone: «Más compatible») |
| «Perfil High 10» o nivel mayor a 4.2 | Video de 10 bits o 4:2:2 | Perfil Main o High a 8 bits |
| «Trae una pista de audio» | Tiene sonido, aunque en la tienda no suene | Quítale el sonido al exportar |
| «Más de 30 fotogramas por segundo» | Pesa el doble y no se nota en una portada | Exporta a 30 (o 24) fotogramas |
| «Proporción» o «Medidas» | No tiene la forma o el tamaño de ese espacio | Usa las medidas de la tabla; si es vertical, súbelo en el espacio vertical (el mensaje te dice cuál) |
| «Está dividido en fragmentos» | Es un MP4 de transmisión en vivo | Expórtalo de nuevo como MP4 normal |
| «Se reproduce en tu navegador» en rojo | Tu navegador no pudo abrirlo | Expórtalo de nuevo con otro programa |

## Para el equipo de DuLabs

- **Un solo lugar para los límites**: `lib/cms-comercial/video-requisitos.ts` (constantes y `ESPECIFICACIONES`). Cambiar un límite es cambiar una constante: la guía del panel, el aviso del navegador, la verificación del servidor y la validación al publicar lo toman de ahí.
- **Quién manda**: el servidor (`lib/cms-comercial/videos.ts`) vuelve a analizar el archivo al confirmar la subida; al publicar se compara lo que la base conoce del archivo (tipo, medidas y peso) con el espacio donde se usa (`video_no_cumple`).
- **Qué pasa en la tienda**: cada video reemplaza al de siempre solo en su espacio, y si algo no cuadra vuelve el de siempre. La tienda lo sirve por su propia ruta `/catalogo/{tienda}/vitrina/{id}.mp4`, con `Range` (Safari lo exige).
- **Migración**: `supabase/migrations/20261212000000_dulabs_cms_multimedia.sql` (después de la `20261211`).
- **Documentación técnica**: `lib/cms-comercial/README.md`, sección «Fotos y videos del inicio».
