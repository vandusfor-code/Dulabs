/**
 * CMS comercial — SERVICIO: el ciclo BORRADOR → VALIDACIÓN → PUBLICAR → VERSIÓN ACTIVA (+ pausar, despublicar, restaurar, archivar) con permisos por rol.
 *
 * Es el único punto de entrada para modificar contenido comercial (la API del Dashboard solo traduce HTTP). Reglas que impone, con prueba y mutante cada una:
 *   - solo un administrador crea, edita, publica, pausa, despublica, restaura o archiva; los demás roles del equipo solo consultan;
 *   - todo se hace sobre el negocio del actor y un elemento de otro negocio «no existe»;
 *   - un borrador se guarda aunque esté incompleto, pero PUBLICAR exige que la validación no tenga errores y publica EXACTAMENTE lo que se validó (la
 *     revisión `rev` validada viaja a la base: si alguien cambió el borrador entre medias, hay conflicto y no se publica nada);
 *   - restaurar vuelve a validar la versión con las reglas de hoy y verifica su checksum;
 *   - cada acción relevante queda en la auditoría (la escribe la base en la misma transacción del cambio).
 */
import { checksumDe } from "@/lib/cms-comercial/checksum";
import {
  CMS_ROLES_ESCRITURA,
  CMS_ROLES_LECTURA,
  nombreDeEntidad,
  type ActorCms,
  type EntidadCms,
  type EstadoEntidad,
  type Modalidad,
  type Problema,
  type RegistroAuditoria,
  type ResultadoValidacion,
  type TipoEntidad,
  type VersionCms,
} from "@/lib/cms-comercial/contrato";
import { CmsError } from "@/lib/cms-comercial/errores";
import { claveDesdeTexto, normalizarBorrador } from "@/lib/cms-comercial/esquemas";
import type { PuertoCatalogo, PuertoVariables } from "@/lib/cms-comercial/puertos";
import type { CmsRepositorio, FiltroListado, ResultadoMutacion } from "@/lib/cms-comercial/repositorio";
import { normalizarTexto, pareceSecreto } from "@/lib/cms-comercial/texto-seguro";
import { estadoDeVigencia, relojReal, type EstadoVigencia, type Reloj } from "@/lib/cms-comercial/tiempo";
import { dependenciasDe, llaveElemento, validar, type ContextoValidacion } from "@/lib/cms-comercial/validacion";

/** Tope de elementos por negocio y tipo (incluye archivados): protege la base de un uso desbordado. */
export const LIMITE_POR_TIPO: Readonly<Record<TipoEntidad, number>> = { home: 1, oferta: 200, combo: 100, campana: 50, contenido: 500 };

const NOMBRE_TIPO: Readonly<Record<TipoEntidad, string>> = { home: "la página principal", oferta: "las ofertas", combo: "los combos", campana: "las campañas", contenido: "los contenidos" };

export interface EntidadResumen {
  id: string;
  tipo: TipoEntidad;
  clave: string;
  nombre: string;
  estado: EstadoEntidad;
  /** Vigencia derivada AHORA de lo que está en vivo (o del borrador si nunca se publicó). null si el tipo no tiene vigencia. */
  estadoVigencia: EstadoVigencia | null;
  /** Hay un borrador distinto de lo publicado. */
  tieneCambios: boolean;
  versionActiva: number | null;
  rev: number;
  modalidad: string | null;
  /** Solo en el contenido comercial: de qué trata (horarios, envíos, mayoristas…). null en los demás tipos. */
  tema: string | null;
  archivada: boolean;
  updatedAt: string;
  publishedAt: string | null;
}

export interface EntidadDetalle extends EntidadResumen {
  /** Con qué se edita: el borrador pendiente o, si no hay, lo publicado. */
  contenido: Record<string, unknown>;
  borrador: Record<string, unknown> | null;
  contenidoActivo: Record<string, unknown> | null;
}

export interface CmsServicioDeps {
  repo: CmsRepositorio;
  catalogo: PuertoCatalogo;
  variables: PuertoVariables;
  reloj?: Reloj;
}

export interface CmsServicio {
  listar(actor: ActorCms, filtro?: FiltroListado): Promise<EntidadResumen[]>;
  obtener(actor: ActorCms, id: string): Promise<EntidadDetalle>;
  crear(actor: ActorCms, input: { tipo: TipoEntidad; borrador: unknown }): Promise<EntidadDetalle>;
  guardarBorrador(actor: ActorCms, id: string, input: { borrador: unknown; rev: number }): Promise<EntidadDetalle>;
  validar(actor: ActorCms, id: string): Promise<ResultadoValidacion>;
  publicar(actor: ActorCms, id: string, input: { rev: number; nota?: string | null }): Promise<{ entidad: EntidadDetalle; version: number; advertencias: Problema[] }>;
  restaurar(actor: ActorCms, id: string, input: { version: number; nota?: string | null }): Promise<{ entidad: EntidadDetalle; version: number }>;
  pausar(actor: ActorCms, id: string): Promise<EntidadDetalle>;
  reanudar(actor: ActorCms, id: string): Promise<EntidadDetalle>;
  despublicar(actor: ActorCms, id: string): Promise<EntidadDetalle>;
  archivar(actor: ActorCms, id: string): Promise<EntidadDetalle>;
  desarchivar(actor: ActorCms, id: string): Promise<EntidadDetalle>;
  versiones(actor: ActorCms, id: string): Promise<VersionCms[]>;
  auditoria(actor: ActorCms, filtro?: { entidadId?: string; limite?: number; antesDe?: number }): Promise<RegistroAuditoria[]>;
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const unicos = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

export function crearServicioCms(deps: CmsServicioDeps): CmsServicio {
  const { repo, catalogo, variables } = deps;
  const reloj = deps.reloj ?? relojReal;

  function exigirLectura(actor: ActorCms) {
    if (!CMS_ROLES_LECTURA.includes(actor.rol)) throw new CmsError("FORBIDDEN", "No tienes acceso a la administración de la tienda.");
  }
  function exigirEscritura(actor: ActorCms) {
    if (!CMS_ROLES_ESCRITURA.includes(actor.rol)) throw new CmsError("FORBIDDEN", "Solo un administrador puede modificar la tienda.");
  }

  function resumen(e: EntidadCms): EntidadResumen {
    const ahora = reloj();
    const mostrado = e.borrador ?? e.contenidoActivo ?? {};
    const envivo = e.contenidoActivo ?? e.borrador ?? {};
    const tieneVigencia = e.tipo !== "home" && (e.tipo === "contenido" || esObjeto(envivo.vigencia));
    const modalidad = e.tipo === "contenido" ? envivo.audiencia : envivo.modalidad;
    return {
      id: e.id,
      tipo: e.tipo,
      clave: e.clave,
      nombre: nombreDeEntidad(e.tipo, mostrado),
      estado: e.estado,
      estadoVigencia: tieneVigencia ? estadoDeVigencia(esObjeto(envivo.vigencia) ? (envivo.vigencia as { desde?: string; hasta?: string }) : {}, ahora) : null,
      tieneCambios: e.borrador !== null,
      versionActiva: e.versionActiva,
      rev: e.rev,
      modalidad: typeof modalidad === "string" ? (modalidad as Modalidad) : null,
      tema: e.tipo === "contenido" && typeof mostrado.tema === "string" ? mostrado.tema : null,
      archivada: e.archivadaAt !== null,
      updatedAt: e.updatedAt,
      publishedAt: e.publishedAt,
    };
  }

  const detalle = (e: EntidadCms): EntidadDetalle => ({ ...resumen(e), contenido: e.borrador ?? e.contenidoActivo ?? {}, borrador: e.borrador, contenidoActivo: e.contenidoActivo });

  async function cargar(actor: ActorCms, id: string): Promise<EntidadCms> {
    const e = await repo.obtener(actor.tenantId, id);
    if (!e || e.tenantId !== actor.tenantId) throw new CmsError("NOT_FOUND", "No encontramos ese elemento.");
    return e;
  }

  async function cargarContexto(tenantId: string, tipo: TipoEntidad, contenido: unknown): Promise<ContextoValidacion> {
    const dep = dependenciasDe(tipo, contenido);
    const referencias = unicos(dep.referencias.map((r) => r.valor));
    const categorias = unicos(dep.categorias.map((c) => c.valor));
    const assets = unicos(dep.assets.map((a) => a.valor));
    const tiposElementos = unicos(dep.elementos.map((e) => e.tipo));
    const [productos, cats, listaAssets, listasElementos, vars] = await Promise.all([
      referencias.length > 0 ? catalogo.productosPorReferencia(tenantId, referencias) : Promise.resolve([]),
      categorias.length > 0 ? catalogo.categoriasPorId(tenantId, categorias) : Promise.resolve([]),
      Promise.all(assets.map((id) => repo.obtenerAsset(tenantId, id))),
      Promise.all(tiposElementos.map((t) => repo.listar(tenantId, { tipo: t, incluirArchivadas: true }))),
      variables.valores(tenantId),
    ]);
    const elementos = new Map<string, { estado: EstadoEntidad; archivada: boolean; nombre: string }>();
    for (const lista of listasElementos) {
      for (const e of lista) {
        if (e.tipo === "home" || e.tipo === "contenido") continue;
        elementos.set(llaveElemento(e.tipo, e.clave), { estado: e.estado, archivada: e.archivadaAt !== null, nombre: nombreDeEntidad(e.tipo, e.borrador ?? e.contenidoActivo) });
      }
    }
    return {
      ahora: reloj(),
      productos: new Map(productos.map((p) => [p.referencia, p])),
      categorias: new Map(cats.map((c) => [c.id, c])),
      assets: new Map(listaAssets.flatMap((a) => (a ? [[a.id, { id: a.id, estado: a.estado }] as const] : []))),
      elementos,
      variables: vars.variables,
      minimoMayorista: vars.minimoMayorista,
    };
  }

  /** Traduce el resultado de una mutación: lo exitoso devuelve la entidad; lo demás, un error claro para la administradora. */
  function resolver(r: ResultadoMutacion, accion: "editar" | "publicar" | "restaurar" | "pausar" | "reanudar" | "despublicar" | "archivar" | "desarchivar"): EntidadCms {
    switch (r.resultado) {
      case "ok":
        return r.entidad;
      case "conflicto":
        throw new CmsError("CONFLICT", "Otra persona cambió este elemento mientras lo editabas. Recarga la página para ver la versión más reciente.");
      case "no_encontrada":
        throw new CmsError("NOT_FOUND", "No encontramos ese elemento.");
      case "archivada":
        throw new CmsError("ARCHIVED", "Este elemento está archivado. Desarchívalo para poder modificarlo.");
      case "sin_cambios":
        throw new CmsError("INVALID_STATE", "No hay cambios para publicar.");
      case "version_no_encontrada":
        throw new CmsError("NOT_FOUND", "Esa versión no existe.");
      case "invalido":
        throw new CmsError("VALIDATION_ERROR", "El contenido no es válido.");
      case "estado_invalido": {
        const mensajes: Record<string, string> = {
          pausar: "Solo se puede pausar lo que está publicado.",
          reanudar: "Solo se puede reanudar lo que está pausado.",
          despublicar: "Este elemento no está publicado.",
          archivar: r.estado === "archivada" ? "Este elemento ya está archivado." : "Despublica el elemento antes de archivarlo.",
          desarchivar: "Este elemento no está archivado.",
        };
        throw new CmsError("INVALID_STATE", mensajes[accion] ?? "Esa acción no se puede hacer en el estado actual del elemento.");
      }
    }
  }

  function limpiarNota(nota: string | null | undefined): string | null {
    if (nota === null || nota === undefined) return null;
    const n = normalizarTexto(nota);
    if (n === "") return null;
    if (n.length > 500) throw new CmsError("VALIDATION_ERROR", "La nota no puede superar 500 caracteres.");
    if (pareceSecreto(n)) throw new CmsError("VALIDATION_ERROR", "La nota parece contener una clave o contraseña. Quítala.");
    return n;
  }

  const transicion = (nombre: "pausar" | "reanudar" | "despublicar" | "archivar" | "desarchivar") => async (actor: ActorCms, id: string): Promise<EntidadDetalle> => {
    exigirEscritura(actor);
    await cargar(actor, id);
    return detalle(resolver(await repo[nombre](actor.tenantId, id, actor), nombre));
  };

  return {
    async listar(actor, filtro) {
      exigirLectura(actor);
      return (await repo.listar(actor.tenantId, filtro)).map(resumen);
    },

    async obtener(actor, id) {
      exigirLectura(actor);
      return detalle(await cargar(actor, id));
    },

    async crear(actor, input) {
      exigirEscritura(actor);
      const norm = normalizarBorrador(input.tipo, input.borrador);
      if (!norm.ok) throw new CmsError("VALIDATION_ERROR", norm.mensaje);
      const existentes = await repo.listar(actor.tenantId, { tipo: input.tipo, incluirArchivadas: true });
      if (existentes.length >= LIMITE_POR_TIPO[input.tipo]) {
        throw new CmsError("VALIDATION_ERROR", input.tipo === "home" ? "La página principal ya existe." : `Llegaste al máximo de ${NOMBRE_TIPO[input.tipo]} (${LIMITE_POR_TIPO[input.tipo]}). Archiva alguno que ya no uses.`);
      }
      let base = "home";
      if (input.tipo !== "home") {
        const nombre = nombreDeEntidad(input.tipo, norm.borrador);
        if (nombre === "Sin nombre") throw new CmsError("VALIDATION_ERROR", input.tipo === "contenido" ? "Escribe un título para crear el contenido." : "Escribe un nombre para crear el elemento.");
        base = claveDesdeTexto(nombre, input.tipo).slice(0, 74);
      }
      for (let intento = 1; intento <= 30; intento++) {
        const clave = input.tipo === "home" || intento === 1 ? base : `${base}-${intento}`;
        const r = await repo.crear(actor.tenantId, { tipo: input.tipo, clave, borrador: norm.borrador, actor });
        if (r.resultado === "ok") return detalle(r.entidad);
        if (r.resultado === "invalido") throw new CmsError("VALIDATION_ERROR", "El contenido no es válido.");
        if (input.tipo === "home") throw new CmsError("CONFLICT", "La página principal ya existe.");
      }
      throw new CmsError("CONFLICT", "No se pudo generar un código único para este elemento. Cambia el nombre e inténtalo de nuevo.");
    },

    async guardarBorrador(actor, id, input) {
      exigirEscritura(actor);
      const e = await cargar(actor, id);
      const norm = normalizarBorrador(e.tipo, input.borrador);
      if (!norm.ok) throw new CmsError("VALIDATION_ERROR", norm.mensaje);
      return detalle(resolver(await repo.guardarBorrador(actor.tenantId, id, { borrador: norm.borrador, revEsperada: input.rev, actor }), "editar"));
    },

    async validar(actor, id) {
      exigirLectura(actor);
      const e = await cargar(actor, id);
      const contenido = e.borrador ?? e.contenidoActivo ?? {};
      return validar(e.tipo, contenido, await cargarContexto(actor.tenantId, e.tipo, contenido));
    },

    async publicar(actor, id, input) {
      exigirEscritura(actor);
      const nota = limpiarNota(input.nota);
      const e = await cargar(actor, id);
      if (e.archivadaAt !== null) throw new CmsError("ARCHIVED", "Este elemento está archivado. Desarchívalo para poder publicarlo.");
      if (e.borrador === null) throw new CmsError("INVALID_STATE", "No hay cambios para publicar.");
      if (e.rev !== input.rev) throw new CmsError("CONFLICT", "Otra persona cambió este elemento mientras lo editabas. Recarga la página para ver la versión más reciente.");
      const resultado = validar(e.tipo, e.borrador, await cargarContexto(actor.tenantId, e.tipo, e.borrador));
      if (!resultado.ok) throw new CmsError("NOT_PUBLISHABLE", "Corrige los problemas marcados antes de publicar.", resultado.errores);
      const r = await repo.publicar(actor.tenantId, id, { revEsperada: e.rev, versionEsperada: e.versionActiva ?? 0, checksum: checksumDe(e.borrador), nota, actor });
      const entidad = resolver(r, "publicar");
      return { entidad: detalle(entidad), version: r.resultado === "ok" && r.version !== undefined ? r.version : (entidad.versionActiva ?? 0), advertencias: resultado.advertencias };
    },

    async restaurar(actor, id, input) {
      exigirEscritura(actor);
      const nota = limpiarNota(input.nota);
      const e = await cargar(actor, id);
      if (e.archivadaAt !== null) throw new CmsError("ARCHIVED", "Este elemento está archivado. Desarchívalo para poder restaurarlo.");
      if (e.versionActiva === input.version) throw new CmsError("INVALID_STATE", "Esa versión ya es la que está publicada.");
      const v = await repo.version(actor.tenantId, id, input.version);
      if (!v) throw new CmsError("NOT_FOUND", "Esa versión no existe.");
      if (checksumDe(v.contenido) !== v.checksum) throw new CmsError("INVALID_STATE", "Esa versión no se puede restaurar porque su contenido no pasó la verificación de integridad.");
      // Se valida con las reglas de HOY (productos que ya no existen, imágenes borradas…). Una oferta vencida sí se puede restaurar: simplemente no valdrá.
      const resultado = validar(e.tipo, v.contenido, await cargarContexto(actor.tenantId, e.tipo, v.contenido));
      const bloqueos = resultado.errores.filter((p) => p.codigo !== "vigencia_vencida");
      if (bloqueos.length > 0) throw new CmsError("NOT_PUBLISHABLE", "Esa versión ya no se puede restaurar porque algo de lo que usaba cambió.", bloqueos);
      const r = await repo.restaurar(actor.tenantId, id, { version: input.version, versionEsperada: e.versionActiva ?? 0, nota, actor });
      const entidad = resolver(r, "restaurar");
      return { entidad: detalle(entidad), version: r.resultado === "ok" && r.version !== undefined ? r.version : (entidad.versionActiva ?? 0) };
    },

    pausar: transicion("pausar"),
    reanudar: transicion("reanudar"),
    despublicar: transicion("despublicar"),
    archivar: transicion("archivar"),
    desarchivar: transicion("desarchivar"),

    async versiones(actor, id) {
      exigirLectura(actor);
      await cargar(actor, id);
      return repo.versiones(actor.tenantId, id, 50);
    },

    async auditoria(actor, filtro) {
      exigirLectura(actor);
      if (filtro?.entidadId) await cargar(actor, filtro.entidadId);
      return repo.auditoria(actor.tenantId, filtro);
    },
  };
}
