/**
 * CMS comercial — VALIDACIÓN antes de publicar. PURA: recibe el borrador y un contexto ya cargado (productos, categorías, imágenes, otros elementos, variables).
 *
 * Distingue:
 *   - ERRORES: bloquean la publicación, con un mensaje claro para la administradora («Esta oferta no puede publicarse porque no tiene productos asociados»).
 *   - ADVERTENCIAS: avisan sin bloquear (un producto inactivo en una oferta, una campaña aún sin publicar…).
 * Un borrador puede estar incompleto y guardarse; solo publicar exige que no haya errores. Lo que pasa esta validación es lo que `esquemas.ts` acepta al leer.
 */
import type { z } from "zod";
import { isReference } from "@/lib/catalogo/domain";
import type { EstadoEntidad, Problema, ResultadoValidacion, TipoEntidad } from "@/lib/cms-comercial/contrato";
import { precioConBeneficio } from "@/lib/cms-comercial/evaluacion";
import { ESQUEMA_POR_TIPO, type Beneficio } from "@/lib/cms-comercial/esquemas";
import { contieneEnlaceMayorista, ordenAlAsistente, pareceSecreto } from "@/lib/cms-comercial/texto-seguro";
import { finExclusivoMs } from "@/lib/cms-comercial/tiempo";
import { VARIABLES, escribioMontoAMano, esVariable, formatearPesos, variablesEn, type ValoresVariables } from "@/lib/cms-comercial/variables";

export interface ProductoValidacion {
  referencia: string;
  nombre: string;
  categoriaId: string | null;
  activo: boolean;
  agotado: boolean;
  /** Precio detal en pesos; null = a consultar. */
  precioDetal: number | null;
  /** Precio mayorista; null = el producto no tiene. */
  precioMayor: number | null;
}

export interface ContextoValidacion {
  /** Instante de la validación (ms), del reloj inyectado. */
  ahora: number;
  /** Productos que EXISTEN en el catálogo del negocio, por referencia. Una referencia ausente del mapa no existe. */
  productos: ReadonlyMap<string, ProductoValidacion>;
  categorias: ReadonlyMap<string, { id: string; nombre: string }>;
  /** Imágenes del negocio por id. */
  assets: ReadonlyMap<string, { id: string; estado: "pendiente" | "listo" }>;
  /** Otros elementos del negocio, con llave `tipo:clave` (para validar campañas y destinos de botones). */
  elementos: ReadonlyMap<string, { estado: EstadoEntidad; archivada: boolean; nombre: string }>;
  /** Valores configurados de las variables del negocio. */
  variables: ValoresVariables;
  /** Mínimo de la compra inicial mayorista configurado (para detectar que alguien lo escriba a mano). */
  minimoMayorista: number | null;
}

export const llaveElemento = (tipo: "oferta" | "combo" | "campana", clave: string) => `${tipo}:${clave}`;

// ---------------------------------------------------------------------------
// Acceso defensivo al borrador (puede estar incompleto o mal formado)
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
const esObjeto = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const cadena = (v: unknown): string | null => (typeof v === "string" ? v : null);
const objeto = (v: unknown): Json => (esObjeto(v) ? v : {});

export interface Dependencias {
  referencias: Array<{ valor: string; campo: string }>;
  categorias: Array<{ valor: string; campo: string }>;
  assets: Array<{ valor: string; campo: string }>;
  elementos: Array<{ tipo: "oferta" | "combo" | "campana"; clave: string; campo: string }>;
}

function destino(d: unknown, campo: string, dep: Dependencias) {
  const o = objeto(d);
  const tipo = cadena(o.tipo);
  if (tipo === "categoria" && cadena(o.categoria_id)) dep.categorias.push({ valor: o.categoria_id as string, campo: `${campo}.categoria_id` });
  if ((tipo === "oferta" || tipo === "combo" || tipo === "campana") && cadena(o.clave)) dep.elementos.push({ tipo, clave: o.clave as string, campo: `${campo}.clave` });
}

function imagen(i: unknown, campo: string, dep: Dependencias) {
  const o = objeto(i);
  if (o.origen === "cms" && cadena(o.asset)) dep.assets.push({ valor: o.asset as string, campo: `${campo}.asset` });
}

/** Todo lo que el borrador menciona y hay que consultar (productos, categorías, imágenes y otros elementos), con la ruta del campo para los mensajes. */
export function dependenciasDe(tipo: TipoEntidad, borrador: unknown): Dependencias {
  const b = objeto(borrador);
  const dep: Dependencias = { referencias: [], categorias: [], assets: [], elementos: [] };
  const refs = (v: unknown, campo: string) => lista(v).forEach((r, i) => typeof r === "string" && dep.referencias.push({ valor: r, campo: `${campo}.${i}` }));
  const cats = (v: unknown, campo: string) => lista(v).forEach((c, i) => typeof c === "string" && dep.categorias.push({ valor: c, campo: `${campo}.${i}` }));
  if (tipo === "home") {
    const portada = objeto(b.portada);
    imagen(portada.imagen, "portada.imagen", dep);
    destino(objeto(portada.boton).destino, "portada.boton.destino", dep);
    const banner = objeto(b.banner);
    imagen(banner.imagen, "banner.imagen", dep);
    destino(banner.destino, "banner.destino", dep);
    cats(b.categorias_destacadas, "categorias_destacadas");
    refs(b.productos_destacados, "productos_destacados");
  } else if (tipo === "oferta") {
    imagen(b.imagen, "imagen", dep);
    const alcance = objeto(b.alcance);
    refs(alcance.referencias, "alcance.referencias");
    cats(alcance.categorias, "alcance.categorias");
    if (cadena(b.campana)) dep.elementos.push({ tipo: "campana", clave: b.campana as string, campo: "campana" });
  } else if (tipo === "combo") {
    imagen(b.imagen, "imagen", dep);
    lista(b.componentes).forEach((c, i) => {
      const r = cadena(objeto(c).referencia);
      if (r) dep.referencias.push({ valor: r, campo: `componentes.${i}.referencia` });
    });
    if (cadena(b.campana)) dep.elementos.push({ tipo: "campana", clave: b.campana as string, campo: "campana" });
  } else if (tipo === "campana") {
    imagen(b.imagen, "imagen", dep);
    const portada = objeto(b.portada);
    imagen(portada.imagen, "portada.imagen", dep);
    destino(objeto(portada.boton).destino, "portada.boton.destino", dep);
    refs(b.productos_destacados, "productos_destacados");
  }
  return dep;
}

// ---------------------------------------------------------------------------
// Mensajes en español
// ---------------------------------------------------------------------------

const ETIQUETAS: Readonly<Record<string, string>> = {
  nombre: "Nombre",
  descripcion: "Descripción",
  imagen: "Imagen",
  modalidad: "Modalidad",
  beneficio: "Beneficio",
  "beneficio.tipo": "Tipo de beneficio",
  "beneficio.valor": "Porcentaje de descuento",
  "beneficio.detal": "Valor para clientes detal",
  "beneficio.mayorista": "Valor para clientes mayoristas",
  alcance: "Productos o categorías",
  "alcance.todos": "Toda la tienda",
  "alcance.referencias": "Productos",
  "alcance.categorias": "Categorías",
  vigencia: "Vigencia",
  "vigencia.desde": "Fecha de inicio",
  "vigencia.hasta": "Fecha de fin",
  condiciones: "Condiciones",
  prioridad: "Prioridad",
  campana: "Campaña",
  componentes: "Productos del combo",
  "componentes.referencia": "Producto",
  "componentes.cantidad": "Cantidad",
  precio: "Precio del combo",
  "precio.detal": "Precio para clientes detal",
  "precio.mayorista": "Precio para clientes mayoristas",
  portada: "Portada",
  "portada.visible": "Portada visible",
  "portada.imagen": "Imagen de la portada",
  "portada.titulo": "Título de la portada",
  "portada.subtitulo": "Subtítulo",
  "portada.etiqueta": "Etiqueta",
  "portada.boton": "Botón de la portada",
  "portada.boton.texto": "Texto del botón",
  "portada.boton.destino": "Destino del botón",
  banner: "Banner",
  "banner.imagen": "Imagen del banner",
  "banner.visible": "Banner visible",
  "banner.destino": "Destino del banner",
  secciones: "Secciones",
  categorias_destacadas: "Categorías destacadas",
  productos_destacados: "Productos destacados",
  tema: "Tema",
  audiencia: "Audiencia",
  titulo: "Título",
  texto: "Texto",
  palabras_clave: "Palabras clave",
  orden: "Orden",
};

const rutaDe = (path: ReadonlyArray<PropertyKey>) => path.map(String).join(".");
const sinIndices = (campo: string) => campo.split(".").filter((s) => !/^\d+$/.test(s)).join(".");
export const etiquetaDeCampo = (campo: string): string => ETIQUETAS[sinIndices(campo)] ?? sinIndices(campo).split(".").pop() ?? campo;

function mensajeDeZod(issue: z.core.$ZodIssue): string {
  const campo = rutaDe(issue.path);
  const etiqueta = etiquetaDeCampo(campo);
  if (issue.code === "invalid_type") {
    return (issue as { input?: unknown }).input === undefined ? `Falta completar: ${etiqueta}.` : `El valor de «${etiqueta}» no es válido.`;
  }
  if (issue.code === "invalid_union") return `Elige una opción válida en «${etiqueta}».`;
  if (issue.code === "unrecognized_keys") return `Campo no permitido: ${((issue as { keys?: string[] }).keys ?? []).join(", ")}.`;
  if (issue.code === "invalid_value") return issue.message && !/^Invalid/i.test(issue.message) ? issue.message : `Elige una opción válida en «${etiqueta}».`;
  return issue.message && !/^Invalid/i.test(issue.message) ? issue.message : `El valor de «${etiqueta}» no es válido.`;
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

export function validar(tipo: TipoEntidad, borrador: unknown, ctx: ContextoValidacion): ResultadoValidacion {
  const errores: Problema[] = [];
  const advertencias: Problema[] = [];
  const err = (codigo: string, campo: string, mensaje: string) => void errores.push({ severidad: "error", codigo, campo, mensaje });
  const adv = (codigo: string, campo: string, mensaje: string) => void advertencias.push({ severidad: "advertencia", codigo, campo, mensaje });

  // 1) Estructura, límites y reglas de cada campo.
  const parseo = ESQUEMA_POR_TIPO[tipo].safeParse(borrador);
  if (!parseo.success) for (const issue of parseo.error.issues) err("esquema", rutaDe(issue.path), mensajeDeZod(issue));

  // 2) Textos: ni órdenes al asistente, ni secretos, ni variables fuera del contenido.
  revisarTextos(tipo, borrador, err);

  // 3) Lo que el borrador menciona debe existir.
  revisarDependencias(tipo, borrador, ctx, err, adv);

  // 4) Vigencia: una fecha de fin que ya pasó no se puede publicar.
  if (tipo !== "home") {
    const hasta = cadena(objeto(objeto(borrador).vigencia).hasta);
    const fin = hasta === null ? null : finExclusivoMs(hasta);
    if (fin !== null && fin <= ctx.ahora) err("vigencia_vencida", "vigencia.hasta", "Esta fecha de finalización ya pasó.");
  }

  // 5) Reglas de negocio de cada tipo (necesitan el contenido ya tipado).
  if (parseo.success) {
    switch (tipo) {
      case "home":
        revisarHome(parseo.data as never, adv);
        break;
      case "oferta":
        revisarOferta(parseo.data as never, ctx, err, adv);
        break;
      case "combo":
        revisarCombo(parseo.data as never, ctx, err, adv);
        break;
      case "contenido":
        revisarContenido(parseo.data as never, ctx, err, adv);
        break;
      default:
        break;
    }
  } else if (tipo === "contenido") {
    // Las variables y el mínimo mayorista se revisan aunque el resto no esté completo.
    revisarContenido(objeto(borrador) as never, ctx, err, adv);
  }

  return { ok: errores.length === 0, errores: unicos(errores), advertencias: unicos(advertencias) };
}

function unicos(ps: Problema[]): Problema[] {
  const vistos = new Set<string>();
  return ps.filter((p) => {
    const k = `${p.codigo}|${p.campo}|${p.mensaje}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

type Reportar = (codigo: string, campo: string, mensaje: string) => void;

function recorrerTextos(v: unknown, campo: string, visitar: (texto: string, campo: string) => void) {
  if (typeof v === "string") visitar(v, campo);
  else if (Array.isArray(v)) v.forEach((x, i) => recorrerTextos(x, campo ? `${campo}.${i}` : String(i), visitar));
  else if (esObjeto(v)) for (const [k, x] of Object.entries(v)) recorrerTextos(x, campo ? `${campo}.${k}` : k, visitar);
}

function revisarTextos(tipo: TipoEntidad, borrador: unknown, err: Reportar) {
  recorrerTextos(borrador, "", (texto, campo) => {
    const orden = ordenAlAsistente(texto);
    if (orden) err("texto_instruccion", campo, `«${etiquetaDeCampo(campo)}» parece contener instrucciones para el asistente. Escribe solo información para los clientes.`);
    if (pareceSecreto(texto)) err("texto_secreto", campo, `«${etiquetaDeCampo(campo)}» parece contener una clave o contraseña. Quítala: nunca se guardan claves en el contenido de la tienda.`);
    if (tipo !== "contenido" && /\{\{|\}\}/.test(texto)) err("variable_no_permitida", campo, "Las variables entre llaves solo se pueden usar en el contenido comercial (preguntas, políticas e información).");
  });
}

function revisarDependencias(tipo: TipoEntidad, borrador: unknown, ctx: ContextoValidacion, err: Reportar, adv: Reportar) {
  const dep = dependenciasDe(tipo, borrador);
  for (const { valor, campo } of dep.referencias) {
    // Una referencia mal escrita ya la reporta el esquema; aquí solo importa si una bien escrita existe.
    if (!isReference(valor)) continue;
    const p = ctx.productos.get(valor);
    if (!p) err("producto_inexistente", campo, `El producto ${valor} no existe en tu catálogo.`);
    else if (!p.activo) adv("producto_inactivo", campo, `El producto ${valor} (${p.nombre}) está inactivo: no se podrá comprar mientras siga así.`);
  }
  for (const { valor, campo } of dep.categorias) {
    if (!ctx.categorias.has(valor)) err("categoria_inexistente", campo, "Una de las categorías elegidas ya no existe.");
  }
  for (const { valor, campo } of dep.assets) {
    const a = ctx.assets.get(valor);
    if (!a) err("imagen_inexistente", campo, "La imagen elegida ya no existe. Sube otra.");
    else if (a.estado !== "listo") err("imagen_pendiente", campo, "La imagen todavía no terminó de subirse. Espera un momento y vuelve a intentar.");
  }
  for (const { tipo: t, clave, campo } of dep.elementos) {
    const el = ctx.elementos.get(llaveElemento(t, clave));
    const nombreTipo = t === "oferta" ? "la oferta" : t === "combo" ? "el combo" : "la campaña";
    if (!el || el.archivada) {
      err("elemento_inexistente", campo, `Ya no existe ${nombreTipo} «${clave}».`);
    } else if (campo === "campana") {
      if (el.estado !== "publicada") adv("campana_no_publicada", campo, `Pertenece a la campaña «${el.nombre}», que aún no está publicada: no se verá hasta que la campaña esté activa.`);
    } else if (el.estado !== "publicada") {
      err("destino_no_publicado", campo, `El botón apunta a ${nombreTipo} «${el.nombre}», que todavía no está publicad${t === "combo" ? "o" : "a"}. Publícalo primero.`);
    }
  }
}

function revisarHome(h: { portada: { visible: boolean; imagen?: unknown }; secciones: Array<{ tipo: string; visible: boolean }>; categorias_destacadas: string[]; productos_destacados: string[] }, adv: Reportar) {
  if (h.portada.visible && !h.portada.imagen) {
    // Una portada visible sin foto se vería a medias: la tienda no la muestra (nunca un hero a medias).
    adv("portada_sin_imagen", "portada.imagen", "La portada está visible pero no tiene imagen: la tienda no la mostrará hasta que elijas una.");
  }
  const visible = (t: string) => h.secciones.some((s) => s.tipo === t && s.visible);
  if (visible("destacados") && h.productos_destacados.length === 0) adv("seccion_vacia", "secciones", "La sección de productos destacados está visible pero no elegiste productos: se mostrarán los más recientes.");
  if (visible("categorias") && h.categorias_destacadas.length === 0) adv("seccion_vacia", "secciones", "La sección de categorías está visible pero no elegiste categorías: se mostrarán todas.");
  if (visible("portada") && !h.portada.visible) adv("seccion_oculta", "secciones", "La sección «portada» está activa pero la portada está oculta.");
}

function revisarOferta(o: { modalidad: "detal" | "mayorista" | "ambas"; beneficio: Beneficio; alcance: { todos: boolean; referencias: string[]; categorias: string[] }; condiciones?: string }, ctx: ContextoValidacion, err: Reportar, adv: Reportar) {
  const { alcance } = o;
  if (!alcance.todos && alcance.referencias.length === 0 && alcance.categorias.length === 0) {
    err("oferta_sin_productos", "alcance", "Esta oferta no puede publicarse porque no tiene productos asociados.");
  }
  if (o.condiciones && o.modalidad !== "mayorista" && contieneEnlaceMayorista(o.condiciones)) {
    err("enlace_mayorista", "condiciones", "No escribas el enlace del catálogo mayorista: lo verían clientes detal.");
  }

  // ¿Mejora el precio de los productos que se eligieron uno por uno?
  const canales = [...(o.modalidad === "mayorista" ? [] : (["retail"] as const)), ...(o.modalidad === "detal" ? [] : (["wholesale"] as const))];
  let conEfecto = 0;
  for (const ref of alcance.referencias) {
    const p = ctx.productos.get(ref);
    if (!p) continue;
    let mejora = false;
    for (const canal of canales) {
      const lista = canal === "retail" ? p.precioDetal : p.precioMayor;
      if (lista === null) {
        adv("producto_sin_precio", `alcance.referencias`, `El producto ${ref} no tiene precio ${canal === "retail" ? "detal" : "mayorista"}: la oferta no le aplicará a esos clientes.`);
      } else if (precioConBeneficio(lista, o.beneficio, canal) === null) {
        adv("oferta_sin_efecto_en_producto", `alcance.referencias`, `La oferta no mejora el precio ${canal === "retail" ? "detal" : "mayorista"} de ${ref} (${formatearPesos(lista)}): no se le aplicará.`);
      } else mejora = true;
    }
    if (mejora) conEfecto += 1;
  }
  if (!alcance.todos && alcance.categorias.length === 0 && alcance.referencias.length > 0 && conEfecto === 0 && alcance.referencias.every((r) => ctx.productos.has(r))) {
    err("oferta_sin_efecto", "alcance", "La oferta no mejora el precio de ninguno de los productos elegidos. Revisa el descuento o el precio especial.");
  }
}

function revisarCombo(c: { modalidad: "detal" | "mayorista" | "ambas"; componentes: Array<{ referencia: string; cantidad: number }>; precio: { detal?: number; mayorista?: number }; condiciones?: string }, ctx: ContextoValidacion, err: Reportar, adv: Reportar) {
  if (c.condiciones && c.modalidad !== "mayorista" && contieneEnlaceMayorista(c.condiciones)) err("enlace_mayorista", "condiciones", "No escribas el enlace del catálogo mayorista: lo verían clientes detal.");
  for (const canal of [...(c.modalidad === "mayorista" ? [] : (["retail"] as const)), ...(c.modalidad === "detal" ? [] : (["wholesale"] as const))]) {
    const etiqueta = canal === "retail" ? "detal" : "mayorista";
    let normal = 0;
    let completo = true;
    c.componentes.forEach((comp, i) => {
      const p = ctx.productos.get(comp.referencia);
      if (!p) {
        completo = false;
        return;
      }
      const lista = canal === "retail" ? p.precioDetal : p.precioMayor;
      if (lista === null) {
        completo = false;
        err("componente_sin_precio", `componentes.${i}.referencia`, `El producto ${comp.referencia} (${p.nombre}) no tiene precio ${etiqueta}: no se puede calcular cuánto ahorra el combo.`);
      } else normal += lista * comp.cantidad;
      if (p.agotado) adv("componente_agotado", `componentes.${i}.referencia`, `El producto ${comp.referencia} (${p.nombre}) está agotado: el combo aparecerá como no disponible.`);
    });
    const precio = canal === "retail" ? c.precio.detal : c.precio.mayorista;
    if (completo && precio !== undefined && precio >= normal) {
      err("combo_sin_ahorro", `precio.${canal === "retail" ? "detal" : "mayorista"}`, `El precio del combo ${etiqueta} (${formatearPesos(precio)}) debe ser menor que comprar los productos por separado (${formatearPesos(normal)}).`);
    }
  }
}

function revisarContenido(c: { titulo?: string; texto?: string; audiencia?: string }, ctx: ContextoValidacion, err: Reportar, adv: Reportar) {
  for (const campo of ["titulo", "texto"] as const) {
    const valor = cadena(c[campo]);
    if (valor === null) continue;
    for (const nombre of variablesEn(valor)) {
      if (!esVariable(nombre)) err("variable_desconocida", campo, `La variable {{${nombre}}} no existe. Las disponibles son: ${VARIABLES.map((v) => `{{${v}}}`).join(", ")}.`);
      else if (typeof ctx.variables[nombre] !== "string" || ctx.variables[nombre] === "") err("variable_sin_valor", campo, `La variable {{${nombre}}} todavía no está configurada para tu negocio. Pídele a DuLabs que la configure.`);
    }
    if (ctx.minimoMayorista !== null && escribioMontoAMano(valor, ctx.minimoMayorista)) {
      err("monto_a_mano", campo, `No escribas ${formatearPesos(ctx.minimoMayorista)} a mano: usa {{minimo_mayorista}}. Así el valor siempre coincide con el que se aplica en el pedido.`);
    }
    if (/\$\s?\d/.test(valor.replace(/\{\{[^{}]*\}\}/g, ""))) {
      adv("monto_escrito", campo, "Estás escribiendo un precio dentro del texto. Si cambia, este texto quedará desactualizado: usa una oferta o el precio del catálogo.");
    }
    if (c.audiencia !== "mayorista" && contieneEnlaceMayorista(valor)) err("enlace_mayorista", campo, "No escribas el enlace del catálogo mayorista en un texto que ven clientes detal.");
  }
}
