# Agente de la joyería (ARIA · Delacour) — guía única

Esta es la puerta de entrada: qué es el agente, **dónde vive cada cosa**, **cómo se valida** (con y sin saldo de Gemini) y qué hacer si algo falla. El detalle de cada pieza está en los documentos que se
enlazan; los documentos por bloques (`DELACOUR_PILOTO.md` y similares) son el **historial** de cómo se llegó aquí, no la guía vigente.

> Regla del proyecto: **la IA conversa, el backend decide.** Gemini nunca calcula precios, stock, totales ni identifica un producto por su nombre: pide herramientas y el backend responde la verdad.

## 1. Qué es

Un agente de ventas por WhatsApp (`tipo = catalog_sales`) con Gemini (`gemini-3.6-flash`, llamadas con herramientas) sobre el catálogo, los pedidos y el CMS comercial de Delacour. La configuración vive en
`dulabs_agente_runtime_config` (una fila por número) y es **estricta**: una llave de más en `negocio` la invalida y el agente **calla** (fail-closed, nunca cae a otra IA).

Lo que el estado de producción tenga hoy (fila, piloto, restricciones) **no está escrito aquí a propósito**: se lee con los SQL de solo lectura del §3.

## 2. Mapa: dónde está cada cosa

| Qué | Dónde |
| --- | --- |
| Arquitectura, guardas, topes de costo, trazas, activación | `lib/agente/README.md` |
| El turno completo (bucle de herramientas, fallos, envío) | `lib/agente/runtime.ts` |
| Las 21 herramientas y sus guardas | `lib/agente/herramientas.ts` · nombres en `nombres-herramientas.ts` |
| Qué se le dice al modelo (reglas, negocio, estado) | `lib/agente/contexto.ts` |
| Que lo dicho esté respaldado (montos, referencias, enlaces, envíos, ofertas) | `anclaje.ts` · `envios-anclaje.ts` · `comercial-anclaje.ts` |
| Proveedor de IA (Gemini), errores, reintentos, simulado | `lib/ia-proveedores/` |
| Búsqueda en el catálogo (texto completo en SQL; piezas de hombre en memoria) | `lib/catalogo/resolucion.ts` · `busqueda-local.ts` · `genero-negocio.ts` |
| Información comercial publicada (ofertas, combos, políticas) | `lib/cms-comercial/README.md` |
| Aprovisionamiento y verificación en producción (SQL manual, con su reversa) | `supabase/provisioning/delacour/README.md` |
| Tienda de hombre / mujer (la separación que el agente también respeta) | `docs/DELACOUR_HOMBRE.md` |
| Historial por bloques (24–35) | `DELACOUR_PILOTO.md` · `DELACOUR_PRODUCTION_READINESS.md` · `AUDITORIA_LENGUAJE_B28.md` |

## 3. Cómo se valida

Hay tres niveles. Los dos primeros **no cuestan nada**; el tercero consume el crédito prepagado de Gemini y por eso tiene tope de gasto.

### Nivel 1 — Sin saldo, en tu computador (un solo comando)

```bash
npm run validar:agente              # todo: pruebas del agente y sus piezas + 4 evaluaciones simuladas (~10 min)
npm run validar:agente -- --rapido  # sin las pruebas con Postgres embebido (~2 min)
```

Corre las pruebas del manifiesto que tocan al agente (runtime, proveedor, catálogo, CMS, webhook, piloto) y las evaluaciones con el modelo **simulado**: el «cooperativo» (hace lo correcto: todo debe dar
`PASS`) y el «adversario» (se equivoca a propósito: **0 `FAIL`**; lo que la protección frena es `BLOCKED-SAFE`). Nada toca Gemini, Meta ni Supabase. Línea base del 2026-11-17:

| Paso | Resultado esperado |
| --- | --- |
| Pruebas (`--rapido`) | 3.254 de 3.254 |
| Evaluación comercial · cooperativo | 30 `PASS` |
| Evaluación comercial · adversario | 3 `PASS` · 27 `BLOCKED-SAFE` · 0 `FAIL` |
| Evaluación de lenguaje · cooperativo | 158 `PASS` |
| Evaluación de lenguaje · adversario | 91 `PASS` · 67 `BLOCKED-SAFE` · 0 `FAIL` |

Con todo en verde el agente está listo **hasta donde se puede saber sin el modelo real**. Además hay pruebas que vigilan el **costo** de cada mensaje (`lib/agente/agente-presupuesto.test.ts`): el tamaño de la
instrucción y de las herramientas que viajan a Gemini en cada llamada, y cuántas consultas a la base hace un turno (ver §5).

### Nivel 2 — Producción, solo lectura (las corre el dueño en el SQL Editor de Supabase)

| Script | Qué responde |
| --- | --- |
| `scripts/piloto/verificacion-produccion.sql` | Antes de encender: número de WhatsApp, números autorizados, fila del agente, productos y fotos (`OK` / `ALERTA` / `CRITICO`). |
| `supabase/provisioning/delacour/09_verificar_agente_solo_lectura.sql` | **¿Está sano el agente?** Configuración válida (modelo, credencial por nombre, herramientas, llaves de `negocio`), quién recibe qué (piloto), módulos y migraciones, calidad del catálogo (piezas de hombre y de mujer, sin precio, sin categoría, agotadas) y **los últimos 7 días**: turnos, resultados, errores por tipo, **«sin saldo»**, credencial rechazada, tokens y latencia. |

Ninguno escribe, ninguno muestra claves ni teléfonos completos. Se pueden repetir las veces que haga falta. Cada problema que el `09` detecta tiene una prueba que lo reproduce en un Postgres embebido.

### Nivel 3 — Con saldo: Gemini real, con tope de gasto

El modelo real consume el crédito prepagado. **Antes de gastar**, calcula cuánto:

```bash
npx tsx scripts/eval/gemini-comercial.ts --real 2 --estimar --precio-entrada <USD/M> --precio-salida <USD/M>
npx tsx scripts/eval/gemini-lenguaje.ts  --real 3 --estimar
```

`--estimar` no llama a nadie (ni necesita la clave). Una corrida completa de lenguaje con 3 repeticiones son ~1.250 llamadas y ~9 millones de tokens: **no la corras entera la primera vez**. Orden recomendado:

1. Una prueba corta con tope: `--real 1 --solo "^A0[1-3]$" --max-llamadas 40`. La primera llamada es un «canario»: si no hay saldo o la clave falla, se detiene sin gastar y **te dice por qué**.
2. La evaluación comercial (`gemini-comercial.ts`) con `--presupuesto-tokens`: mide lo más delicado (que nada inventado llegue al cliente).
3. La de lenguaje por grupos (`--solo "^(E|C|Q)"`), también con tope.

La clave solo se lee de `GEMINI_EVAL_KEY` (entorno o `.env.local`), nunca se imprime y nunca es la de producción. Si se pasa el tope, la corrida se detiene **antes del siguiente caso**, lo dice en el informe y sale con código 4.

## 4. Si Gemini no tiene saldo (o la clave falla)

El agente **no se rompe ni deja al cliente esperando**:

| Qué pasa en Gemini | Qué hace el agente |
| --- | --- |
| Crédito prepagado agotado, tope de gasto o cupo diario (`quota`), credencial rechazada (`auth`) | **No reintenta** (reintentar no devuelve el saldo) y pasa la conversación **de una vez a una asesora** con el mensaje fijo de traspaso. El cliente no pierde su mensaje ni se queda esperando un «escríbeme de nuevo». |
| Un pico de peticiones por minuto, un tiempo agotado, una caída del servicio | Reintenta una vez; si sigue, mensaje fijo para que reintente y, al segundo fallo seguido, asesora. |
| La nota de voz o la lectura de la referencia en una foto (también usan Gemini) | Si Gemini no responde, la política de siempre: se le pide al cliente que lo escriba. Su siguiente mensaje de texto ya sigue las filas de arriba. |

Cómo verlo: en las trazas el turno queda con `error_kind = quota` (o `side_quota` si fue la pregunta de un cliente durante el pedido) y el `09` lo muestra en su fila **`sin_saldo_7d`**. Qué hacer: recargar el
crédito en Google AI Studio (o esperar al reinicio del cupo diario) y, en el Inbox, **devolver a la IA** las conversaciones que quedaron con una asesora durante el corte. Todo lo anterior se prueba con el proveedor
simulado (`lib/agente/agente-runtime.test.ts` · «21 bis», `lib/ia-proveedores/ia-proveedores.test.ts` · «sin saldo»).

## 5. Qué cuesta cada mensaje (medido el 2026-11-17)

| Pieza | Tamaño | Dónde se vigila |
| --- | --- | --- |
| Instrucción de sistema (reglas de la plataforma + estado vacío) | ~4.800 caracteres | `agente-presupuesto.test.ts` (tope 5.300) |
| Las 21 herramientas declaradas | 13.108 bytes (las 16 de venta: 7.898) | tope 14.400 / 8.700 |
| El parámetro `genero` (solo en la tienda que separa hombre y mujer) | +362 bytes | tope 450 |
| Un turno de búsqueda | 2 llamadas a Gemini; 5 consultas a la base (6 en la tienda que separa hombre y mujer) | no crece con la cantidad de resultados (sin N+1) |

Un turno típico son ~2,2 llamadas de ~7.000 tokens de entrada cada una. Todo lo que va **antes** del estado de la conversación es el mismo texto de un turno al otro (el proveedor puede reutilizarlo); una prueba
lo vigila para que nadie meta ahí nada que cambie en cada mensaje.

## 6. Hombre y mujer en el agente

La tienda de Delacour separa **Hombre** y **Mujer** (columna `genero`); el agente la respeta **solo en negocios cuya tienda lo hace** (los demás ven exactamente las mismas herramientas de siempre, byte a byte):

- `search_products` y `get_catalog_link` aceptan `genero` (`hombre` / `mujer`) si el cliente dijo para quién es. **Hombre** = solo las piezas de hombre (se buscan en memoria con las mismas reglas que la búsqueda SQL;
  son pocas y conocidas); **mujer** = todo menos ellas. «Qué tienen para él» trae todo lo de hombre, paginado.
- «Muéstrame más» sigue en el mismo lado; lo **parecido** a una pieza es siempre del mismo lado (un anillo de mujer nunca sugiere uno de hombre).
- Cada pieza trae `para`, y el enlace `?genero=hombre` lo arma el backend (solo al detal).
- Esto **no necesita ninguna migración nueva**: sin la 20261215 (columna `genero`), sin piezas de hombre o con más de 600, el agente es el de siempre. Código en `lib/agente/herramientas.ts`; pruebas en `lib/agente/agente-genero.test.ts`.

## 7. Pendiente que solo se puede cerrar con saldo

- **Validar `genero` con el modelo real**: que Gemini lo envíe cuando el cliente dice «para mi novio / para ella» y lo omita cuando no lo dice. Las pruebas actuales (simuladas) comprueban todo el cableado, no la decisión del modelo.
- La evaluación comercial y la de lenguaje **reales** con tope de gasto (§3, nivel 3) y comparar con la línea base simulada.
- Candidato de optimización (de poco valor, **no aplicado** porque cambia el orden del texto que lee el modelo y hay que validarlo con el modelo real): con el checkout conversacional, las reglas de pedidos (texto fijo, ~1,3 KB)
  van **después** del estado y por eso el proveedor no las reutiliza; moverlas antes del estado las haría reutilizables.
- Un aviso automático al dueño cuando haya turnos `quota` (hoy se ve en el `09`, no se avisa solo).
