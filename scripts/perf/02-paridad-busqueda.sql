-- Rendimiento (Bloque 20) — PARIDAD de la búsqueda antes/después de indexarla.
-- Uso: psql -v fase=antes -f 02-paridad-busqueda.sql  (con la RPC vieja)
--      aplicar 20261117000000_dulabs_catalogo_busqueda_indice.sql
--      psql -v fase=despues -f 02-paridad-busqueda.sql (compara y falla si algo difiere)
\set ON_ERROR_STOP 1
create table if not exists perf_paridad (fase text, caso int, pos int, referencia text, relevancia real, total bigint);
delete from perf_paridad where fase = :'fase';
create temp table casos (caso int, texto text, modo text, canal text, limite int, off int, categoria text, color text, material text, precio_max bigint, excluir text[]);
insert into casos values
 (1,'anillo','all','retail',20,0,null,null,null,null,null),
 (2,'aretes luna','all','retail',20,0,null,null,null,null,null),
 (3,'corazon','all','retail',20,0,null,null,null,null,null),
 (4,'Corazón','all','retail',20,0,null,null,null,null,null),
 (5,'plata rosa','all','retail',20,0,null,null,null,null,null),
 (6,'collar perla dorado','all','retail',20,0,null,null,null,null,null),
 (7,'anillo zafiro morado','any','retail',20,0,null,null,null,null,null),
 (8,'oro','all','retail',20,100,null,null,null,null,null),
 (9,'oro','all','wholesale',20,200,null,null,null,null,null),
 (10,'dora','all','retail',20,0,null,null,null,null,null),
 (11,'aretes','all','retail',20,0,null,'dorado',null,null,null),
 (12,'pulsera','all','retail',20,0,null,null,'plata',null,null),
 (13,'dije','all','retail',20,0,'dijes',null,null,90000,null),
 (14,'dije','all','wholesale',20,0,null,null,null,40000,null),
 (15,'regalo garantia','all','retail',20,0,null,null,null,null,null),
 (16,'collares','all','retail',20,0,null,null,null,null,null),
 (17,'','all','retail',20,0,'aretes',null,null,null,null),
 (18,'luna','all','retail',5,0,null,null,null,null,array['DL-000001','DL-000002']),
 (19,'xyzqwe','all','retail',20,0,null,null,null,null,null),
 (20,'de la con','all','retail',20,0,null,null,null,null,null),
 (21,'topos circon esmeralda','any','retail',20,40,null,null,null,null,null),
 (22,'serpiente','all','retail',20,0,null,null,null,null,null);
insert into perf_paridad
select :'fase', c.caso, row_number() over (partition by c.caso), r.referencia, r.relevancia, r.total
  from casos c
  cross join lateral public.dulabs_catalogo_buscar('aaaaaaaa-0000-4000-8000-0000000000a1', c.texto, c.modo, c.canal, c.limite, c.off, c.categoria, c.color, c.material, null, c.precio_max, c.excluir) r;
select :'fase' as fase, count(*) as filas, count(distinct caso) as casos_con_resultados from perf_paridad where fase = :'fase';
\if :{?comparar}
  select 'DIFERENCIAS' as resultado, count(*) as n from (
    (select caso, pos, referencia, round(relevancia::numeric, 4), total from perf_paridad where fase = 'antes'
     except select caso, pos, referencia, round(relevancia::numeric, 4), total from perf_paridad where fase = 'despues')
    union all
    (select caso, pos, referencia, round(relevancia::numeric, 4), total from perf_paridad where fase = 'despues'
     except select caso, pos, referencia, round(relevancia::numeric, 4), total from perf_paridad where fase = 'antes')
  ) x;
\endif
