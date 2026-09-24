# Piloto de Delacour — herramientas (Bloque 24)

Tres piezas, todas **sin tocar producción** salvo las dos de solo lectura, que se corren a mano
cuando se decida encender el piloto.

| Archivo | Qué hace | Dónde corre |
| --- | --- | --- |
| `matriz-piloto.e2e.ts` | Matriz A–H + barreras + fallas + diagnóstico, de punta a punta con el webhook REAL | PostgreSQL + PostgREST **locales** (se niega a otra URL) |
| `verificacion-produccion.sql` | Una fila por control del piloto (OK / ALERTA / CRITICO) | SQL Editor de Supabase, **solo lectura** (termina en ROLLBACK) |
| `auditar-fotos.mjs` | Pide cada `whatsapp.jpg` como lo hace Meta y valida formato, peso, medidas, URL canónica y aislamiento | Contra `https://dulabs.co`, **solo lectura** |

## Matriz de punta a punta (local)

Lo que corre es el código de producción:

- `registrarMensajesEntrantesSincrono` y `procesarCambio` (webhook);
- las guardas del piloto;
- el cliente HTTP real de Gemini (`generateContent` con function calling);
- las herramientas y el motor de pedidos;
- PostgreSQL con las migraciones reales: triggers de reserva, buzón, trazas, topes y
  `dulabs_agente_diagnosticar`.

Solo se simulan las **respuestas** de Gemini (un guion por mensaje, con el formato real de la API)
y la Graph API de Meta. Cualquier otro host de red hace fallar la prueba.

Preparación (una vez), con PostgreSQL 16 local:

1. Una base con las tablas base del producto (`dulabs_clientes_config`, `dulabs_mensajes_log` con
   las columnas de `20260715090000`, `dulabs_pausas_chat`, `dulabs_chat_lock`,
   `dulabs_suscripciones`, `dulabs_conversacion_estado`, `dulabs_clientes_conocidos`).
2. Aplicar en orden `supabase/migrations/20261105000000_*` … `20261118000000_*`. Son idempotentes;
   en el Bloque 24 se aplicaron las 14 sin error.
3. PostgREST contra esa base (rol anónimo = `service_role`) y el proxy
   `scripts/perf/proxy-supabase.mjs`:
   ```
   PERF_REST=http://127.0.0.1:54443 PERF_PROXY_PORT=54453 node scripts/perf/proxy-supabase.mjs
   ```
4. Correr la matriz:
   ```
   PILOTO_SUPABASE_URL=http://127.0.0.1:54453 npx tsx --test --test-concurrency=1 scripts/piloto/matriz-piloto.e2e.ts
   ```

Cada corrida crea sus propios negocios, números y productos **ficticios**, así que se puede repetir.
Con `PILOTO_RESUMEN=archivo.json` guarda los tamaños reales de cada petición a Gemini.

## Verificación de producción (solo lectura)

Pegar `verificacion-produccion.sql` completo en el SQL Editor. Cualquier fila **CRITICO** bloquea
el encendido. La consulta 2 del final (comentada) da la lista de referencias con foto para
`auditar-fotos.mjs`.

## Auditoría de fotos (solo lectura)

```
node scripts/piloto/auditar-fotos.mjs --base https://dulabs.co --slug <slug-de-delacour> --refs-file refs.txt
```

La salida es una línea por referencia y un resumen JSON con los motivos de las que no sirven. El
código de salida es 1 si alguna falla.
