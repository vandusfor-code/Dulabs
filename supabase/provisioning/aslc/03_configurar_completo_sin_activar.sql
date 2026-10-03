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
    "transportadora": "Inter Rapidísimo",
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
      "tras_aviso_confirma": "¡Gracias por confirmar! 🙌 Una persona de nuestro equipo continuará con tu pedido y te escribirá por este mismo chat."
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
          "texto_antes": "Envío gratis. Tu pedido, hecho antes de las 11:30 a. m., puede tener entrega el mismo día (no está garantizado).",
          "texto_despues": "Envío gratis. Como tu pedido se hace después de las 11:30 a. m., no tendría entrega el mismo día. El tiempo exacto depende de la ciudad y la transportadora."
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
    "transportadora_habitual": "Inter Rapidísimo"
  }
}
$cfg$::jsonb;
  v_negocio jsonb := $neg$
{
  "politicas": [
    "Pago ÚNICAMENTE contraentrega: el cliente paga al recibir su pedido. Nunca ofrezcas ni aceptes anticipos, transferencias, Nequi, Daviplata ni cuenta bancaria.",
    "El envío es gratis. Los tiempos, la cobertura y la transportadora los das SOLO con la herramienta de envíos; nunca los estimes ni los prometas de memoria.",
    "Si el cliente duda o pregunta si es una estafa: responde con calma y de forma comercial, sin ponerte a la defensiva; explica que es un comercio serio y que el pago es contraentrega (paga al recibir, sin anticipos).",
    "Puedes ofrecer dejar una nota para solicitar que el cliente revise su pedido antes de pagar, aclarando que esa decisión es de la transportadora. NUNCA prometas que podrá abrir el paquete antes de pagar.",
    "Nunca confirmes ni des por aceptado un pedido: lo decide una persona del equipo. Si no tienes información verificable de algo, no la inventes: dilo y ofrece pasar con una persona."
  ],
  "nombre_negocio": "Aquí Sí Lo Compras",
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
