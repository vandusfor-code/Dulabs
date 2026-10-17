"use client";

/**
 * Administración de tienda — contexto compartido por el editor: el cliente de la API, el permiso de escritura (solo presentación; el backend vuelve a validar),
 * las categorías y variables del negocio, una caché de productos por referencia y la galería de imágenes.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CmsClient, CmsResult, ContextoTienda, EtapaSubida, EtapaSubidaVideo, ImagenVista, ProductoVista, VideoConfirmado, VideoVista } from "@/lib/cms-comercial-client";
import type { ArchivoVideoId } from "@/lib/cms-comercial/video-requisitos";

export interface TiendaContextValue {
  client: CmsClient;
  canWrite: boolean;
  contexto: ContextoTienda | null;
  errorContexto: string | null;
  /** Vuelve a pedir el contexto de la tienda (las variables y su valor): por ejemplo, tras cambiar el mínimo mayorista. */
  recargarContexto: () => Promise<void>;
  producto: (referencia: string) => ProductoVista | undefined;
  asegurarProductos: (referencias: readonly string[]) => Promise<void>;
  buscarProductos: (consulta: string) => Promise<{ items: ProductoVista[]; error: string | null }>;
  /** Cambia cada vez que llega un producto nuevo (para que los componentes se repinten). */
  versionProductos: number;
  imagenes: ImagenVista[] | null;
  errorImagenes: string | null;
  cargarImagenes: () => Promise<void>;
  /** `ladoMaximo`: reducir la imagen antes de subirla si es más grande (por ejemplo, las de las categorías, que se ven pequeñas). */
  subirImagen: (archivo: File, onEtapa?: (e: EtapaSubida) => void, opciones?: { ladoMaximo?: number }) => Promise<CmsResult<{ imagen: ImagenVista }>>;
  imagenPorId: (id: string) => ImagenVista | undefined;
  /** Los videos que el negocio ya subió (null = todavía no se cargaron). */
  videos: VideoVista[] | null;
  errorVideos: string | null;
  cargarVideos: () => Promise<void>;
  /** Sube un video para un espacio: su imagen fija, el video y la verificación del servidor (ver createCmsClient().subirVideo). */
  subirVideo: (archivo: File, destino: ArchivoVideoId, imagenFija: Blob, onEtapa?: (e: EtapaSubidaVideo) => void) => Promise<CmsResult<VideoConfirmado & { imagen: ImagenVista }>>;
  videoPorId: (id: string) => VideoVista | undefined;
}

const TiendaContext = createContext<TiendaContextValue | null>(null);

export function useTienda(): TiendaContextValue {
  const ctx = useContext(TiendaContext);
  if (!ctx) throw new Error("useTienda debe usarse dentro de <TiendaProvider>.");
  return ctx;
}

const LOTE = 60;

export function TiendaProvider({ client, canWrite, children }: { client: CmsClient; canWrite: boolean; children: ReactNode }) {
  const [contexto, setContexto] = useState<ContextoTienda | null>(null);
  const [errorContexto, setErrorContexto] = useState<string | null>(null);
  const [versionProductos, setVersionProductos] = useState(0);
  const [imagenes, setImagenes] = useState<ImagenVista[] | null>(null);
  const [errorImagenes, setErrorImagenes] = useState<string | null>(null);
  const [videos, setVideos] = useState<VideoVista[] | null>(null);
  const [errorVideos, setErrorVideos] = useState<string | null>(null);
  const cache = useRef(new Map<string, ProductoVista>());
  /** Referencias ya pedidas (existan o no): no se vuelven a pedir. */
  const pedidas = useRef(new Set<string>());
  const cargandoImagenes = useRef(false);
  const cargandoVideos = useRef(false);

  useEffect(() => {
    let vivo = true;
    void client.contexto().then((r) => {
      if (!vivo) return;
      if (r.ok) setContexto(r.data);
      else setErrorContexto(r.error.message);
    });
    return () => {
      vivo = false;
    };
  }, [client]);

  const recargarContexto = useCallback(async () => {
    const r = await client.contexto();
    if (r.ok) {
      setContexto(r.data);
      setErrorContexto(null);
    }
  }, [client]);

  const guardar = useCallback((items: readonly ProductoVista[]) => {
    for (const p of items) cache.current.set(p.referencia, p);
    if (items.length > 0) setVersionProductos((v) => v + 1);
  }, []);

  const asegurarProductos = useCallback(
    async (referencias: readonly string[]) => {
      const faltan = [...new Set(referencias)].filter((r) => r && !cache.current.has(r) && !pedidas.current.has(r));
      for (let i = 0; i < faltan.length; i += LOTE) {
        const lote = faltan.slice(i, i + LOTE);
        for (const r of lote) pedidas.current.add(r);
        const r = await client.productos({ referencias: lote });
        if (r.ok) guardar(r.data.items);
        else for (const ref of lote) pedidas.current.delete(ref); // se podrá reintentar
      }
    },
    [client, guardar],
  );

  const buscarProductos = useCallback(
    async (consulta: string) => {
      const r = await client.productos({ q: consulta });
      if (!r.ok) return { items: [], error: r.error.message };
      guardar(r.data.items);
      return { items: r.data.items, error: null };
    },
    [client, guardar],
  );

  const cargarImagenes = useCallback(async () => {
    if (cargandoImagenes.current) return;
    cargandoImagenes.current = true;
    const r = await client.imagenes();
    cargandoImagenes.current = false;
    if (r.ok) {
      setImagenes(r.data.items);
      setErrorImagenes(null);
    } else setErrorImagenes(r.error.message);
  }, [client]);

  const subirImagen = useCallback(
    async (archivo: File, onEtapa?: (e: EtapaSubida) => void, opciones: { ladoMaximo?: number } = {}) => {
      const r = await client.subirImagen(archivo, { onEtapa, ...(opciones.ladoMaximo === undefined ? {} : { ladoMaximo: opciones.ladoMaximo }) });
      if (r.ok) setImagenes((lista) => [r.data.imagen, ...(lista ?? []).filter((i) => i.id !== r.data.imagen.id)]);
      return r;
    },
    [client],
  );

  const cargarVideos = useCallback(async () => {
    if (cargandoVideos.current) return;
    cargandoVideos.current = true;
    const r = await client.videos();
    cargandoVideos.current = false;
    if (r.ok) {
      setVideos(r.data.items);
      setErrorVideos(null);
    } else setErrorVideos(r.error.message);
  }, [client]);

  const subirVideo = useCallback(
    async (archivo: File, destino: ArchivoVideoId, imagenFija: Blob, onEtapa?: (e: EtapaSubidaVideo) => void) => {
      const r = await client.subirVideo(archivo, destino, imagenFija, { onEtapa });
      if (r.ok) {
        setVideos((lista) => [r.data.video, ...(lista ?? []).filter((v) => v.id !== r.data.video.id)]);
        setImagenes((lista) => [r.data.imagen, ...(lista ?? []).filter((i) => i.id !== r.data.imagen.id)]);
      }
      return r;
    },
    [client],
  );

  const valor = useMemo<TiendaContextValue>(
    () => ({
      client,
      canWrite,
      contexto,
      errorContexto,
      recargarContexto,
      producto: (referencia) => cache.current.get(referencia),
      asegurarProductos,
      buscarProductos,
      versionProductos,
      imagenes,
      errorImagenes,
      cargarImagenes,
      subirImagen,
      imagenPorId: (id) => imagenes?.find((i) => i.id === id),
      videos,
      errorVideos,
      cargarVideos,
      subirVideo,
      videoPorId: (id) => videos?.find((v) => v.id === id),
    }),
    [client, canWrite, contexto, errorContexto, recargarContexto, asegurarProductos, buscarProductos, versionProductos, imagenes, errorImagenes, cargarImagenes, subirImagen, videos, errorVideos, cargarVideos, subirVideo],
  );

  return <TiendaContext.Provider value={valor}>{children}</TiendaContext.Provider>;
}

/** Asegura que los productos de una lista de referencias estén en la caché y devuelve los que ya se conocen (en el mismo orden). */
export function useProductosDe(referencias: readonly string[]): Array<{ referencia: string; producto: ProductoVista | undefined }> {
  const { asegurarProductos, producto, versionProductos } = useTienda();
  const clave = referencias.join(",");
  useEffect(() => {
    void asegurarProductos(clave ? clave.split(",") : []);
  }, [clave, asegurarProductos]);
  // `versionProductos` hace que este cálculo se repita cuando llega un producto nuevo.
  void versionProductos;
  return referencias.map((referencia) => ({ referencia, producto: producto(referencia) }));
}
