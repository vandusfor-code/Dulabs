# Cobros manuales — recordatorio de pago por WhatsApp y bot suspendido por falta de pago

Cron: `/api/cron/cobros-manuales` (diario, 14:00 UTC = 9:00 a. m. Colombia) · interruptor: `COBROS_MANUALES_MODO` · migración: `supabase/migrations/20261213000000_dulabs_cobros_manuales.sql`
(rollback en `supabase/rollbacks/`) · código: `lib/cobros/` · pantalla: «Cobro manual» en `/admin/clientes/<id>` · pruebas: `lib/cobros/*.test.ts` (listadas en `scripts/test-flow-manifest.txt`).

## 1. Qué hace

Los clientes que pagan **fuera de Wompi** (transferencia, efectivo) no dejaban ningún registro: el sistema no sabía quién había pagado ni hacía nada el día de pago. Ahora:

1. Cada suscripción manual guarda **a quién se le avisa** (`telefono_cobro`), **cómo se le saluda** (`nombre_cobro`) y su **día de cobro** (`dia_cobro`, p. ej. 30).
2. El **día de pago**, si no hay pago registrado, el cron:
   - marca la suscripción como suspendida (`suspendida_por_pago_at`): el bot **deja de responder** (webhook de Meta y pipeline de WhatsApp-QR). No se pausa ningún número ni se toca `ia_pausada` / `flow_activo`;
   - manda la plantilla de Meta **`pendiente_pago`** (es_CO) **desde el número de Dulabs** al teléfono de cobro, con el nombre y la mensualidad del cliente;
   - le cuenta al dueño (WhatsApp de alertas) lo que hizo.
3. Al **registrar el pago** en el Panel, la fecha de cobro avanza un mes **respetando el día** (el 30 de febrero es el 28/29), se guarda en `dulabs_pagos` como cualquier otro pago y el bot vuelve a responder.

Garantías: el aviso sale **una sola vez por ciclo** (una fila por tenant + fecha en `dulabs_cobros_ciclos`); si Meta falla se reintenta al día siguiente (tope 5) y el bot **sigue suspendido**; si el
pago se registra mientras corre el cron, no se suspende a nadie que ya pagó (la suspensión es una sola actualización condicionada al ciclo); todo lo nuevo **falla abierto** (sin migración o con la base
caída el bot sigue respondiendo).

## 2. A quién toca y a quién no

Solo a las suscripciones **manuales** (sin fuente de pago de Wompi), **activas**, que **no son cortesía**, con fecha de cobro ya llegada **y teléfono de cobro**. Sin teléfono no se avisa ni se suspende:
solo se le cuenta al dueño que falta ese dato. Los clientes con tarjeta (Wompi) siguen con su cobro automático y su dunning; los que están en pruebas o en cortesía no se tocan.

El teléfono de cobro es el WhatsApp de la **persona que paga**, nunca el número del bot del cliente (ahí lo leería su propio bot). Tampoco puede ser el número de Dulabs (Meta rechaza un mensaje de un número a sí mismo).

## 3. Cómo se enciende

1. Correr la migración en el SQL Editor de Supabase (es aditiva e idempotente).
2. Dejar a cada cliente manual listo (esto lo hace el dueño; **nunca** se versiona con datos reales). Plantilla:

```sql
update public.dulabs_suscripciones
   set cortesia = false,
       precio_cop = 39990, precio_negociado_cop = 39990,  -- el precio acordado
       fecha_proximo_cobro = '2026-10-30', dia_cobro = 30,
       telefono_cobro = '573001234567', nombre_cobro = 'Nombre del negocio',
       updated_at = now()
 where id_tenant = '<id_del_cliente>';
```

   (También se puede hacer desde el Panel, tarjeta «Cobro manual» → «Editar datos de cobro»; el **precio** no se cambia desde el Panel.)
3. Con `COBROS_MANUALES_MODO` sin definir (o `simulacion`) el cron **solo informa** qué haría (la tarjeta del Panel avisa que está en simulación). Se puede ver llamando al cron con el secreto.
4. Cuando la simulación muestre lo esperado: `COBROS_MANUALES_MODO=activo` en Vercel y volver a desplegar.

## 4. Operación diaria (Panel de Operaciones → el cliente → «Cobro manual»)

- **Registrar pago**: confirma el monto recibido y una nota. Mueve el próximo cobro y reactiva el bot. Se manda el ciclo que se ve en pantalla: un doble clic o dos operadores no pagan dos ciclos.
- **Levantar suspensión**: reactiva el bot **sin** pago (p. ej. plazo extra). El ciclo en curso deja de reintentarse; el siguiente sigue su curso normal.
- **Editar datos de cobro**: teléfono, saludo, día y fecha de cobro.

## 5. Cosas a saber

- La plantilla se lee de Meta **antes de cada envío**: debe estar `APPROVED` y tener exactamente **dos variables** (nombre y monto, en cualquier orden o con nombre). Si no, no se manda y se avisa el motivo. Si el «$» ya está
  escrito en el texto, se manda el número solo; si no, con «$».
- La suspensión solo apaga las **respuestas del bot** (incluido el saludo de WhatsApp-QR). Los envíos que el sistema hace por su cuenta (recordatorios de citas, cumpleaños, campañas) no se tocan.
- Para clientes nuevos dados de alta desde el Panel, el WhatsApp del formulario queda como teléfono de cobro; la fecha de cobro por defecto de una activación manual sigue siendo +1 año: hay que ponerla en la tarjeta.
- Pendiente (fase 2): los clientes con tarjeta cuyo cobro agota el dunning (hoy solo reciben el correo).
