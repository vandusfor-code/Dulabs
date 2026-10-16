"use client";

/**
 * Administración de tienda — las herramientas del NAVEGADOR para revisar un video antes de subirlo (leer el archivo, abrirlo en un <video>, tomarle la imagen fija). Por defecto son las de verdad;
 * las pruebas de los componentes ponen unas falsas con `HerramientasVideoProvider` (en jsdom no hay reproductor de video).
 */
import { createContext, useContext, type ReactNode } from "react";
import { herramientasReales, type HerramientasVideo } from "@/lib/cms-comercial/video-navegador";

const Contexto = createContext<HerramientasVideo>(herramientasReales);

export function HerramientasVideoProvider({ herramientas, children }: { herramientas: HerramientasVideo; children: ReactNode }) {
  return <Contexto.Provider value={herramientas}>{children}</Contexto.Provider>;
}

export const useHerramientasVideo = (): HerramientasVideo => useContext(Contexto);
