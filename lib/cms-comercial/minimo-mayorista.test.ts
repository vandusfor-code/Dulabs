/**
 * El MÍNIMO de la compra inicial mayorista editable desde el panel: las reglas puras (el monto escrito a mano dentro de un texto, las rutas, los grupos de textos), el cálculo del cambio con la
 * validación del esquema REAL del asistente y el adaptador sobre Supabase (con una base falsa que solo anota lo que le piden). Cada regla es una forma real de que un monto quede mal escrito, de que el
 * asistente deje de responder por un texto demasiado largo o de que dos personas se pisen.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { businessConfigSchema } from "@/lib/agente/config";
import { isCmsError } from "@/lib/cms-comercial/errores";
import {
  MINIMO_MAYORISTA_MAX,
  MINIMO_MAYORISTA_MIN,
  GRUPOS_DE_LUGAR,
  conPuntosDeMiles,
  contarLugares,
  grupoDeLugar,
  minimoDeNegocio,
  minimoMayoristaSchema,
  montoEnJson,
  montoEnTexto,
  rutasConMonto,
  textoTieneMonto,
  valorEnRuta,
} from "@/lib/cms-comercial/minimo-mayorista";
import { crearPuertoMinimoMayoristaSupabase, traducirErrorMinimo, vistaDeFilas } from "@/lib/cms-comercial/minimo-mayorista-supabase";
import { minimoVigente, prepararCambioDeMinimo } from "@/lib/cms-comercial/minimo-mayorista-servidor";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Una configuración del asistente como la de Delacour: el monto escrito a mano en el mensaje del inicio y en la información de mayoristas. */
const negocio = (over: Record<string, unknown> = {}) => ({
  nombre_negocio: "Delacour",
  inicio: { mayor: "¡Claro! La compra inicial mayorista parte de $750.000 y luego puedes pedir lo que necesites.", detal: "Con gusto te muestro las piezas." },
  conocimiento: [
    { tema: "envios", info: "Enviamos a todo el país." },
    { tema: "mayoristas", info: "Compra inicial mayorista: desde $750.000. No confundir con 1.750.000 ni con 750.000,50." },
  ],
  pedido: { minimo_mayorista: 750000, pregunta_pago: "¿Cómo pagas?" },
  ...over,
});

describe("el monto escrito a mano", () => {
  it("se ponen puntos de miles sin depender del idioma del equipo", () => {
    assert.deepEqual([conPuntosDeMiles(999), conPuntosDeMiles(10000), conPuntosDeMiles(750000), conPuntosDeMiles(1750000), conPuntosDeMiles(100000000)], ["999", "10.000", "750.000", "1.750.000", "100.000.000"]);
  });

  it("se cambia en todas sus formas, conservando el «$», los espacios y el estilo (con puntos de miles o sin ellos)", () => {
    const cambia = (t: string) => montoEnTexto(t, 750000, 1000000);
    assert.equal(cambia("parte de $750.000 y sigue"), "parte de $1.000.000 y sigue");
    assert.equal(cambia("parte de 750.000 y sigue"), "parte de 1.000.000 y sigue");
    assert.equal(cambia("parte de $750000 y sigue"), "parte de $1000000 y sigue");
    assert.equal(cambia("parte de $ 750.000 y sigue"), "parte de $ 1.000.000 y sigue");
    assert.equal(cambia("mínimo $750.000."), "mínimo $1.000.000.", "un punto al final de la frase no es parte del monto");
    assert.equal(cambia("desde $750.000, o 750000 en efectivo"), "desde $1.000.000, o 1000000 en efectivo");
    assert.equal(cambia("$750.000 y también $750.000"), "$1.000.000 y también $1.000.000");
  });

  it("nunca toca un número que contiene al monto ni otro monto: 1.750.000, 750.000,50, 7500000, 750.0001, $850.000", () => {
    const igual = (t: string) => assert.equal(montoEnTexto(t, 750000, 1000000), t, t);
    igual("1.750.000 no es el mínimo");
    igual("cuesta 750.000,50 pesos");
    igual("cuesta 750.000.50 pesos");
    igual("son 7500000 unidades");
    igual("son 750.0001 unidades");
    igual("el código 1750000 y el 7500001");
    igual("desde $850.000");
    igual("sin ningún monto");
    igual("");
  });

  it("un monto con más cifras que el viejo y uno que empieza por 1 se escriben completos", () => {
    assert.equal(montoEnTexto("parte de $750.000", 750000, 1750000), "parte de $1.750.000");
    assert.equal(montoEnTexto("parte de $750000", 750000, 100000000), "parte de $100000000");
    assert.equal(montoEnTexto("parte de $750.000", 750000, 10000), "parte de $10.000");
  });

  it("textoTieneMonto dice si está escrito a mano (con la misma regla)", () => {
    assert.equal(textoTieneMonto("desde $750.000", 750000), true);
    assert.equal(textoTieneMonto("desde 750000", 750000), true);
    assert.equal(textoTieneMonto("desde 1.750.000", 750000), false);
    assert.equal(textoTieneMonto("desde 750.000,50", 750000), false);
    assert.equal(textoTieneMonto("sin monto", 750000), false);
    // La expresión no guarda estado entre llamadas (una con «g» alternaría aciertos y fallos).
    for (let i = 0; i < 4; i++) assert.equal(textoTieneMonto("desde $750.000", 750000), true);
  });
});

describe("el monto dentro de la configuración (a cualquier profundidad)", () => {
  it("solo cambia dentro de los TEXTOS: ni las claves, ni los números, ni los booleanos, y no altera el original", () => {
    const original = { "750.000": "clave", texto: "desde $750.000", n: 750000, ok: true, nulo: null, lista: ["$750.000", 750000, { x: "750000" }], hondo: { a: { b: "ahora 750.000" } } };
    const copia = JSON.parse(JSON.stringify(original));
    const nuevo = montoEnJson(original, 750000, 900000);
    assert.deepEqual(nuevo, { "750.000": "clave", texto: "desde $900.000", n: 750000, ok: true, nulo: null, lista: ["$900.000", 750000, { x: "900000" }], hondo: { a: { b: "ahora 900.000" } } });
    assert.deepEqual(original, copia, "el original queda intacto");
    assert.notEqual(nuevo, original);
  });

  it("las rutas de los textos que lo tienen: ordenadas, sin repetir, y sin contar el número del propio mínimo", () => {
    assert.deepEqual(rutasConMonto(negocio(), 750000), ["conocimiento.1.info", "inicio.mayor"]);
    assert.deepEqual(rutasConMonto({ pedido: { minimo_mayorista: 750000 } }, 750000), [], "un número no es un texto");
    assert.deepEqual(rutasConMonto(negocio(), 123456), []);
    assert.deepEqual(rutasConMonto("desde $750.000", 750000), [""], "un texto suelto: la ruta es vacía");
  });

  it("valorEnRuta recorre objetos y listas; lo que no existe es undefined", () => {
    assert.equal(valorEnRuta(negocio(), "inicio.detal"), "Con gusto te muestro las piezas.");
    assert.equal(valorEnRuta(negocio(), "conocimiento.0.tema"), "envios");
    assert.equal(valorEnRuta(negocio(), "conocimiento.9.info"), undefined);
    assert.equal(valorEnRuta(negocio(), "inicio.mayor.mas"), undefined);
    assert.equal(valorEnRuta(null, "a"), undefined);
  });

  it("el mínimo de una configuración: solo un número entero", () => {
    assert.equal(minimoDeNegocio(negocio()), 750000);
    for (const mal of [null, undefined, "x", {}, { pedido: null }, { pedido: {} }, { pedido: { minimo_mayorista: "750000" } }, { pedido: { minimo_mayorista: 750000.5 } }, { pedido: { minimo_mayorista: null } }]) {
      assert.equal(minimoDeNegocio(mal), null, JSON.stringify(mal));
    }
  });
});

describe("los textos del asistente se agrupan para la persona (no ve rutas técnicas)", () => {
  it("cada ruta tiene su clase", () => {
    assert.deepEqual(
      ["inicio.mayor", "inicio.detal", "inicio.buscar", "conocimiento.0.info", "pedido.nota_confirmado", "presentacion", "saludo", "tono", "personalidad", "politicas.2", "nombre_agente"].map(grupoDeLugar),
      ["mayor", "inicio", "inicio", "conocimiento", "pedido", "reglas", "reglas", "reglas", "reglas", "reglas", "otros"],
    );
  });

  it("se cuentan por clase, en un orden fijo y solo las que aparecen", () => {
    assert.deepEqual(contarLugares(["conocimiento.3.info", "inicio.mayor", "conocimiento.1.info", "pedido.nota_envio_domicilio"]), [
      { grupo: "mayor", n: 1 },
      { grupo: "conocimiento", n: 2 },
      { grupo: "pedido", n: 1 },
    ]);
    assert.deepEqual(contarLugares([]), []);
    assert.deepEqual([...GRUPOS_DE_LUGAR], ["mayor", "inicio", "conocimiento", "pedido", "reglas", "otros"]);
  });
});

describe("el cuerpo de cambiar el mínimo", () => {
  it("un entero entre $10.000 y $100.000.000, y el monto que se estaba viendo", () => {
    assert.equal(minimoMayoristaSchema.safeParse({ minimo: 900000, esperado: 750000 }).success, true);
    assert.equal(minimoMayoristaSchema.safeParse({ minimo: MINIMO_MAYORISTA_MIN, esperado: 1 }).success, true);
    assert.equal(minimoMayoristaSchema.safeParse({ minimo: MINIMO_MAYORISTA_MAX, esperado: 1 }).success, true);
    for (const mal of [{ minimo: 9999, esperado: 750000 }, { minimo: 100000001, esperado: 750000 }, { minimo: 75.5, esperado: 750000 }, { minimo: "900000", esperado: 750000 }, { minimo: 900000 }, { minimo: 900000, esperado: 0 }, { minimo: 900000, esperado: 750000, extra: 1 }]) {
      assert.equal(minimoMayoristaSchema.safeParse(mal).success, false, JSON.stringify(mal));
    }
  });
});

describe("prepararCambioDeMinimo — con el esquema REAL del asistente", () => {
  it("una configuración válida: cambia el número y el monto escrito, y la nueva sigue cumpliendo el esquema", () => {
    const r = prepararCambioDeMinimo([{ phone_number_id: "111", negocio: negocio() }], 750000, 1000000);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const [fila] = r.filas;
    assert.equal(fila.phone_number_id, "111");
    assert.equal(minimoDeNegocio(fila.despues), 1000000);
    assert.equal(valorEnRuta(fila.despues, "inicio.mayor"), "¡Claro! La compra inicial mayorista parte de $1.000.000 y luego puedes pedir lo que necesites.");
    assert.equal(valorEnRuta(fila.despues, "conocimiento.1.info"), "Compra inicial mayorista: desde $1.000.000. No confundir con 1.750.000 ni con 750.000,50.");
    assert.equal(valorEnRuta(fila.despues, "inicio.detal"), "Con gusto te muestro las piezas.", "lo que no tenía el monto no se toca");
    assert.equal(businessConfigSchema.safeParse(fila.despues).success, true);
    assert.deepEqual(fila.antes, negocio(), "lo de antes queda como estaba (la base compara contra eso)");
    assert.deepEqual(Object.keys(fila.textos_antes), ["conocimiento.1.info", "inicio.mayor"]);
    assert.equal(fila.textos_antes["inicio.mayor"], negocio().inicio.mayor);
    assert.equal(fila.textos_despues["inicio.mayor"], valorEnRuta(fila.despues, "inicio.mayor"));
    assert.deepEqual(r.lugares, ["conocimiento.1.info", "inicio.mayor"]);
  });

  it("varias líneas: todas se preparan y los lugares se juntan sin repetir", () => {
    const sinTexto = negocio({ inicio: { detal: "Hola" }, conocimiento: [{ tema: "x", info: "sin monto" }] });
    const r = prepararCambioDeMinimo([{ phone_number_id: "111", negocio: negocio() }, { phone_number_id: "222", negocio: sinTexto }], 750000, 800000);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.filas.map((f) => f.phone_number_id), ["111", "222"]);
    assert.deepEqual(r.lugares, ["conocimiento.1.info", "inicio.mayor"]);
    assert.deepEqual(r.filas[1].textos_antes, {});
    assert.equal(minimoDeNegocio(r.filas[1].despues), 800000);
  });

  it("un monto más largo que empuja un texto por encima de su máximo (900 en el mensaje del inicio) NO se prepara: el asistente dejaría de responder", () => {
    const justo = `${"a".repeat(891)}$750.000`; // 899 caracteres
    assert.equal(justo.length, 899);
    const lleno = negocio({ inicio: { mayor: justo } });
    assert.equal(businessConfigSchema.safeParse(lleno).success, true, "hoy cumple");
    const largo = prepararCambioDeMinimo([{ phone_number_id: "111", negocio: lleno }], 750000, 1750000);
    assert.deepEqual(largo, { ok: false, motivo: "texto_demasiado_largo", rutas: ["inicio.mayor"] });
    const mismoLargo = prepararCambioDeMinimo([{ phone_number_id: "111", negocio: lleno }], 750000, 800000);
    assert.equal(mismoLargo.ok, true, "con un monto del mismo largo sí cabe");
  });

  it("si la configuración de HOY ya no cumple el esquema (el asistente ya tiene un problema) no se toca, y se dice qué parte", () => {
    const rota = negocio({ tono: "t".repeat(201) });
    assert.deepEqual(prepararCambioDeMinimo([{ phone_number_id: "111", negocio: rota }], 750000, 800000), { ok: false, motivo: "configuracion_invalida", rutas: ["tono"] });
    const conExtra = negocio({ clave_desconocida: "x" });
    const r = prepararCambioDeMinimo([{ phone_number_id: "111", negocio: conExtra }], 750000, 800000);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, "configuracion_invalida");
  });

  it("si UNA línea no cumple, no se prepara ninguna (todo o nada)", () => {
    const rota = negocio({ tono: "t".repeat(201) });
    const r = prepararCambioDeMinimo([{ phone_number_id: "111", negocio: negocio() }, { phone_number_id: "222", negocio: rota }], 750000, 800000);
    assert.equal(r.ok, false);
  });

  it("no incluye el contenido de los textos en lo que avisa de un problema: solo rutas", () => {
    const rota = negocio({ tono: "secreto-que-no-debe-salir".padEnd(205, "x") });
    const r = prepararCambioDeMinimo([{ phone_number_id: "111", negocio: rota }], 750000, 800000);
    assert.equal(r.ok, false);
    assert.equal(JSON.stringify(r).includes("secreto-que-no-debe-salir"), false);
  });
});

describe("el mínimo vigente de varias líneas", () => {
  const fila = (id: string, minimo: unknown) => ({ phone_number_id: id, negocio: { pedido: { minimo_mayorista: minimo } } });
  it("el de todas si coinciden; con montos distintos no se elige: uniforme es falso", () => {
    assert.deepEqual(minimoVigente([fila("1", 750000), fila("2", 750000)]), { minimo: 750000, uniforme: true });
    assert.deepEqual(minimoVigente([fila("1", 750000), fila("2", 900000)]), { minimo: 750000, uniforme: false });
    assert.deepEqual(minimoVigente([]), { minimo: null, uniforme: true });
    assert.deepEqual(minimoVigente([fila("1", "750000")]), { minimo: null, uniforme: true }, "un texto no es un mínimo");
  });

  it("la vista que ve la persona: configurado, el monto, si todas coinciden y en qué textos está escrito", () => {
    assert.deepEqual(vistaDeFilas([{ phone_number_id: "1", negocio: negocio() }]), { configurado: true, minimo: 750000, uniforme: true, filas: 1, lugares: ["conocimiento.1.info", "inicio.mayor"] });
    assert.deepEqual(vistaDeFilas([]), { configurado: false, minimo: null, uniforme: true, filas: 0, lugares: [] });
    assert.equal(vistaDeFilas([fila("1", 750000), fila("2", 900000)]).uniforme, false);
  });
});

/** Una base falsa: responde `ver` con las líneas dadas y anota lo que le piden aplicar. */
function baseFalsa(filas: ReadonlyArray<{ phone_number_id: string; negocio: unknown }>, over: { errorAplicar?: { code?: string; message?: string }; errorVer?: { code?: string; message?: string }; respuestaAplicar?: unknown } = {}) {
  const llamadas: Array<{ nombre: string; args: Record<string, unknown> }> = [];
  const supabase = {
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      llamadas.push({ nombre, args });
      if (nombre === "dulabs_agente_minimo_mayorista_ver") return over.errorVer ? { data: null, error: over.errorVer } : { data: { filas }, error: null };
      if (nombre === "dulabs_agente_minimo_mayorista_aplicar") return over.errorAplicar ? { data: null, error: over.errorAplicar } : { data: over.respuestaAplicar ?? { cambio: true, filas: filas.length }, error: null };
      return { data: null, error: { code: "PGRST202", message: "no existe" } };
    },
  } as unknown as SupabaseClient;
  return { supabase, llamadas };
}
const fallo = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (isCmsError(e)) return e;
    throw e;
  }
  return assert.fail("debía fallar");
};
const T = "aaaaaaaa-0000-4000-8000-00000000000a";
const ACTOR = "d0000000-0000-4000-8000-000000000001";

describe("el adaptador: ver", () => {
  it("calcula la vista de las líneas que devuelve la base", async () => {
    const { supabase, llamadas } = baseFalsa([{ phone_number_id: "111", negocio: negocio() }]);
    const vista = await crearPuertoMinimoMayoristaSupabase(supabase).ver(T);
    assert.deepEqual(vista, { configurado: true, minimo: 750000, uniforme: true, filas: 1, lugares: ["conocimiento.1.info", "inicio.mayor"] });
    assert.deepEqual(llamadas, [{ nombre: "dulabs_agente_minimo_mayorista_ver", args: { p_tenant: T } }]);
  });

  it("sin la migración responde «no disponible» (nada se rompe); una respuesta rara es un error general", async () => {
    const e = await fallo(crearPuertoMinimoMayoristaSupabase(baseFalsa([], { errorVer: { code: "PGRST202", message: "Could not find the function" } }).supabase).ver(T));
    assert.equal(e.code, "FEATURE_UNAVAILABLE");
    const rara = { rpc: async () => ({ data: { algo: 1 }, error: null }) } as unknown as SupabaseClient;
    assert.equal((await fallo(crearPuertoMinimoMayoristaSupabase(rara).ver(T))).code, "INTERNAL_ERROR");
  });
});

describe("el adaptador: fijar", () => {
  const una = [{ phone_number_id: "111", negocio: negocio() }];

  it("cambia: calcula, comprueba y entrega a la base lo que debe aplicar (con quién lo hace y el monto que se estaba viendo)", async () => {
    const { supabase, llamadas } = baseFalsa(una);
    const r = await crearPuertoMinimoMayoristaSupabase(supabase).fijar(T, ACTOR, 1000000, 750000);
    assert.deepEqual(r, { cambio: true, antes: 750000, despues: 1000000, filas: 1, lugares: ["conocimiento.1.info", "inicio.mayor"] });
    const aplicar = llamadas.find((l) => l.nombre === "dulabs_agente_minimo_mayorista_aplicar");
    assert.ok(aplicar);
    assert.deepEqual([aplicar.args.p_tenant, aplicar.args.p_actor, aplicar.args.p_esperado, aplicar.args.p_nuevo], [T, ACTOR, 750000, 1000000]);
    const filas = aplicar.args.p_filas as Array<{ phone_number_id: string; despues: unknown }>;
    assert.equal(filas.length, 1);
    assert.equal(minimoDeNegocio(filas[0].despues), 1000000);
  });

  it("el mismo monto no toca nada (ni siquiera llama a aplicar)", async () => {
    const { supabase, llamadas } = baseFalsa(una);
    assert.deepEqual(await crearPuertoMinimoMayoristaSupabase(supabase).fijar(T, ACTOR, 750000, 750000), { cambio: false, antes: 750000, despues: 750000, filas: 1, lugares: [] });
    assert.equal(llamadas.some((l) => l.nombre === "dulabs_agente_minimo_mayorista_aplicar"), false);
  });

  it("un monto fuera de rango o no entero se rechaza antes de leer nada", async () => {
    for (const mal of [0, 9999, 100000001, 75.5, Number.NaN]) {
      const { supabase, llamadas } = baseFalsa(una);
      const e = await fallo(crearPuertoMinimoMayoristaSupabase(supabase).fijar(T, ACTOR, mal, 750000));
      assert.equal(e.code, "VALIDATION_ERROR", String(mal));
      assert.match(e.message, /entre \$10\.000 y \$100\.000\.000/);
      assert.equal(llamadas.length, 0, "no se consultó la base");
    }
  });

  it("si el monto que la persona veía ya no es el actual: conflicto, y no se aplica nada", async () => {
    const { supabase, llamadas } = baseFalsa(una);
    const e = await fallo(crearPuertoMinimoMayoristaSupabase(supabase).fijar(T, ACTOR, 1000000, 700000));
    assert.deepEqual([e.code, e.status], ["CONFLICT", 409]);
    assert.match(e.message, /cambió mientras lo editabas/);
    assert.equal(llamadas.some((l) => l.nombre === "dulabs_agente_minimo_mayorista_aplicar"), false);
  });

  it("sin mínimo configurado, o con líneas de montos distintos: conflicto claro, y no se aplica nada", async () => {
    const sin = baseFalsa([]);
    const e1 = await fallo(crearPuertoMinimoMayoristaSupabase(sin.supabase).fijar(T, ACTOR, 1000000, 750000));
    assert.deepEqual([e1.code, e1.message], ["CONFLICT", "Tu negocio todavía no tiene un mínimo configurado en el asistente. Avísale al equipo de DuLabs para dejarlo listo."]);
    const distintos = baseFalsa([{ phone_number_id: "111", negocio: negocio() }, { phone_number_id: "222", negocio: negocio({ pedido: { minimo_mayorista: 900000 } }) }]);
    const e2 = await fallo(crearPuertoMinimoMayoristaSupabase(distintos.supabase).fijar(T, ACTOR, 1000000, 750000));
    assert.equal(e2.code, "CONFLICT");
    assert.match(e2.message, /montos mínimos distintos/);
    assert.equal([...sin.llamadas, ...distintos.llamadas].some((l) => l.nombre === "dulabs_agente_minimo_mayorista_aplicar"), false);
  });

  it("un texto que con el monto nuevo superaría su máximo: error claro, no se aplica nada, y el mensaje no trae el contenido", async () => {
    const lleno = [{ phone_number_id: "111", negocio: negocio({ inicio: { mayor: `${"secreto".repeat(10)}${"a".repeat(821)}$750.000` } }) }];
    const { supabase, llamadas } = baseFalsa(lleno);
    const e = await fallo(crearPuertoMinimoMayoristaSupabase(supabase).fijar(T, ACTOR, 1750000, 750000));
    assert.equal(e.code, "VALIDATION_ERROR");
    assert.match(e.message, /superaría el largo permitido y el asistente dejaría de responder\. No se cambió nada/);
    assert.equal(e.message.includes("secreto"), false);
    assert.equal(llamadas.some((l) => l.nombre === "dulabs_agente_minimo_mayorista_aplicar"), false);
  });

  it("una configuración que HOY ya no cumple el esquema: error claro y no se toca", async () => {
    const { supabase, llamadas } = baseFalsa([{ phone_number_id: "111", negocio: negocio({ tono: "t".repeat(201) }) }]);
    const e = await fallo(crearPuertoMinimoMayoristaSupabase(supabase).fijar(T, ACTOR, 1000000, 750000));
    assert.equal(e.code, "VALIDATION_ERROR");
    assert.match(e.message, /problema que hay que corregir antes de cambiar el mínimo/);
    assert.equal(llamadas.some((l) => l.nombre === "dulabs_agente_minimo_mayorista_aplicar"), false);
  });

  it("los errores de la base se traducen: nunca SQL ni nombres internos hacia la persona", async () => {
    const casos: Array<[string, string, number]> = [
      ["minimo_fuera_de_rango", "VALIDATION_ERROR", 400],
      ["minimo_cambio_mientras_tanto", "CONFLICT", 409],
      ["config_cambio_mientras_tanto", "CONFLICT", 409],
      ["minimo_sin_configurar", "CONFLICT", 409],
    ];
    for (const [motivo, code, status] of casos) {
      const { supabase } = baseFalsa(una, { errorAplicar: { code: "P0001", message: motivo } });
      const e = await fallo(crearPuertoMinimoMayoristaSupabase(supabase).fijar(T, ACTOR, 1000000, 750000));
      assert.deepEqual([e.code, e.status], [code, status], motivo);
      assert.equal(e.message.includes(motivo), false, "el código interno no sale hacia la persona");
    }
    const desconocido = traducirErrorMinimo({ code: "XX000", message: 'relation "dulabs_agente_runtime_config" secreto interno' });
    assert.deepEqual([desconocido.code, desconocido.message], ["INTERNAL_ERROR", "No se pudo completar la operación de la tienda."]);
    assert.equal(traducirErrorMinimo({ code: "42883", message: "function does not exist" }).code, "FEATURE_UNAVAILABLE");
  });

  it("una respuesta rara de la base al aplicar es un error general (nunca «listo» a medias)", async () => {
    const { supabase } = baseFalsa(una, { respuestaAplicar: { cambio: false } });
    assert.equal((await fallo(crearPuertoMinimoMayoristaSupabase(supabase).fijar(T, ACTOR, 1000000, 750000))).code, "INTERNAL_ERROR");
  });
});
