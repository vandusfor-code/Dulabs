-- DuLabs Developer V1 -- Fase 5 (autorizado, decisión D4). Columna
-- aditiva para persistir el wamid real que Meta devuelve en una
-- confirmación de éxito (messages[0].id) -- hoy se descargaba y nunca se
-- guardaba (hallazgo F2 del diseño de Fase 5). Sin esto, es imposible
-- correlacionar un job interno con eventos reales de status de Meta
-- (sent/delivered/read/failed vía webhook) -- ese mecanismo de
-- correlación real queda para Fase 6 (decisión D1), esta migración solo
-- prepara el dato.
--
-- NULL es el valor esperado y correcto para todo job que no haya llegado
-- (todavía, o nunca) a un 2xx real de Meta con un wamid válido -- no se
-- rellena retroactivamente ningún dato histórico.

alter table public.dulabs_dev_jobs
  add column if not exists wamid text;

comment on column public.dulabs_dev_jobs.wamid is
  'DuLabs Developer V1 (Fase 5). El wamid real que Meta devolvió en messages[0].id tras una confirmación 2xx real -- ver lib/developer/meta-message-mapper.ts::extraerWamid. NULL si el job nunca llegó a esa confirmación, o si Meta respondió 2xx sin un wamid con formato válido (caso raro, documentado, nunca se inventa un valor).';
