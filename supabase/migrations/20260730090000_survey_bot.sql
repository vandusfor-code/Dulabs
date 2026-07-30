-- Bot de encuestas conversacionales por WhatsApp (ver Especificación
-- funcional del agente de encuestas). Migración puramente aditiva: no
-- modifica ninguna tabla existente.
--
-- Diseño MVP deliberado: UN bot de encuestas "predeterminado" por número
-- (phone_number_id), no múltiples encuestas concurrentes por contacto — de
-- ahí el unique en dulabs_survey_sessions. Cuando el motor de encuestas
-- crezca a soportar varias encuestas activas por número, esto se revisita.

create table if not exists public.dulabs_survey_bot_config (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  phone_number_id text not null unique,

  -- Personalización de marca (sección 5 y 16 del spec)
  brand_name text not null default 'nuestro servicio',
  agent_name text not null default 'Du',

  -- Plantillas de mensaje (placeholders {brand}/{count}/{time}/{closeDate})
  intro_template text not null default
    'Hola 👋 Queremos conocer tu experiencia con {brand}. Tu opinión nos ayuda a seguir mejorando. Son {count} preguntas cortas y te acompaño durante todo el proceso. ¿Comenzamos?',
  closing_template text not null default
    '¡Terminamos! Muchas gracias por compartir tu experiencia. Tus respuestas son muy importantes y nos ayudan a identificar oportunidades para seguir mejorando {brand}.',
  decline_template text not null default
    'Entendido, gracias por tu tiempo. No te enviaremos más recordatorios de esta encuesta. Si cambias de opinión, podrás retomarla hasta {closeDate}.',
  schedule_confirm_template text not null default
    'Perfecto. Dejamos tu encuesta pausada y continuamos {time} desde donde quedamos.',
  milestone_half text not null default
    '¡Ya vamos por la mitad! Gracias por tomarte este tiempo. Continuemos.',
  milestone_two_left text not null default
    'Ya nos faltan solo dos preguntas. Agradecemos mucho el tiempo que te estás tomando.',
  milestone_last text not null default '¡Última pregunta! Ya terminamos.',

  -- Insistencia responsable (sección 14)
  reminder_delay_hours int not null default 4,
  reminder_max int not null default 2,
  reminder_template text not null default
    'Veo que quizá te ocupaste 😊 Tu avance quedó guardado. Si deseas, podemos continuar desde donde quedamos; tu opinión nos ayuda muchísimo a mejorar {brand}.',

  allow_change_answers boolean not null default true,

  -- Definición de la encuesta predeterminada (arreglo de SurveyQuestion, ver
  -- lib/survey-builder.ts) y su fecha de cierre (sección 5).
  questions jsonb not null default '[]'::jsonb,
  close_date date,

  -- Plantillas de WhatsApp APROBADAS por Meta (creadas vía /dashboard/plantillas)
  -- usadas solo para el contacto inicial o recordatorios FUERA de la ventana
  -- de 24h; dentro de la ventana se usa texto libre normal.
  invite_template_name text not null default 'du_encuesta_invitacion',
  reminder_template_name text not null default 'du_encuesta_recordatorio',

  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dulabs_survey_bot_config_tenant_idx
  on public.dulabs_survey_bot_config (id_tenant);

alter table public.dulabs_survey_bot_config enable row level security;

drop policy if exists tenant_select on public.dulabs_survey_bot_config;
create policy tenant_select on public.dulabs_survey_bot_config
  for select to authenticated
  using (phone_number_id in (select public.dulabs_numeros_del_tenant()));

comment on table public.dulabs_survey_bot_config is
  'Configuración y contenido personalizable del bot de encuestas predeterminado de cada número: marca, mensajes, política de recordatorios y la encuesta activa (preguntas en JSONB, mismo shape que lib/survey-builder.ts SurveyQuestion[]).';

-- Estado del motor de encuestas por participante (mapea 1:1 con
-- SurveySession de lib/survey-engine.ts).

create table if not exists public.dulabs_survey_sessions (
  id bigint generated always as identity primary key,
  phone_number_id text not null,
  telefono_participante text not null,

  status text not null default 'invited',
  -- invited | started | in_progress | paused | resume_scheduled | completed | declined | expired

  current_index int not null default 0,
  answers jsonb not null default '{}'::jsonb,
  reminders_sent int not null default 0,
  milestones_sent jsonb not null default '[]'::jsonb,
  awaiting_schedule boolean not null default false,
  resume_at timestamptz,
  last_interaction_at timestamptz,
  last_reminder_at timestamptz,
  close_date date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint dulabs_survey_sessions_unica unique (phone_number_id, telefono_participante)
);

create index if not exists dulabs_survey_sessions_numero_idx
  on public.dulabs_survey_sessions (phone_number_id);
create index if not exists dulabs_survey_sessions_recordatorios_idx
  on public.dulabs_survey_sessions (status, last_interaction_at)
  where status in ('paused', 'in_progress');
create index if not exists dulabs_survey_sessions_reanudacion_idx
  on public.dulabs_survey_sessions (status, resume_at)
  where status = 'resume_scheduled';

alter table public.dulabs_survey_sessions enable row level security;

drop policy if exists tenant_select on public.dulabs_survey_sessions;
create policy tenant_select on public.dulabs_survey_sessions
  for select to authenticated
  using (phone_number_id in (select public.dulabs_numeros_del_tenant()));

comment on table public.dulabs_survey_sessions is
  'Progreso determinístico de cada participante en la encuesta predeterminada de su número (una fila por phone_number_id+telefono_participante). El backend (webhook + cron), nunca la IA, decide y persiste el estado.';
