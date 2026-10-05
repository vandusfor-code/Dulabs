-- FASE 3B.9D — AJUSTAR EL COMPORTAMIENTO DE AQUÍ SÍ LO COMPRAS (CON EL AGENTE YA HABILITADO)
-- GENERADO por lib/agente/activacion-aslc.ts: no se edita a mano (salvo las líneas marcadas con "← EDITAR"); una prueba verifica que este archivo es EXACTAMENTE su salida.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico): si cualquier guarda falla, no queda nada.
--
-- Aplica lo que pidió el negocio sin pausar ni reconfigurar nada más:
--   · negocio: estilo de atención (tono y personalidad), políticas y la información oficial (ubicación de la bodega, respuesta a quien desconfía, horario).
--   · checkout_opciones: el texto que recibe el cliente cuando contesta "sí" al aviso (nombra a la responsable), la escritura de la transportadora y los textos de los tiempos de envío
--     (Bogotá antes y después de las 11:30 y el resto de ciudades: el modelo los repite tal cual y el candado de envíos los acepta).
-- NO toca: ia_pausada, ia_restringida_a, habilitado, el aviso obligatorio, la persona responsable, los módulos ni otros negocios.
-- Se puede repetir sin efectos nuevos. Después: scripts/verificar-aslc-solo-lectura.mts --etapa=controlado (o publico) confirma que la fila sigue válida.

do $$
declare
  v_tenant uuid;
  v_phone text;
  v_filas integer;
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
  v_tras text := $tras$¡Gracias por confirmar! 🙌 Se comunicará contigo la asesora Patricia Castro, quien se encargará del proceso de envío y despacho de tu producto.$tras$;
  v_tiempos jsonb := $tiempos$
[
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
]
$tiempos$::jsonb;
begin
  -- Identidad: UNA sola fila con ese tenant, ese phone_number_id y ese nombre.
  select count(*) into v_filas from public.dulabs_clientes_config where id_tenant::text = '320121d7-2bc5-472d-944b-5191cc228e1f' and phone_number_id::text = '1317599831437793' and nombre_negocio ~* 'lo compras';
  if v_filas <> 1 then
    raise exception 'ASLC: se esperaba exactamente UNA fila de dulabs_clientes_config (tenant, phone_number_id y nombre), hay %', v_filas;
  end if;
  select id_tenant, phone_number_id into v_tenant, v_phone from public.dulabs_clientes_config where id_tenant::text = '320121d7-2bc5-472d-944b-5191cc228e1f' and phone_number_id::text = '1317599831437793' and nombre_negocio ~* 'lo compras';

  -- La fila del agente: UNA, con la credencial propia y la configuración completa cargada (sin candado, con el cierre por aceptación humana).
  select count(*) into v_filas from public.dulabs_agente_runtime_config
   where phone_number_id = v_phone and id_tenant = v_tenant and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC' and checkout_opciones -> 'activacion_pendiente' is null and coalesce(checkout_opciones #>> '{cierre,modo}', '') = 'aceptacion_humana';
  if v_filas <> 1 then
    raise exception 'se esperaba la fila del agente de ASLC con la configuración completa cargada (sin candado y con el cierre por aceptación humana): corre antes 03_configurar_completo_sin_activar.sql; hay %', v_filas;
  end if;

  -- El aviso obligatorio sigue EXACTO (este script no lo toca; se comprueba por si alguien lo cambió).
  if not exists (select 1 from public.dulabs_agente_runtime_config where phone_number_id = v_phone and id_tenant = v_tenant and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC' and encode(sha256(convert_to(checkout_opciones #>> '{cierre,textos,aviso}', 'UTF8')), 'hex') = 'c0bf58e071859d51d86f2de4f703faa8f95ea866e644386d40eb9d6d1a75179a') then
    raise exception 'el aviso obligatorio guardado NO es el aprobado: no se ajusta nada';
  end if;

  update public.dulabs_agente_runtime_config
     set negocio = v_negocio,
         checkout_opciones = jsonb_set(jsonb_set(jsonb_set(jsonb_set(checkout_opciones,
           '{cierre,textos,tras_aviso_confirma}', to_jsonb(v_tras)),
           '{oficina,transportadora}', to_jsonb('Interrapidísimo'::text)),
           '{envios,transportadora_habitual}', to_jsonb('Interrapidísimo'::text)),
           '{envios,tiempos}', v_tiempos),
         updated_at = now()
   where phone_number_id = v_phone and id_tenant = v_tenant and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'no se pudo actualizar exactamente UNA fila del agente (%): abortando', v_filas;
  end if;

  -- Comprobación final dentro de la misma sentencia.
  if not exists (
    select 1 from public.dulabs_agente_runtime_config
     where phone_number_id = v_phone and id_tenant = v_tenant and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC'
       and negocio = v_negocio
       and checkout_opciones #>> '{cierre,textos,tras_aviso_confirma}' = v_tras
       and checkout_opciones #>> '{oficina,transportadora}' = 'Interrapidísimo'
       and checkout_opciones #>> '{envios,transportadora_habitual}' = 'Interrapidísimo'
       and checkout_opciones #> '{envios,tiempos}' = v_tiempos
       and checkout_opciones -> 'activacion_pendiente' is null
  ) then
    raise exception 'la fila del agente de ASLC no quedó como se esperaba: abortando';
  end if;
end $$;
