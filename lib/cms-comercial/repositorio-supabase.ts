/**
 * CMS comercial — repositorio sobre Supabase. TODO pasa por las funciones SQL `dulabs_cms_*` (ejecutables solo con service_role): cada una recibe el negocio
 * y lo filtra siempre, y cada mutación es atómica con su auditoría. Esta capa solo traduce argumentos y valida con zod lo que devuelven.
 *
 * Si la migración aún no se aplicó (función inexistente), las lecturas del editor responden FEATURE_UNAVAILABLE y la lectura pública (`lecturaActiva`) devuelve
 * null: el CMS no existe y todo sigue como antes, sin romper nada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ACCIONES_AUDITORIA, ESTADOS_ENTIDAD, TIPOS_ENTIDAD, type ActorCms, type AssetCms, type EntidadCms, type RegistroAuditoria, type VersionCms } from "@/lib/cms-comercial/contrato";
import { CmsError } from "@/lib/cms-comercial/errores";
import type { CmsRepositorio, FiltroListado, LecturaActivaCruda, ResultadoAsset, ResultadoCrear, ResultadoMutacion } from "@/lib/cms-comercial/repositorio";

/** Códigos con los que PostgREST/Postgres avisan que la función o la tabla no existe (migración pendiente). */
const ESQUEMA_AUSENTE = new Set(["PGRST202", "PGRST205", "42883", "42P01"]);

const objeto = z.record(z.string(), z.unknown());

const filaEntidad = z.object({
  id: z.string(),
  id_tenant: z.string(),
  tipo: z.enum(TIPOS_ENTIDAD),
  clave: z.string(),
  estado: z.enum(ESTADOS_ENTIDAD),
  rev: z.number().int(),
  version_activa: z.number().int().nullable(),
  borrador: objeto.nullable(),
  contenido_activo: objeto.nullable(),
  archivada_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  published_at: z.string().nullable(),
});

const filaVersion = z.object({
  id: z.string(),
  entidad_id: z.string(),
  version: z.number().int(),
  contenido: objeto,
  checksum: z.string(),
  accion: z.enum(["publicar", "restaurar"]),
  restaurada_de: z.number().int().nullable(),
  nota: z.string().nullable(),
  creado_por: z.string().nullable(),
  creado_por_etiqueta: z.string().nullable(),
  created_at: z.string(),
});

const filaAuditoria = z.object({
  id: z.number(),
  entidad_tipo: z.enum([...TIPOS_ENTIDAD, "imagen"]),
  entidad_id: z.string(),
  accion: z.enum(ACCIONES_AUDITORIA),
  version: z.number().int().nullable(),
  nota: z.string().nullable(),
  antes: z.unknown(),
  despues: z.unknown(),
  actor_user_id: z.string().nullable(),
  actor_etiqueta: z.string().nullable(),
  created_at: z.string(),
});

const filaAsset = z.object({
  id: z.string(),
  id_tenant: z.string(),
  storage_path: z.string(),
  mime_type: z.string(),
  bytes: z.number().int(),
  ancho: z.number().int(),
  alto: z.number().int(),
  estado: z.enum(["pendiente", "listo"]),
  nombre_original: z.string().nullable(),
  created_at: z.string(),
});

const lecturaActiva = z.object({
  habilitado: z.boolean(),
  entidades: z.array(
    z.object({
      id: z.string(),
      tipo: z.string(),
      clave: z.string(),
      estado: z.string(),
      version: z.number().int(),
      checksum: z.string(),
      contenido: z.unknown(),
      publicada_at: z.string(),
      creada_at: z.string(),
    }),
  ),
  assets: z.array(z.object({ id: z.string(), storage_path: z.string(), mime_type: z.string(), ancho: z.number().int(), alto: z.number().int() })),
});

const mapEntidad = (f: z.infer<typeof filaEntidad>): EntidadCms => ({
  id: f.id,
  tenantId: f.id_tenant,
  tipo: f.tipo,
  clave: f.clave,
  estado: f.estado,
  rev: f.rev,
  versionActiva: f.version_activa,
  borrador: f.borrador,
  contenidoActivo: f.contenido_activo,
  archivadaAt: f.archivada_at,
  createdAt: f.created_at,
  updatedAt: f.updated_at,
  publishedAt: f.published_at,
});

const mapVersion = (f: z.infer<typeof filaVersion>): VersionCms => ({
  id: f.id,
  entidadId: f.entidad_id,
  version: f.version,
  contenido: f.contenido,
  checksum: f.checksum,
  accion: f.accion,
  restauradaDe: f.restaurada_de,
  nota: f.nota,
  creadoPor: f.creado_por,
  creadoPorEtiqueta: f.creado_por_etiqueta,
  createdAt: f.created_at,
});

const mapAuditoria = (f: z.infer<typeof filaAuditoria>): RegistroAuditoria => ({
  id: f.id,
  entidadTipo: f.entidad_tipo,
  entidadId: f.entidad_id,
  accion: f.accion,
  version: f.version,
  nota: f.nota,
  antes: f.antes ?? null,
  despues: f.despues ?? null,
  actorUserId: f.actor_user_id,
  actorEtiqueta: f.actor_etiqueta,
  createdAt: f.created_at,
});

const mapAsset = (f: z.infer<typeof filaAsset>): AssetCms => ({
  id: f.id,
  tenantId: f.id_tenant,
  storagePath: f.storage_path,
  mimeType: f.mime_type,
  bytes: f.bytes,
  ancho: f.ancho,
  alto: f.alto,
  estado: f.estado,
  nombreOriginal: f.nombre_original,
  createdAt: f.created_at,
});

function parsear<S extends z.ZodType>(esquema: S, valor: unknown, contexto: string): z.output<S> {
  const r = esquema.safeParse(valor);
  if (!r.success) {
    console.error(`[cms-comercial] respuesta inesperada de ${contexto}:`, r.error.issues[0]?.path.join("."), r.error.issues[0]?.message);
    throw new CmsError("INTERNAL_ERROR", "No se pudo completar la operación de la tienda.");
  }
  return r.data;
}

export function crearRepositorioSupabaseCms(supabase: SupabaseClient): CmsRepositorio {
  async function rpc(nombre: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await supabase.rpc(nombre, args);
    if (error) {
      if (ESQUEMA_AUSENTE.has(error.code ?? "")) throw new CmsError("FEATURE_UNAVAILABLE", "La administración de la tienda aún no está disponible para este negocio.");
      // Solo el código y el mensaje del motor: jamás el contenido de la petición.
      console.error(`[cms-comercial] ${nombre}:`, error.code, error.message);
      throw new CmsError("INTERNAL_ERROR", "No se pudo completar la operación de la tienda.");
    }
    return data;
  }

  const actorArgs = (a: ActorCms) => ({ p_actor: a.userId, p_etiqueta: a.etiqueta });

  function resultadoMutacion(data: unknown, contexto: string): ResultadoMutacion {
    const r = parsear(z.object({ resultado: z.string() }).passthrough(), data, contexto);
    switch (r.resultado) {
      case "ok": {
        const entidad = mapEntidad(parsear(filaEntidad, r.entidad, contexto));
        return typeof r.version === "number" ? { resultado: "ok", entidad, version: r.version } : { resultado: "ok", entidad };
      }
      case "conflicto":
        return { resultado: "conflicto", rev: typeof r.rev === "number" ? r.rev : null, versionActiva: typeof r.version_activa === "number" ? r.version_activa : null };
      case "estado_invalido":
        return { resultado: "estado_invalido", estado: typeof r.estado === "string" ? r.estado : "" };
      case "no_encontrada":
      case "archivada":
      case "sin_cambios":
      case "version_no_encontrada":
      case "invalido":
        return { resultado: r.resultado };
      default:
        console.error(`[cms-comercial] resultado desconocido de ${contexto}:`, r.resultado);
        throw new CmsError("INTERNAL_ERROR", "No se pudo completar la operación de la tienda.");
    }
  }

  function resultadoAsset(data: unknown, contexto: string): ResultadoAsset {
    const r = parsear(z.object({ resultado: z.string() }).passthrough(), data, contexto);
    if (r.resultado === "ok") return { resultado: "ok", asset: mapAsset(parsear(filaAsset, r.asset, contexto)) };
    if (r.resultado === "existente" || r.resultado === "no_encontrada" || r.resultado === "invalido") return { resultado: r.resultado };
    console.error(`[cms-comercial] resultado desconocido de ${contexto}:`, r.resultado);
    throw new CmsError("INTERNAL_ERROR", "No se pudo completar la operación de la tienda.");
  }

  const transicion = (nombre: string) => async (tenantId: string, id: string, actor: ActorCms) => resultadoMutacion(await rpc(nombre, { p_tenant: tenantId, p_id: id, ...actorArgs(actor) }), nombre);

  return {
    async listar(tenantId, filtro: FiltroListado = {}) {
      const data = await rpc("dulabs_cms_listar", { p_tenant: tenantId, p_tipo: filtro.tipo, p_estado: filtro.estado, p_incluir_archivadas: filtro.incluirArchivadas ?? false });
      return parsear(z.array(filaEntidad), data, "dulabs_cms_listar").map(mapEntidad);
    },

    async obtener(tenantId, id) {
      const data = await rpc("dulabs_cms_obtener", { p_tenant: tenantId, p_id: id });
      return data === null ? null : mapEntidad(parsear(filaEntidad, data, "dulabs_cms_obtener"));
    },

    async versiones(tenantId, id, limite) {
      const data = await rpc("dulabs_cms_versiones_listar", { p_tenant: tenantId, p_id: id, p_limite: limite });
      return parsear(z.array(filaVersion), data, "dulabs_cms_versiones_listar").map(mapVersion);
    },

    async version(tenantId, id, version) {
      const data = await rpc("dulabs_cms_version", { p_tenant: tenantId, p_id: id, p_version: version });
      return data === null ? null : mapVersion(parsear(filaVersion, data, "dulabs_cms_version"));
    },

    async auditoria(tenantId, filtro = {}) {
      const data = await rpc("dulabs_cms_auditoria_listar", { p_tenant: tenantId, p_id: filtro.entidadId, p_limite: filtro.limite, p_antes_de: filtro.antesDe });
      return parsear(z.array(filaAuditoria), data, "dulabs_cms_auditoria_listar").map(mapAuditoria);
    },

    async crear(tenantId, input): Promise<ResultadoCrear> {
      const data = await rpc("dulabs_cms_crear", { p_tenant: tenantId, p_tipo: input.tipo, p_clave: input.clave, p_borrador: input.borrador, ...actorArgs(input.actor) });
      if (parsear(z.object({ resultado: z.string() }).passthrough(), data, "dulabs_cms_crear").resultado === "clave_existente") return { resultado: "clave_existente" };
      const r = resultadoMutacion(data, "dulabs_cms_crear");
      if (r.resultado === "ok") return { resultado: "ok", entidad: r.entidad };
      if (r.resultado === "invalido") return { resultado: "invalido" };
      throw new CmsError("INTERNAL_ERROR", "No se pudo completar la operación de la tienda.");
    },

    async guardarBorrador(tenantId, id, input) {
      return resultadoMutacion(await rpc("dulabs_cms_guardar_borrador", { p_tenant: tenantId, p_id: id, p_borrador: input.borrador, p_rev_esperada: input.revEsperada, ...actorArgs(input.actor) }), "dulabs_cms_guardar_borrador");
    },

    async publicar(tenantId, id, input) {
      return resultadoMutacion(
        await rpc("dulabs_cms_publicar", { p_tenant: tenantId, p_id: id, p_rev_esperada: input.revEsperada, p_version_esperada: input.versionEsperada, p_checksum: input.checksum, p_nota: input.nota ?? null, ...actorArgs(input.actor) }),
        "dulabs_cms_publicar",
      );
    },

    async restaurar(tenantId, id, input) {
      return resultadoMutacion(
        await rpc("dulabs_cms_restaurar", { p_tenant: tenantId, p_id: id, p_version: input.version, p_version_esperada: input.versionEsperada, p_nota: input.nota ?? null, ...actorArgs(input.actor) }),
        "dulabs_cms_restaurar",
      );
    },

    pausar: transicion("dulabs_cms_pausar"),
    reanudar: transicion("dulabs_cms_reanudar"),
    despublicar: transicion("dulabs_cms_despublicar"),
    archivar: transicion("dulabs_cms_archivar"),
    desarchivar: transicion("dulabs_cms_desarchivar"),

    async crearAsset(tenantId, input) {
      return resultadoAsset(
        await rpc("dulabs_cms_asset_crear", {
          p_tenant: tenantId,
          p_id: input.id,
          p_storage_path: input.storagePath,
          p_mime: input.mimeType,
          p_bytes: input.bytes,
          p_ancho: input.ancho,
          p_alto: input.alto,
          p_nombre: input.nombreOriginal ?? null,
          p_actor: input.actor.userId,
        }),
        "dulabs_cms_asset_crear",
      );
    },

    async confirmarAsset(tenantId, id, input) {
      return resultadoAsset(await rpc("dulabs_cms_asset_confirmar", { p_tenant: tenantId, p_id: id, p_bytes: input.bytes, p_ancho: input.ancho, p_alto: input.alto, ...actorArgs(input.actor) }), "dulabs_cms_asset_confirmar");
    },

    async obtenerAsset(tenantId, id) {
      const data = await rpc("dulabs_cms_asset_obtener", { p_tenant: tenantId, p_id: id });
      return data === null ? null : mapAsset(parsear(filaAsset, data, "dulabs_cms_asset_obtener"));
    },

    async listarAssets(tenantId, limite) {
      const data = await rpc("dulabs_cms_assets_listar", { p_tenant: tenantId, p_limite: limite });
      return parsear(z.array(filaAsset), data, "dulabs_cms_assets_listar").map(mapAsset);
    },

    async lecturaActiva(tenantId): Promise<LecturaActivaCruda | null> {
      let data: unknown;
      try {
        data = await rpc("dulabs_cms_lectura_activa", { p_tenant: tenantId });
      } catch (err) {
        // Sin la migración el CMS no existe: se lee como «apagado» y el negocio sigue funcionando como antes.
        if (err instanceof CmsError && err.code === "FEATURE_UNAVAILABLE") return null;
        throw err;
      }
      const r = parsear(lecturaActiva, data, "dulabs_cms_lectura_activa");
      if (!r.habilitado) return null;
      return {
        entidades: r.entidades.map((e) => ({ id: e.id, tipo: e.tipo, clave: e.clave, estado: e.estado, version: e.version, checksum: e.checksum, contenido: e.contenido, publicadaAt: e.publicada_at, creadaAt: e.creada_at })),
        assets: r.assets.map((a) => ({ id: a.id, storagePath: a.storage_path, mimeType: a.mime_type, ancho: a.ancho, alto: a.alto })),
      };
    },
  };
}
