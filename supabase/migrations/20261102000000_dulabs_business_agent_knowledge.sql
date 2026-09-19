-- DuLabs Business — Agent Compiler, R4: conocimiento del Business Agent
-- (FAQ estructurada + documentos indexados para recuperación por fragmentos).
--
-- Tablas NUEVAS, aditivas. NO modifican dulabs_clientes_config / dulabs_agentes
-- ni ninguna tabla existente (el `base_conocimiento` legacy sigue intacto para
-- el runtime LEGACY; el Business Agent ya NO lo inyecta completo en el prompt).
--
-- ARQUITECTURA: documento -> extracción -> chunks (~900 chars) -> índice FTS
-- (Postgres full-text, config 'spanish', sin acentos) -> RPC de búsqueda con el
-- tenant filtrado ADENTRO -> el runtime recibe SOLO los fragmentos relevantes.
-- No hay embeddings ni proveedor externo: cero costo por consulta.
--
-- SEGURIDAD:
--   * RLS habilitada SIN política para anon/authenticated => solo service_role
--     (la API del Business Agent, con auth admin + tenant de la sesión, es la
--     única puerta). Mismo criterio que las tablas de calendario (Bloque 15).
--   * El RPC de búsqueda recibe p_tenant: por eso se REVOCA a public/anon/
--     authenticated y solo lo ejecuta service_role. Si un cliente pudiera
--     llamarlo con el tenant de otro, leería su conocimiento.
--   * Los chunks llevan (id_tenant, document_id) con FK compuesta: un chunk no
--     puede pertenecer a un tenant distinto del de su documento.

-- ---------------------------------------------------------------------------
-- 0. Normalización sin extensión `unaccent`: minúsculas + sin tildes (conserva
--    la ñ, que distingue palabras: año/ano). IMMUTABLE para columnas generadas.
--    La misma transformación la aplica el tokenizador del backend a la consulta.
-- ---------------------------------------------------------------------------
create or replace function public.dulabs_ba_unaccent(p_text text)
returns text
language sql
immutable
parallel safe
as $$
  -- Primero se quitan las tildes (mayúsculas y minúsculas) y la Ñ pasa a ñ con translate(), que NO
  -- depende de la collation; después lower() solo debe tocar ASCII. Así el resultado es idéntico
  -- aunque la BD use collation "C". Equivale al unaccent() del tokenizador del backend.
  select lower(translate(p_text,
    'áéíóúüàèìòùâêîôûÁÉÍÓÚÜÀÈÌÒÙÂÊÎÔÛÑ',
    'aeiouuaeiouaeiouAEIOUUAEIOUAEIOUñ'))
$$;

-- ---------------------------------------------------------------------------
-- 1. FAQ estructurada por tenant.
-- ---------------------------------------------------------------------------
create table if not exists public.dulabs_ba_faqs (
  id uuid primary key default gen_random_uuid(),
  id_tenant uuid not null,
  question text not null check (char_length(question) between 3 and 300),
  answer text not null check (char_length(answer) between 1 and 2000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- La pregunta pesa más que la respuesta (A vs B).
  fts tsvector generated always as (
    setweight(to_tsvector('spanish', public.dulabs_ba_unaccent(question)), 'A') ||
    setweight(to_tsvector('spanish', public.dulabs_ba_unaccent(answer)), 'B')
  ) stored
);

create index if not exists dulabs_ba_faqs_tenant_idx on public.dulabs_ba_faqs (id_tenant, created_at desc);
create index if not exists dulabs_ba_faqs_fts_idx on public.dulabs_ba_faqs using gin (fts);

comment on table public.dulabs_ba_faqs is
  'FAQ estructurada del Business Agent (pregunta/respuesta por tenant). Indexada con FTS; el runtime la recupera por relevancia, nunca la inyecta completa en el prompt.';

-- ---------------------------------------------------------------------------
-- 2. Documentos de conocimiento (metadatos + estado de procesamiento).
--    NO se guarda el archivo original: solo el texto extraído en chunks.
-- ---------------------------------------------------------------------------
create table if not exists public.dulabs_ba_knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  id_tenant uuid not null,
  filename text not null check (char_length(filename) between 1 and 200),
  mime_type text,
  size_bytes integer not null check (size_bytes >= 0),
  status text not null default 'processing' check (status in ('processing', 'ready', 'error')),
  error_message text,
  content_sha256 text,
  char_count integer not null default 0,
  chunk_count integer not null default 0,
  truncated boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id_tenant, id)
);

create index if not exists dulabs_ba_knowledge_documents_tenant_idx
  on public.dulabs_ba_knowledge_documents (id_tenant, created_at desc);
-- Un mismo contenido no se indexa dos veces por tenant (idempotencia de re-subida).
create unique index if not exists dulabs_ba_knowledge_documents_sha_uidx
  on public.dulabs_ba_knowledge_documents (id_tenant, content_sha256)
  where content_sha256 is not null and status <> 'error';

comment on table public.dulabs_ba_knowledge_documents is
  'Documentos de conocimiento del Business Agent (estado de procesamiento). El archivo original NO se conserva: solo su texto extraído, en dulabs_ba_knowledge_chunks.';

-- ---------------------------------------------------------------------------
-- 3. Chunks indexados.
-- ---------------------------------------------------------------------------
create table if not exists public.dulabs_ba_knowledge_chunks (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  document_id uuid not null,
  position integer not null check (position >= 0),
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now(),
  fts tsvector generated always as (to_tsvector('spanish', public.dulabs_ba_unaccent(content))) stored,
  -- Un chunk pertenece al MISMO tenant que su documento; borrar el documento borra sus chunks.
  foreign key (id_tenant, document_id)
    references public.dulabs_ba_knowledge_documents (id_tenant, id) on delete cascade
);

create index if not exists dulabs_ba_knowledge_chunks_doc_idx
  on public.dulabs_ba_knowledge_chunks (id_tenant, document_id, position);
create index if not exists dulabs_ba_knowledge_chunks_fts_idx
  on public.dulabs_ba_knowledge_chunks using gin (fts);

comment on table public.dulabs_ba_knowledge_chunks is
  'Fragmentos (~900 chars) de los documentos de conocimiento, con índice FTS spanish sin tildes.';

-- ---------------------------------------------------------------------------
-- 4. Búsqueda: candidatos por FTS (OR de términos) + cobertura de términos.
--    El tenant se filtra AQUÍ (nunca depende del caller). Devuelve como máximo
--    p_limit (<=20) filas ordenadas por relevancia; el backend aplica el umbral
--    de cobertura, el presupuesto de caracteres y el orden final.
--    p_tokens ya vienen normalizados por el backend (sin tildes, [a-z0-9ñ]).
--    p_sources: subconjunto de {'faq','documento'}.
-- ---------------------------------------------------------------------------
create or replace function public.dulabs_ba_knowledge_search(
  p_tenant uuid,
  p_tokens text[],
  p_sources text[],
  p_limit integer default 8
)
returns table (
  source_type text,
  source_id text,
  title text,
  content text,
  rank real,
  matched integer,
  total integer
)
language sql
stable
as $$
  with toks as (
    select distinct public.dulabs_ba_unaccent(t) as t
    from unnest(p_tokens) as t
    where char_length(t) between 2 and 40
    limit 12
  ),
  q as (
    select count(*)::integer as total,
           to_tsquery('spanish', string_agg(quote_literal(t), ' | ')) as query
    from toks
  ),
  faq_hits as (
    select 'faq'::text as source_type, f.id::text as source_id, f.question as title, f.answer as content,
           ts_rank_cd(f.fts, q.query, 32) as rank, f.fts as fts
    from public.dulabs_ba_faqs f, q
    where 'faq' = any (p_sources)
      and f.id_tenant = p_tenant
      and f.active
      and f.fts @@ q.query
    order by rank desc
    limit 20
  ),
  chunk_hits as (
    select 'documento'::text as source_type, c.id::text as source_id, d.filename as title, c.content as content,
           ts_rank_cd(c.fts, q.query, 32) as rank, c.fts as fts
    from public.dulabs_ba_knowledge_chunks c
    join public.dulabs_ba_knowledge_documents d
      on d.id = c.document_id and d.id_tenant = c.id_tenant
    cross join q
    where 'documento' = any (p_sources)
      and c.id_tenant = p_tenant
      and d.status = 'ready'
      and c.fts @@ q.query
    order by rank desc
    limit 20
  ),
  cand as (
    select * from faq_hits
    union all
    select * from chunk_hits
  )
  select cand.source_type, cand.source_id, cand.title, cand.content, cand.rank,
         (select count(*)::integer from toks
           where cand.fts @@ to_tsquery('spanish', quote_literal(toks.t))) as matched,
         q.total
  from cand
  cross join q
  order by cand.rank desc
  limit greatest(1, least(coalesce(p_limit, 8), 20));
$$;

-- ---------------------------------------------------------------------------
-- RLS + permisos: solo service_role.
-- ---------------------------------------------------------------------------
alter table public.dulabs_ba_faqs enable row level security;
alter table public.dulabs_ba_knowledge_documents enable row level security;
alter table public.dulabs_ba_knowledge_chunks enable row level security;

revoke all on function public.dulabs_ba_knowledge_search(uuid, text[], text[], integer) from public, anon, authenticated;
grant execute on function public.dulabs_ba_knowledge_search(uuid, text[], text[], integer) to service_role;

-- updated_at trigger (convención DuLabs) — reutiliza la función del Flow Store.
drop trigger if exists dulabs_ba_faqs_updated_at on public.dulabs_ba_faqs;
create trigger dulabs_ba_faqs_updated_at
  before update on public.dulabs_ba_faqs
  for each row execute function public.dulabs_flow_set_updated_at();

drop trigger if exists dulabs_ba_knowledge_documents_updated_at on public.dulabs_ba_knowledge_documents;
create trigger dulabs_ba_knowledge_documents_updated_at
  before update on public.dulabs_ba_knowledge_documents
  for each row execute function public.dulabs_flow_set_updated_at();
