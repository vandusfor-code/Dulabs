-- FASE 3B.9D — CONFIGURACIÓN COMPLETA DE AQUÍ SÍ LO COMPRAS, SIN ACTIVAR
-- GENERADO por lib/agente/activacion-aslc.ts: no se edita a mano (salvo las líneas marcadas con "← EDITAR"); una prueba verifica que este archivo es EXACTAMENTE su salida.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico): si cualquier guarda falla, no queda nada.
--
-- ANTES DE CORRER: editar las DOS líneas marcadas con "← EDITAR" (v_responsable y v_respaldo). Lo demás no se toca.
--   v_responsable = id (número) de la persona que acepta los pedidos: un miembro ACTIVO del equipo de ASLC con rol admin o agente.
--                   Para ver los ids: 08_ver_equipo_solo_lectura.sql. Una persona recién invitada sigue "invitado" hasta su primer login.
--   v_respaldo    = id de una segunda persona que también puede aceptar (otra distinta), o null si no hay.
--
-- QUÉ HACE:
--   1. Identifica a ASLC (tenant + phone_number_id + nombre): exactamente UNA fila. Exige ia_pausada = true (sigue apagado).
--   2. Valida a v_responsable (y v_respaldo) contra el equipo real: de ASLC, ACTIVOS y con rol admin o agente.
--   3. Exige que la fila del agente exista y siga DESHABILITADA con la credencial propia (la que dejó 02_aprovisionar_sin_activar.sql).
--   4. Exige que el aviso obligatorio de este script sea byte a byte el aprobado (SHA-256), por si el portapapeles lo alteró.
--   5. Reemplaza checkout_opciones por la configuración completa (sin el candado activacion_pendiente) y negocio por sus políticas, y enciende
--      checkout_conversacional (requisito del cierre con aceptación humana).
-- QUÉ NO HACE: no habilita el agente, no toca ia_pausada ni ia_restringida_a, no crea personas, no toca módulos ni otros negocios, no envía nada.
-- Se puede volver a correr mientras la fila siga deshabilitada (p. ej. para cambiar de responsable).
--
-- REVERSA (solo de este script; deja la fila como la dejó el 02). Descomentar y correr:
--   update public.dulabs_agente_runtime_config
--      set checkout_opciones = '{"entregas":["domicilio"],"pagos":[{"metodo":"contra_entrega"}],"activacion_pendiente":true}'::jsonb,
--          negocio = '{"nombre_negocio":"Aquí Sí Lo Compras"}'::jsonb, checkout_conversacional = false, updated_at = now()
--    where phone_number_id = '1317599831437793' and id_tenant = '320121d7-2bc5-472d-944b-5191cc228e1f'::uuid and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC' and habilitado = false;

do $$
declare
  v_responsable bigint := null;  -- ← EDITAR: id de la persona responsable (obligatorio)
  v_respaldo bigint := null;     -- ← EDITAR (opcional): id de la persona de respaldo, o dejar null
  v_tenant uuid;
  v_phone text;
  v_filas integer;
  -- Configuración completa. OJO: miembro_id y respaldo_miembro_id de abajo son MARCADORES; el script los reemplaza con v_responsable y v_respaldo.
  v_config jsonb := $cfg$
{
  "entregas": [
    "domicilio",
    "oficina_transportadora"
  ],
  "pagos": [
    {
      "metodo": "contra_entrega"
    }
  ],
  "campos": {
    "nombre_completo": true,
    "telefono": {
      "modo": "requerido",
      "acepta_mismo_whatsapp": true
    },
    "departamento": true,
    "barrio": true
  },
  "oficina": {
    "transportadora": "Interrapidísimo",
    "oferta": "solo_si_cliente_pide",
    "pide_direccion": false,
    "pide_barrio": false,
    "seleccion": {
      "tipo": "texto_libre"
    },
    "documento": {
      "modo": "requerido",
      "tipos": "sin_especificar",
      "retencion": {
        "tipo": "dias",
        "dias": 30
      },
      "si_se_niega": "handoff"
    }
  },
  "cierre": {
    "modo": "aceptacion_humana",
    "validacion_resumen": "boton_datos_correctos",
    "mostrar_numero_pedido": true,
    "textos": {
      "aviso": "⚠️ IMPORTANTE ANTES DE ENVIAR SU PEDIDO:\n\nPor seguridad, actualmente no estamos dejando pedidos en las transportadoras sin reclamar o recibir, ya que hemos tenido pérdidas de mercancía bajo esta modalidad y, adicionalmente, se generan dobles costos de flete.\n\nPor este motivo, al confirmar su pedido, usted acepta recibirlo y reclamarlo cuando la transportadora lo entregue, RECOMENDAMOS TENER LA DISPONIBILIDAD DEL DINERO.\n\n📦 El producto se envía tal como se muestra en las fotos y videos, con las mismas características, especificaciones y accesorios ofrecidos en la publicación.\n\nPor favor, confirme su compra únicamente si está 100% seguro de recibir el pedido. 🙏\n\n¿Me confirmas por favor que estás 100% seguro de recibirlo?",
      "tras_aviso_confirma": "¡Gracias por confirmar! 🙌 Se comunicará contigo la asesora Patricia Castro, quien se encargará del proceso de envío y despacho de tu producto.",
      "aceptado": "¡Buenas noticias! 🎉 Tu pedido {pedido} fue aceptado. Recuerda que el pago es contraentrega: ten el dinero disponible cuando lo recibas. Si tienes alguna duda, escríbenos por este mismo chat.",
      "rechazado": "Hola 👋 Lamentamos informarte que tu pedido {pedido} no pudo ser aceptado. Si tienes alguna duda, escríbenos por este mismo chat y te ayudamos.",
      "cancelado": "Hola 👋 Tu pedido {pedido} fue cancelado. Si tienes alguna duda, escríbenos por este mismo chat y te ayudamos.",
      "en_preparacion": "Hola 👋 Tu pedido {pedido} ya está en preparación. Si tienes alguna duda, escríbenos por este mismo chat.",
      "enviado": "¡Buenas noticias! 📦 Tu pedido {pedido} ya fue enviado. Recuerda que el pago es contraentrega: ten el dinero disponible cuando lo recibas. Si tienes alguna duda, escríbenos por este mismo chat.",
      "entregado": "Hola 👋 Tu pedido {pedido} figura como entregado. ¡Gracias por tu compra! Si tienes alguna duda, escríbenos por este mismo chat."
    },
    "responsable": {
      "miembro_id": 1,
      "respaldo_miembro_id": null,
      "canales": [
        "panel"
      ]
    },
    "aceptan": "responsable_y_admins",
    "reserva": {
      "tipo": "ttl",
      "minutos": 720
    },
    "vencimiento": {
      "tipo": "tras",
      "minutos": 1440
    },
    "reserva_tras_aceptar": {
      "tipo": "plataforma"
    },
    "respuesta_tras_aviso": {
      "si_ya_respondio_persona": "no_responder"
    },
    "pregunta_sin_respuesta": "handoff_inmediato"
  },
  "envios": {
    "cobertura": {
      "tipo": "todo_el_pais_salvo",
      "excluidas": []
    },
    "tiempos": [
      {
        "ciudades": [
          "bogota"
        ],
        "texto": "Envío gratis a Bogotá.",
        "corte": {
          "hora_limite": "11:30",
          "zona_horaria": "America/Bogota",
          "dias": [
            "lun",
            "mar",
            "mie",
            "jue",
            "vie"
          ],
          "festivos": {
            "tipo": "ignorar"
          },
          "texto_antes": "Envío gratis. Tu pedido, hecho antes de las 11:30 a. m., puede tener entrega el mismo día.",
          "texto_despues": "Envío gratis. Como tu pedido se hace después de las 11:30 a. m., el tiempo exacto de entrega depende de la ciudad y la transportadora."
        }
      },
      {
        "ciudades": "resto_con_cobertura",
        "texto": "Envío gratis. Normalmente de 2 a 3 días hábiles, según la ciudad y la transportadora.",
        "dias_habiles": {
          "min": 2,
          "max": 3
        }
      }
    ],
    "sin_certeza": "handoff",
    "ciudad_desconocida_en_checkout": "handoff",
    "texto_resumen": "Envío gratis",
    "envio_gratis": true,
    "transportadora_habitual": "Interrapidísimo"
  }
}
$cfg$::jsonb;
  v_negocio jsonb := $neg$
{
  "tono": "Cercano, cordial y profesional. Siempre tuteas (tú, te, puedes, me confirmas), nunca de usted salvo que el cliente lo pida. Comercial y persuasivo, sin presionar. Pocos emojis; respuestas breves.",
  "politicas": [
    "Pago ÚNICAMENTE contraentrega: el cliente paga al recibir su pedido. Nunca ofrezcas ni aceptes anticipos, transferencias, Nequi, Daviplata ni cuenta bancaria.",
    "Del envío (si es gratis, cobertura, tiempos, transportadora) NO digas nada hasta consultar_envio con la ciudad del cliente; entonces repite solo lo que devuelva. Si pregunta por el envío sin dar ciudad, pídesela. No lo menciones al dar precios ni descripciones.",
    "Si el cliente desconfía o pregunta si es una estafa, usa la respuesta oficial de la información del negocio, con calma y sin discutir. Puedes ofrecer una nota de dejar revisar el pedido, pero NUNCA prometas que la transportadora permitirá abrir el paquete antes de pagar.",
    "Nunca confirmes ni des por aceptado un pedido: lo decide una persona del equipo.",
    "Si un producto está agotado o no disponible, díselo con claridad y, si hay productos parecidos disponibles, ofrécelos como alternativa. No prometas fecha de llegada ni de reposición.",
    "Si no tienes confirmada la respuesta (tiempos sin confirmar, garantías o casos especiales sin información, disponibilidad específica, o cualquier dato que no esté en el producto o en la información del negocio), NO la inventes: pasa con un asesor (handoff_to_human, motivo out_of_scope).",
    "Pasa con un asesor (handoff_to_human) si el cliente pide hablar con una persona, presenta una queja o inconformidad, tiene un problema con un pedido o con la entrega, reclama una garantía, devolución o cambio, o tiene una solicitud especial.",
    "Si preguntan dónde estamos ubicados, responde con la información oficial de ubicación (es la bodega de despacho), sin inventar otras direcciones, y pregúntale en qué ciudad está para confirmarle el envío.",
    "Si el cliente describe una necesidad (\"algo para cocinar\", \"un regalo para mi hijo\"), busca con varios términos del producto que la resuelve (freidora, tablet, reloj, celular) antes de decir que no hay; si aun así no hay, ofrece el catálogo completo."
  ],
  "nombre_negocio": "Aquí Sí Lo Compras",
  "personalidad": "Eres el asistente de ventas de Aquí Sí Lo Compras. Tu objetivo es ayudar al cliente, resolver sus dudas y objeciones con naturalidad, generar confianza y llevar la conversación hacia el cierre de la venta, sin inventar nada y sin presionar. Tutea siempre de forma cordial y natural (tú, te, puedes, quieres, me confirmas); no uses el usted salvo que el cliente lo pida. Usa emojis con moderación y respuestas claras, naturales y no muy largas. Cuando el cliente muestre interés, propón el siguiente paso (por ejemplo, agregar el producto a su pedido) y termina con una pregunta amable que invite a avanzar. Insiste de forma estratégica y moderada: no repitas lo mismo ni resultes agresivo o incómodo. Ante una objeción de precio, destaca lo que incluye y su garantía; si ofreces otra opción, que sea más económica. Apóyate en lo que está confirmado: el pago es contraentrega y los accesorios y la garantía que figuren en la información del producto. Del envío (si es gratis, cobertura, tiempos, transportadora) solo hablas después de preguntar la ciudad del cliente y consultarla con la herramienta de envíos: antes no lo menciones y, cuando muestre interés, pídele su ciudad con naturalidad. Si el cliente duda de la compra o pregunta si es una estafa, responde con calma, cordialidad y seguridad, sin discutir ni molestarte, usando la información oficial del negocio. Si el cliente dice claramente que no le interesa o que no quiere más mensajes, respétalo y despídete con amabilidad.",
  "conocimiento": [
    {
      "tema": "Ubicación de la bodega",
      "info": "Nuestra bodega está ubicada vía Siberia, Cundinamarca. Desde allí despachamos nuestros pedidos, con pago contraentrega. 📦🚚"
    },
    {
      "tema": "Si el cliente desconfía o pregunta si es una estafa",
      "info": "Claro que sí 😊 Somos una empresa de comercio honesta y seria. Nuestra misión es enviar a nuestros clientes los productos con las mismas especificaciones y accesorios que solicitaron. Somos una empresa de comercio, no de estafas. Además, manejamos pago contraentrega y, si quieres, podemos poner una nota de dejar revisar el pedido para que puedas verificarlo antes de realizar el pago. 📦🔍"
    },
    {
      "tema": "Horario del asistente",
      "info": "Este asistente atiende las 24 horas del día, los 7 días de la semana."
    }
  ],
  "pedido": {
    "nota_envio_domicilio": "Envío GRATIS"
  }
}
$neg$::jsonb;
begin
  -- Identidad: UNA sola fila con ese tenant, ese phone_number_id y ese nombre.
  select count(*) into v_filas from public.dulabs_clientes_config where id_tenant::text = '320121d7-2bc5-472d-944b-5191cc228e1f' and phone_number_id::text = '1317599831437793' and nombre_negocio ~* 'lo compras';
  if v_filas <> 1 then
    raise exception 'ASLC: se esperaba exactamente UNA fila de dulabs_clientes_config (tenant, phone_number_id y nombre), hay %', v_filas;
  end if;
  select id_tenant, phone_number_id into v_tenant, v_phone from public.dulabs_clientes_config where id_tenant::text = '320121d7-2bc5-472d-944b-5191cc228e1f' and phone_number_id::text = '1317599831437793' and nombre_negocio ~* 'lo compras';

  -- Estado seguro: la IA sigue pausada (esto NO la activa).
  if not exists (select 1 from public.dulabs_clientes_config where phone_number_id = v_phone and ia_pausada is true) then
    raise exception 'ASLC no está pausado (ia_pausada <> true): abortando sin cambios';
  end if;

  -- Persona responsable: obligatoria, del equipo de ASLC, ACTIVA y con rol admin o agente (un rol "lectura" no puede aceptar pedidos).
  if v_responsable is null then
    raise exception 'PATRICIA_REAL_PENDIENTE: edita v_responsable con el id de la persona responsable (ver 08_ver_equipo_solo_lectura.sql)';
  end if;
  if not exists (select 1 from public.dulabs_miembros_equipo where id = v_responsable and tenant_id = v_tenant and estado = 'activo' and rol in ('admin', 'agente')) then
    raise exception 'v_responsable (%) no es un miembro ACTIVO del equipo de ASLC con rol admin o agente (un invitado que aún no entró, un suspendido o un rol lectura no sirven)', v_responsable;
  end if;
  if v_respaldo is not null then
    if v_respaldo = v_responsable then
      raise exception 'el respaldo no puede ser la misma persona que la responsable';
    end if;
    if not exists (select 1 from public.dulabs_miembros_equipo where id = v_respaldo and tenant_id = v_tenant and estado = 'activo' and rol in ('admin', 'agente')) then
      raise exception 'v_respaldo (%) no es un miembro ACTIVO del equipo de ASLC con rol admin o agente', v_respaldo;
    end if;
  end if;

  -- La fila del agente que dejó el 02: UNA, deshabilitada, con la credencial propia.
  select count(*) into v_filas from public.dulabs_agente_runtime_config where phone_number_id = v_phone and id_tenant = v_tenant and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC' and habilitado = false;
  if v_filas <> 1 then
    raise exception 'se esperaba la fila del agente de ASLC DESHABILITADA con la credencial propia (la deja 02_aprovisionar_sin_activar.sql); hay %', v_filas;
  end if;

  -- El aviso obligatorio es EXACTAMENTE el aprobado (un portapapeles o editor que cambie una letra, un emoji o un salto de línea lo detiene).
  if encode(sha256(convert_to(v_config #>> '{cierre,textos,aviso}', 'UTF8')), 'hex') <> 'c0bf58e071859d51d86f2de4f703faa8f95ea866e644386d40eb9d6d1a75179a' then
    raise exception 'el aviso obligatorio pegado NO es byte a byte el aprobado (¿se alteró al copiar y pegar?): abortando sin cambios';
  end if;

  -- Persona responsable real en la configuración.
  v_config := jsonb_set(v_config, '{cierre,responsable,miembro_id}', to_jsonb(v_responsable));
  v_config := jsonb_set(v_config, '{cierre,responsable,respaldo_miembro_id}', coalesce(to_jsonb(v_respaldo), 'null'::jsonb));

  update public.dulabs_agente_runtime_config
     set checkout_opciones = v_config, negocio = v_negocio, checkout_conversacional = true, updated_at = now()
   where phone_number_id = v_phone and id_tenant = v_tenant and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC' and habilitado = false;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'no se pudo actualizar exactamente UNA fila del agente (%): abortando', v_filas;
  end if;

  -- Comprobación final dentro de la misma transacción.
  if exists (
    select 1 from public.dulabs_agente_runtime_config
     where phone_number_id = v_phone
       and (habilitado is distinct from false or checkout_conversacional is distinct from true or checkout_opciones -> 'activacion_pendiente' is not null
            or (checkout_opciones #>> '{cierre,responsable,miembro_id}')::bigint is distinct from v_responsable)
  ) then
    raise exception 'la fila del agente de ASLC no quedó como se esperaba: abortando';
  end if;
  if not exists (select 1 from public.dulabs_clientes_config where phone_number_id = v_phone and ia_pausada is true) then
    raise exception 'ASLC dejó de estar pausado: abortando';
  end if;
end $$;
