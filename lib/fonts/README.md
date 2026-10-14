# Fuentes propias

Los `.woff2` de esta carpeta son las tipografías del sitio. Next los carga con `next/font/local` desde los módulos `lib/fonts-*.ts` y los publica con el resto de los estáticos, en el propio dominio (`/_next/static/…/media/`). El navegador nunca pide nada a Google (la CSP ya tiene `font-src 'self'`).

## Por qué no `next/font/google`

`next/font/google` baja de `fonts.googleapis.com` y `fonts.gstatic.com`, en **cada compilación en frío**, el CSS y **todos** los archivos de cada familia (todos los alfabetos: antes de este cambio eran 6 familias y 31 archivos). Si una de esas descargas falla, la compilación se cae («next/font/google queries have exactly one entry» o «Failed to fetch … from Google Fonts») y no se puede publicar. El 2026-10-14, al reconstruir sin caché de compilación en Vercel para arreglar un despliegue, 2 de 3 intentos fallaron por eso; el mismo día una compilación en frío local de `main`, sin tocar nada, falló 1 de 2 veces con el mismo error. Con los archivos en el repo, la compilación no necesita red para las fuentes. `lib/fuentes-propias.test.ts` cuida que no vuelva a entrar `next/font/google`.

## Qué hay

Son copias sin modificar de lo que producción ya servía el 2026-10-14 (los archivos que Next había bajado de Google Fonts; una compilación nueva de `main` volvió a bajar de Google los mismos bytes, SHA-256 idéntico), solo el subconjunto **latin**. Peso total: 175 kB.

| Archivo | Familia · versión | Pesos | Lo declara | SHA-256 |
| --- | --- | --- | --- | --- |
| `geist-latin.woff2` | Geist 1.800 (variable) | 100–900 | `fonts-sitio.ts` (todo el sitio) | `9b6f5ff45b278c744b5f379a2c4ecbaf858a842b8eaf82ac8d21b699ca16c608` |
| `geist-mono-latin.woff2` | Geist Mono 1.701 (variable) | 100–900 | `fonts-sitio.ts` (cifras y código) | `5f3d6ad60f29d6cb708414ec6887163d63bf197377ef5417d2483ff31ace6c3b` |
| `cormorant-garamond-latin.woff2` | Cormorant Garamond 4.001 (variable) | 300–700 (se usan 500–600 en las tiendas, 500–700 en el portal de Daniela) | `fonts-catalogo.ts`, `fonts-portal-daniela.ts` | `5d618c462b7a5b74f442e1548880086af71764d9cc7d35c16ab45353da934621` |
| `parisienne-400-latin.woff2` | Parisienne 1.000 | 400 | `fonts-portal-daniela.ts` | `ff7c6d91efb6866f41cc131d8e84e47876e73a9f2cc3ba9ac48ab950daaabb74` |
| `playfair-display-latin.woff2` | Playfair Display 1.203 (variable) | 400–900 (se usan 500–700) | `fonts-portal-amore.ts` (`/reservar/amore`, `/mi-cita`) | `5d91eb5d522a03081946c44c8ca17c902230dfed5f0f9b5014262135d47b15b2` |
| `poppins-400-latin.woff2` | Poppins 4.004 | 400 | `fonts-tienda-amore.ts` (`/amore/tienda`) | `3dc5d0c52428fe1696264907a1054ebbaac07f8cbe45832c105f819c2ae397c0` |
| `poppins-500-latin.woff2` | Poppins Medium 4.004 | 500 | `fonts-tienda-amore.ts` | `289e0afc8be731a86822349e54557296f145926496bd2138db1bac0db77f77a2` |
| `poppins-600-latin.woff2` | Poppins SemiBold 4.004 | 600 | `fonts-tienda-amore.ts` | `872e862918591a9e824dc03ed92f05729435ffbb8ebbb10eff7eda26592b1798` |

Las versiones salen de los metadatos de cada archivo. La licencia de todas es la SIL Open Font License 1.1 (ver `LICENSE.md`).

## Solo el subconjunto «latin»

Antes Next bajaba también cirílico, cirílico extendido, vietnamita, latin-ext y (en Poppins) devanagari, y el navegador los pedía solo si el texto los usaba. Al cambiar se comprobó que ni el texto visible de 116 páginas públicas ni los textos del código usan caracteres de esos alfabetos. «latin» cubre el español y el inglés completos (tildes, ñ, ¿ ¡, comillas y rayas tipográficas, €, ™). Un carácter que no esté en «latin» se dibuja con la fuente del sistema, igual que ya pasa con los emojis, las flechas y los ✓.

Si algún día hace falta otro alfabeto (por ejemplo nombres con cirílico), no basta con sumar otro archivo al mismo `localFont`: el cargador de Next no da un `unicode-range` distinto a cada archivo (copia `declarations` tal cual en todos los `@font-face` de la llamada). Habría que declarar otra fuente local para ese alfabeto con `declarations: [{ prop: "unicode-range", value: "…" }]` y sumarla a la pila `font-family` del CSS (no probado).

## Fuente de respaldo

Para que el texto no se mueva cuando carga la fuente, Next genera una «fuente de respaldo» (Arial o Times New Roman con `size-adjust` y overrides de ascenso y descenso). Con `next/font/google` esas cifras salían de una tabla de Next; con `next/font/local` las calcula Next desde el propio archivo, y quedaron entre 0,1 y 5 puntos distintas (por ejemplo, Geist: `size-adjust` 104,76 % → 106,28 %). Se midió: CLS idéntico antes y después en el inicio, las tiendas, `/amore/tienda` y `/reservar/amore`. Lo único que cambió en las comparaciones de pantalla son los caracteres que no están en la fuente web (las flechas → de los botones del sitio de marketing, por ejemplo), que se dibujan con esa fuente de respaldo: una flecha de 13 px pasó de medir 13,63 px a 13,83 px (+0,2 px), y eso corre unos 0,1–0,2 px la cabecera y los botones vecinos. El texto en la fuente web mide exactamente lo mismo que antes.

## Cómo agregar o cambiar una fuente

1. Descarga el subconjunto «latin» en woff2 (por ejemplo del CSS de Google Fonts pedido con un navegador moderno: el bloque `/* latin */` trae la URL del archivo). Mejor una fuente variable: un solo archivo cubre todos los pesos.
2. Guárdalo aquí como `familia[-peso]-latin.woff2`.
3. Decláralo en un módulo `lib/fonts-*.ts` con `next/font/local` (los `src` son relativos al módulo). Para una familia con serifas pon `adjustFontFallback: "Times New Roman"` (el valor por defecto es `"Arial"`).
4. Anótalo en la tabla de arriba (`sha256sum archivo.woff2`) y su copyright en `LICENSE.md`.
5. `npm run test:flow` (o solo `lib/fuentes-propias.test.ts`) comprueba que el archivo exista, sea un woff2 de verdad y pese menos de 100 KB.
