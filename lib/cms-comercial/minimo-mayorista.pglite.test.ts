/**
 * El MÍNIMO de la compra inicial mayorista sobre el SQL REAL (Postgres embebido, PGlite): la migración 20261214000000 con la tabla de configuración del asistente de verdad. Las garantías que da la BASE sin
 * importar quién la llame: rango, control de concurrencia (nadie pisa un cambio ajeno), todo o nada, solo las líneas habilitadas del negocio, auditoría de solo añadir, permisos solo del backend y
 * reversa que se niega a borrar la huella. Más: el adaptador de Supabase contra esa base, de punta a punta (lee, calcula, comprueba con el esquema del asistente y aplica).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { businessConfigSchema } from "@/lib/agente/config";
import { isCmsError } from "@/lib/cms-comercial/errores";
import { minimoDeNegocio, valorEnRuta } from "@/lib/cms-comercial/minimo-mayorista";
import { crearPuertoMinimoMayoristaSupabase } from "@/lib/cms-comercial/minimo-mayorista-supabase";
import { crearBaseCms, rutaMigracion, rutaRollback, sqlSinMetacomandos, type BaseCms } from "@/lib/cms-comercial/testing/pglite";

const MIGRACION = "20261214000000_dulabs_agente_minimo_mayorista.sql";
const ROLLBACK = "20261214000000_dulabs_agente_minimo_mayorista.down.sql";
const TA = "aaaaaaaa-0000-4000-8000-00000000000a";
const TB = "bbbbbbbb-0000-4000-8000-00000000000b";
const ACTOR = "d0000000-0000-4000-8000-000000000001";

let base: BaseCms;

before(async () => {
  // Sin las tablas del CMS (no se usan): solo los roles de Supabase y las tablas del asistente, con las MISMAS migraciones reales.
  base = await crearBaseCms({ aplicarMigracion: false });
  await base.db.exec(readFileSync(rutaMigracion("20261109000000_dulabs_agente_runtime.sql"), "utf8"));
  await base.db.exec(readFileSync(rutaMigracion("20261201000000_dulabs_agente_negocio_64kb.sql"), "utf8"));
  await base.db.exec(readFileSync(rutaMigracion(MIGRACION), "utf8"));
});
after(async () => {
  await base.cerrar();
});
beforeEach(async () => {
  await base.db.exec("delete from public.dulabs_agente_runtime_config");
  // La auditoría es de solo añadir: para limpiar entre pruebas se apaga el seguro SOLO aquí (en producción nadie puede).
  await base.db.exec("alter table public.dulabs_agente_config_cambios disable trigger dulabs_agente_config_cambios_inmutables; delete from public.dulabs_agente_config_cambios; alter table public.dulabs_agente_config_cambios enable trigger dulabs_agente_config_cambios_inmutables");
});

/** Una configuración del asistente como la de Delacour. */
const negocio = (minimo: number | null = 750000, texto = "desde $750.000") => ({
  nombre_negocio: "Delacour",
  inicio: { mayor: `La compra inicial mayorista parte ${texto}.` },
  conocimiento: [{ tema: "mayoristas", info: `Compra inicial: ${texto}. No confundir con 1.750.000.` }],
  pedido: minimo === null ? {} : { minimo_mayorista: minimo },
});

let serie = 0;
async function linea(tenant: string, neg: unknown, over: { habilitado?: boolean; telefono?: string } = {}) {
  serie += 1;
  const telefono = over.telefono ?? `5730000${String(serie).padStart(5, "0")}`;
  await base.db.query(
    `insert into public.dulabs_agente_runtime_config (id_tenant, phone_number_id, tipo, habilitado, proveedor, modelo, credencial_ref, herramientas, negocio)
     values ($1, $2, 'catalog_sales', $3, 'gemini', 'gemini-2.5-flash', 'env:GEMINI_KEY_PRUEBA', array['buscar_catalogo'], $4::jsonb)`,
    [tenant, telefono, over.habilitado ?? true, JSON.stringify(neg)],
  );
  return telefono;
}
const leerNegocio = async (telefono: string) => (await base.sql<{ negocio: Record<string, unknown> }>("select negocio from public.dulabs_agente_runtime_config where phone_number_id = $1", [telefono]))[0].negocio;
const auditoria = () => base.sql<{ id_tenant: string; phone_number_id: string; actor_user_id: string; campo: string; antes: { minimo: number; textos: Record<string, string> }; despues: { minimo: number; textos: Record<string, string> } }>("select * from public.dulabs_agente_config_cambios order by id");
const ver = async (tenant: string) => (await base.supabase.rpc("dulabs_agente_minimo_mayorista_ver", { p_tenant: tenant })).data as { filas: Array<{ phone_number_id: string; negocio: unknown }> };
const aplicar = (tenant: string, esperado: number | null, nuevo: number | null, filas: unknown, actor: string | null = ACTOR) =>
  base.supabase.rpc("dulabs_agente_minimo_mayorista_aplicar", { p_tenant: tenant, p_actor: actor, p_esperado: esperado, p_nuevo: nuevo, p_filas: filas });
/** Lo que la aplicación entregaría por una línea: la configuración de antes y la de después (con el mínimo nuevo). */
const fila = (telefono: string, antes: unknown, despues: unknown, textos?: { antes?: Record<string, string>; despues?: Record<string, string> }) => ({ phone_number_id: telefono, antes, despues, textos_antes: textos?.antes ?? {}, textos_despues: textos?.despues ?? {} });
const codigoDe = (r: { error: { message?: string } | null }) => r.error?.message ?? null;

describe("la migración", () => {
  it("se puede aplicar dos veces (idempotente) y deja la auditoría, la reversa y las funciones donde deben estar", async () => {
    await base.db.exec(readFileSync(rutaMigracion(MIGRACION), "utf8"));
    await base.db.exec(readFileSync(rutaMigracion(MIGRACION), "utf8"));
    const funciones = await base.sql<{ proname: string }>("select proname from pg_proc where proname like 'dulabs_agente_minimo_mayorista_%' order by 1");
    assert.deepEqual(funciones.map((f) => f.proname), ["dulabs_agente_minimo_mayorista_aplicar", "dulabs_agente_minimo_mayorista_ver"]);
    assert.equal((await base.sql("select 1 from information_schema.tables where table_name = 'dulabs_agente_config_cambios'")).length, 1);
  });

  it("exige la tabla del asistente: sin ella se niega con un mensaje claro", async () => {
    const vacia = await crearBaseCms({ aplicarMigracion: false });
    try {
      await assert.rejects(() => vacia.db.exec(readFileSync(rutaMigracion(MIGRACION), "utf8")), /falta la tabla dulabs_agente_runtime_config/);
    } finally {
      await vacia.cerrar();
    }
  });
});

describe("ver: las líneas en juego", () => {
  it("solo las HABILITADAS del negocio con un mínimo (número), con su configuración completa y en un orden fijo", async () => {
    const a = await linea(TA, negocio(750000), { telefono: "573000000002" });
    const b = await linea(TA, negocio(750000), { telefono: "573000000001" });
    await linea(TA, negocio(750000), { habilitado: false, telefono: "573000000003" });
    await linea(TA, negocio(null), { telefono: "573000000004" });
    await linea(TA, { nombre_negocio: "X", pedido: { minimo_mayorista: "750000" } }, { telefono: "573000000005" });
    await linea(TB, negocio(900000), { telefono: "573000000006" });
    const r = await ver(TA);
    assert.deepEqual(r.filas.map((f) => f.phone_number_id).sort(), [a, b].sort());
    assert.equal(r.filas.length, 2);
    assert.deepEqual(r.filas[0].negocio, negocio(750000));
  });

  it("un negocio sin líneas con mínimo devuelve una lista vacía (no un error)", async () => {
    assert.deepEqual(await ver(TA), { filas: [] });
  });
});

describe("aplicar: el cambio que calculó la aplicación", () => {
  it("cambia el mínimo y la configuración de TODAS las líneas habilitadas del negocio, y deja una fila de auditoría por línea con quién, cuándo y los textos de antes y de después", async () => {
    const a = await linea(TA, negocio(750000));
    const b = await linea(TA, negocio(750000, "desde 750000"));
    const apagada = await linea(TA, negocio(750000), { habilitado: false });
    const ajena = await linea(TB, negocio(750000));
    const despuesA = negocio(900000, "desde $900.000");
    const despuesB = negocio(900000, "desde 900000");
    const r = await aplicar(TA, 750000, 900000, [
      fila(a, negocio(750000), despuesA, { antes: { "inicio.mayor": "La compra inicial mayorista parte desde $750.000." }, despues: { "inicio.mayor": "La compra inicial mayorista parte desde $900.000." } }),
      fila(b, negocio(750000, "desde 750000"), despuesB),
    ]);
    assert.equal(r.error, null);
    assert.deepEqual(r.data, { cambio: true, filas: 2 });
    assert.deepEqual(await leerNegocio(a), despuesA);
    assert.deepEqual(await leerNegocio(b), despuesB);
    assert.deepEqual(await leerNegocio(apagada), negocio(750000), "una línea apagada no se toca");
    assert.deepEqual(await leerNegocio(ajena), negocio(750000), "otro negocio no se toca");

    const filas = await auditoria();
    assert.equal(filas.length, 2);
    assert.deepEqual(filas.map((f) => f.phone_number_id).sort(), [a, b].sort());
    const deA = filas.find((f) => f.phone_number_id === a);
    assert.ok(deA);
    assert.deepEqual([deA.id_tenant, deA.actor_user_id, deA.campo], [TA, ACTOR, "pedido.minimo_mayorista"]);
    assert.deepEqual(deA.antes, { minimo: 750000, textos: { "inicio.mayor": "La compra inicial mayorista parte desde $750.000." } });
    assert.deepEqual(deA.despues, { minimo: 900000, textos: { "inicio.mayor": "La compra inicial mayorista parte desde $900.000." } });
    assert.deepEqual(filas.find((f) => f.phone_number_id === b)?.antes, { minimo: 750000, textos: {} });
  });

  it("la configuración que queda sigue siendo válida para el asistente (el mismo esquema con el que la carga)", async () => {
    const a = await linea(TA, negocio(750000));
    await aplicar(TA, 750000, 1000000, [fila(a, negocio(750000), negocio(1000000, "desde $1.000.000"))]);
    assert.equal(businessConfigSchema.safeParse(await leerNegocio(a)).success, true);
  });

  it("el mínimo debe ser un entero entre $10.000 y $100.000.000: fuera de eso la base lo rechaza (y el esperado es obligatorio) y no toca nada", async () => {
    const a = await linea(TA, negocio(750000));
    for (const nuevo of [0, 9999, 100000001, null]) {
      const r = await aplicar(TA, 750000, nuevo, [fila(a, negocio(750000), negocio(900000))]);
      assert.match(codigoDe(r) ?? "", /minimo_fuera_de_rango/, String(nuevo));
    }
    assert.match(codigoDe(await aplicar(TA, null, 900000, [fila(a, negocio(750000), negocio(900000))])) ?? "", /minimo_fuera_de_rango/);
    for (const limite of [10000, 100000000]) {
      const r = await aplicar(TA, 750000, limite, [fila(a, negocio(750000), negocio(limite))]);
      assert.equal(r.error, null, `el límite ${limite} sí vale`);
      await aplicar(TA, limite, 750000, [fila(a, negocio(limite), negocio(750000))]);
    }
    assert.deepEqual(await leerNegocio(a), negocio(750000));
  });

  it("control de concurrencia: si el mínimo que vio la aplicación ya no es el actual, se rechaza y no se pisa el cambio de nadie", async () => {
    const a = await linea(TA, negocio(850000));
    const r = await aplicar(TA, 750000, 900000, [fila(a, negocio(750000), negocio(900000))]);
    assert.match(codigoDe(r) ?? "", /minimo_cambio_mientras_tanto/);
    assert.deepEqual(await leerNegocio(a), negocio(850000));
    assert.equal((await auditoria()).length, 0);
  });

  it("si otra persona cambió OTRO texto de la configuración mientras tanto, también se rechaza (la comparación es contra la configuración entera)", async () => {
    const a = await linea(TA, negocio(750000));
    const vista = negocio(750000);
    await base.db.query("update public.dulabs_agente_runtime_config set negocio = jsonb_set(negocio, '{nombre_negocio}', '\"Delacour & Orus\"') where phone_number_id = $1", [a]);
    const r = await aplicar(TA, 750000, 900000, [fila(a, vista, negocio(900000))]);
    assert.match(codigoDe(r) ?? "", /config_cambio_mientras_tanto/);
    assert.equal((await leerNegocio(a)).nombre_negocio, "Delacour & Orus", "el cambio de la otra persona sigue ahí");
    assert.equal((await auditoria()).length, 0);
  });

  it("las líneas tienen que ser EXACTAMENTE las que vio la aplicación: si se habilitó otra, o falta una, se rechaza", async () => {
    const a = await linea(TA, negocio(750000));
    const b = await linea(TA, negocio(750000));
    // La aplicación vio solo la línea a; entre tanto la línea b entró en juego.
    assert.match(codigoDe(await aplicar(TA, 750000, 900000, [fila(a, negocio(750000), negocio(900000))])) ?? "", /config_cambio_mientras_tanto/);
    // La aplicación vio una línea que no existe (o ya no está en juego).
    assert.match(codigoDe(await aplicar(TA, 750000, 900000, [fila(a, negocio(750000), negocio(900000)), fila(b, negocio(750000), negocio(900000)), fila("573999999999", negocio(750000), negocio(900000))])) ?? "", /config_cambio_mientras_tanto/);
    assert.deepEqual(await leerNegocio(a), negocio(750000));
    assert.deepEqual(await leerNegocio(b), negocio(750000));
  });

  it("sin ninguna línea con mínimo no se inventa uno; con montos distintos entre líneas tampoco se elige por la persona", async () => {
    assert.match(codigoDe(await aplicar(TA, 750000, 900000, [fila("573111111111", negocio(750000), negocio(900000))])) ?? "", /minimo_sin_configurar/);
    const a = await linea(TA, negocio(750000));
    const b = await linea(TA, negocio(850000));
    const r = await aplicar(TA, 750000, 900000, [fila(a, negocio(750000), negocio(900000)), fila(b, negocio(850000), negocio(900000))]);
    assert.match(codigoDe(r) ?? "", /minimo_cambio_mientras_tanto/, "una de las líneas no tiene el mínimo que se esperaba");
    assert.deepEqual(await leerNegocio(a), negocio(750000));
    assert.deepEqual(await leerNegocio(b), negocio(850000));
  });

  it("lo que se escribe tiene que ser una configuración (objeto) con EL mínimo nuevo: si no, se rechaza", async () => {
    const a = await linea(TA, negocio(750000));
    const malos: unknown[] = [negocio(800000), "texto", [1, 2], null, { ...negocio(900000), pedido: {} }, { ...negocio(900000), pedido: { minimo_mayorista: "900000" } }];
    for (const despues of malos) {
      const r = await aplicar(TA, 750000, 900000, [fila(a, negocio(750000), despues)]);
      assert.match(codigoDe(r) ?? "", /cambio_invalido/, JSON.stringify(despues));
    }
    for (const filas of [[], null, {}, "x"]) assert.match(codigoDe(await aplicar(TA, 750000, 900000, filas)) ?? "", /cambio_invalido/, JSON.stringify(filas));
    assert.deepEqual(await leerNegocio(a), negocio(750000));
    assert.equal((await auditoria()).length, 0);
  });

  it("todo o nada: si una línea no puede guardarse (supera el tamaño que admite la tabla), no cambia ninguna ni queda auditoría", async () => {
    const a = await linea(TA, negocio(750000), { telefono: "573000000001" });
    const b = await linea(TA, negocio(750000), { telefono: "573000000002" });
    const enorme = { ...negocio(900000), relleno: "x".repeat(70_000) };
    const r = await aplicar(TA, 750000, 900000, [fila(a, negocio(750000), negocio(900000)), fila(b, negocio(750000), enorme)]);
    assert.ok(r.error, "la base rechaza la línea que no cabe");
    assert.deepEqual(await leerNegocio(a), negocio(750000), "la primera línea NO quedó cambiada");
    assert.deepEqual(await leerNegocio(b), negocio(750000));
    assert.equal((await auditoria()).length, 0);
  });

  it("quien cambia queda en la auditoría; sin usuario (null) también se puede registrar el cambio", async () => {
    const a = await linea(TA, negocio(750000));
    await aplicar(TA, 750000, 900000, [fila(a, negocio(750000), negocio(900000))], null);
    assert.equal((await auditoria())[0].actor_user_id, null);
  });
});

describe("la auditoría es de solo añadir", () => {
  it("nadie puede modificar ni borrar una fila (ni siquiera con permisos de servicio)", async () => {
    const a = await linea(TA, negocio(750000));
    await aplicar(TA, 750000, 900000, [fila(a, negocio(750000), negocio(900000))]);
    await assert.rejects(() => base.db.query("update public.dulabs_agente_config_cambios set campo = 'pedido.minimo_mayorista'"), /auditoria_append_only/);
    await assert.rejects(() => base.db.query("delete from public.dulabs_agente_config_cambios"), /auditoria_append_only/);
    assert.equal((await auditoria()).length, 1);
  });

  it("solo admite el campo que existe hoy", async () => {
    await assert.rejects(() => base.db.query("insert into public.dulabs_agente_config_cambios (id_tenant, phone_number_id, campo, antes, despues) values ($1, '1', 'otro.campo', '{}', '{}')", [TA]), /check/i);
  });
});

describe("permisos: solo el backend", () => {
  it("ni la llave pública (anon) ni un usuario con sesión (authenticated) pueden llamar las funciones ni leer la auditoría; el backend (service_role) sí", async () => {
    await linea(TA, negocio(750000));
    for (const rol of ["anon", "authenticated"]) {
      await base.db.exec(`set role ${rol}`);
      try {
        await assert.rejects(() => base.db.query("select public.dulabs_agente_minimo_mayorista_ver($1)", [TA]), /permission denied/i, `${rol}: ver`);
        await assert.rejects(() => base.db.query("select public.dulabs_agente_minimo_mayorista_aplicar($1, null, 750000, 900000, '[]'::jsonb)", [TA]), /permission denied/i, `${rol}: aplicar`);
        await assert.rejects(() => base.db.query("select * from public.dulabs_agente_config_cambios"), /permission denied/i, `${rol}: auditoría`);
      } finally {
        await base.db.exec("reset role");
      }
    }
    await base.db.exec("set role service_role");
    try {
      const r = await base.db.query("select public.dulabs_agente_minimo_mayorista_ver($1) as r", [TA]);
      assert.ok(r.rows.length === 1);
    } finally {
      await base.db.exec("reset role");
    }
  });
});

describe("el adaptador contra esa base, de punta a punta", () => {
  const puerto = () => crearPuertoMinimoMayoristaSupabase(base.supabase);
  const fallo = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      if (isCmsError(e)) return e;
      throw e;
    }
    return assert.fail("debía fallar");
  };

  it("ver: el monto, que las líneas coinciden y en qué textos está escrito a mano", async () => {
    await linea(TA, negocio(750000));
    assert.deepEqual(await puerto().ver(TA), { configurado: true, minimo: 750000, uniforme: true, filas: 1, lugares: ["conocimiento.0.info", "inicio.mayor"] });
    assert.deepEqual(await puerto().ver(TB), { configurado: false, minimo: null, uniforme: true, filas: 0, lugares: [] });
  });

  it("fijar: cambia el número y el monto escrito a mano (también el escrito sin puntos), deja 1.750.000 como estaba, audita y la configuración sigue siendo válida", async () => {
    const a = await linea(TA, negocio(750000));
    const b = await linea(TA, negocio(750000, "desde 750000"));
    const r = await puerto().fijar(TA, ACTOR, 1200000, 750000);
    assert.deepEqual(r, { cambio: true, antes: 750000, despues: 1200000, filas: 2, lugares: ["conocimiento.0.info", "inicio.mayor"] });
    const na = await leerNegocio(a);
    const nb = await leerNegocio(b);
    assert.equal(minimoDeNegocio(na), 1200000);
    assert.equal(valorEnRuta(na, "inicio.mayor"), "La compra inicial mayorista parte desde $1.200.000.");
    assert.equal(valorEnRuta(na, "conocimiento.0.info"), "Compra inicial: desde $1.200.000. No confundir con 1.750.000.", "1.750.000 no se toca");
    assert.equal(valorEnRuta(nb, "inicio.mayor"), "La compra inicial mayorista parte desde 1200000.");
    assert.equal(businessConfigSchema.safeParse(na).success && businessConfigSchema.safeParse(nb).success, true);
    const filas = await auditoria();
    assert.equal(filas.length, 2);
    assert.deepEqual(filas[0].antes.textos, { "conocimiento.0.info": "Compra inicial: desde $750.000. No confundir con 1.750.000.", "inicio.mayor": "La compra inicial mayorista parte desde $750.000." });
    assert.equal(filas[0].despues.textos["inicio.mayor"], "La compra inicial mayorista parte desde $1.200.000.");
    // Y la vista ya muestra el monto nuevo.
    assert.equal((await puerto().ver(TA)).minimo, 1200000);
  });

  it("un texto que con el monto nuevo superaría su máximo no se cambia: nada se escribe y no hay auditoría", async () => {
    const justo = `${"a".repeat(891)}$750.000`;
    const a = await linea(TA, { ...negocio(750000), inicio: { mayor: justo } });
    const e = await fallo(puerto().fijar(TA, ACTOR, 1750000, 750000));
    assert.equal(e.code, "VALIDATION_ERROR");
    assert.match(e.message, /superaría el largo permitido/);
    assert.equal(minimoDeNegocio(await leerNegocio(a)), 750000);
    assert.equal((await auditoria()).length, 0);
  });

  it("dos personas a la vez: la segunda, que veía el monto de antes, recibe un conflicto y no pisa a la primera", async () => {
    const a = await linea(TA, negocio(750000));
    await puerto().fijar(TA, ACTOR, 900000, 750000);
    const e = await fallo(puerto().fijar(TA, ACTOR, 1000000, 750000));
    assert.deepEqual([e.code, e.status], ["CONFLICT", 409]);
    assert.equal(minimoDeNegocio(await leerNegocio(a)), 900000);
  });

  it("una configuración cambiada entre la lectura y la escritura (la base lo detecta) se informa como conflicto", async () => {
    const a = await linea(TA, negocio(750000));
    // Entre la lectura y la escritura alguien cambia otro texto: el adaptador usa un cliente que lo simula justo antes de aplicar.
    const intermedio = {
      rpc: async (nombre: string, args: Record<string, unknown>) => {
        if (nombre === "dulabs_agente_minimo_mayorista_aplicar") await base.db.query("update public.dulabs_agente_runtime_config set negocio = jsonb_set(negocio, '{nombre_negocio}', '\"Otro nombre\"') where phone_number_id = $1", [a]);
        return base.supabase.rpc(nombre, args);
      },
    } as unknown as Parameters<typeof crearPuertoMinimoMayoristaSupabase>[0];
    const e = await fallo(crearPuertoMinimoMayoristaSupabase(intermedio).fijar(TA, ACTOR, 900000, 750000));
    assert.deepEqual([e.code, e.status], ["CONFLICT", 409]);
    assert.match(e.message, /configuración de tu asistente cambió/);
    assert.equal((await leerNegocio(a)).nombre_negocio, "Otro nombre");
    assert.equal(minimoDeNegocio(await leerNegocio(a)), 750000);
  });

  it("antes de aplicar la migración las funciones no existen: se responde «todavía no está activo» (y nada se rompe)", async () => {
    const vieja = await crearBaseCms({ aplicarMigracion: false });
    try {
      const e = await fallo(crearPuertoMinimoMayoristaSupabase(vieja.supabase).ver(TA));
      assert.equal(e.code, "FEATURE_UNAVAILABLE");
      assert.equal(e.status, 503);
      assert.match(e.message, /todavía no está activo/);
    } finally {
      await vieja.cerrar();
    }
  });
});

describe("la reversa", () => {
  it("se niega a correr si ya hay cambios auditados (perdería quién los hizo y cómo eran los textos), y con la auditoría vacía lo quita todo sin tocar el asistente", async () => {
    const a = await linea(TA, negocio(750000));
    await aplicar(TA, 750000, 900000, [fila(a, negocio(750000), negocio(900000))]);
    const reversa = sqlSinMetacomandos(readFileSync(rutaRollback(ROLLBACK), "utf8"));
    await assert.rejects(() => base.db.exec(reversa), /ya hay 1 cambios auditados/);
    await base.db.exec("rollback"); // el script abre su transacción: al negarse, quien lo corre la cierra (psql termina la sesión)
    assert.equal((await base.sql("select 1 from information_schema.tables where table_name = 'dulabs_agente_config_cambios'")).length, 1, "la tabla sigue ahí");
    assert.equal((await base.sql("select 1 from pg_proc where proname = 'dulabs_agente_minimo_mayorista_aplicar'")).length, 1, "las funciones también");

    // Con la auditoría vacía sí vuelve atrás, y el asistente queda exactamente como estaba (con el cambio ya hecho).
    await base.db.exec("alter table public.dulabs_agente_config_cambios disable trigger dulabs_agente_config_cambios_inmutables; delete from public.dulabs_agente_config_cambios");
    await base.db.exec(reversa);
    assert.equal((await base.sql("select 1 from information_schema.tables where table_name = 'dulabs_agente_config_cambios'")).length, 0);
    assert.equal((await base.sql("select 1 from pg_proc where proname like 'dulabs_agente_minimo_mayorista_%'")).length, 0);
    assert.equal(minimoDeNegocio(await leerNegocio(a)), 900000, "la reversa no deshace lo que ya se cambió en el asistente");
    // Y se puede volver a aplicar la migración.
    await base.db.exec(readFileSync(rutaMigracion(MIGRACION), "utf8"));
    assert.equal((await base.sql("select proname from pg_proc where proname = 'dulabs_agente_minimo_mayorista_aplicar'")).length, 1);
  });
});
