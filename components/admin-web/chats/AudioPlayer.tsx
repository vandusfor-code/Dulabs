"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { cn } from "@/components/spa-panel/ui";

function formatearSegundos(s: number): string {
  const min = Math.floor(s / 60);
  const seg = Math.floor(s % 60);
  return `${min}:${seg.toString().padStart(2, "0")}`;
}

// Chats AMORE (autorizado) — reproductor real de la nota de voz recibida o
// enviada. `src` siempre es el proxy autenticado (/api/agenda/[token]/chats/media/[id]),
// nunca la ruta directa del bucket privado. `preload="none"`: nunca se
// descarga el audio automáticamente, solo cuando Jessica presiona play
// (spec: "nunca auto-descargar").
export function AudioPlayer({ src, duracionSeg, variante }: { src: string; duracionSeg: number | null; variante: "entrante" | "saliente" }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [reproduciendo, setReproduciendo] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [duracion, setDuracion] = useState(duracionSeg ?? 0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      if (audio.duration) setProgreso(audio.currentTime / audio.duration);
    };
    const onLoaded = () => {
      if (Number.isFinite(audio.duration)) setDuracion(audio.duration);
    };
    const onEnded = () => {
      setReproduciendo(false);
      setProgreso(0);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  const alternar = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (reproduciendo) {
      audio.pause();
      setReproduciendo(false);
    } else {
      audio.play().catch(() => {});
      setReproduciendo(true);
    }
  };

  const saliente = variante === "saliente";

  return (
    <div className="flex w-56 items-center gap-2.5">
      <audio ref={audioRef} src={src} preload="none" className="hidden" />
      <button
        type="button"
        onClick={alternar}
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          saliente ? "bg-white/25 text-lime-fg" : "bg-lime text-lime-fg"
        )}
      >
        {reproduciendo ? <Pause className="size-4" /> : <Play className="size-4 translate-x-[1px]" />}
      </button>
      <div className="flex-1">
        <div className={cn("h-1.5 w-full overflow-hidden rounded-full", saliente ? "bg-white/25" : "bg-ink-2")}>
          <div className={cn("h-full rounded-full", saliente ? "bg-white" : "bg-lime")} style={{ width: `${progreso * 100}%` }} />
        </div>
      </div>
      <span className={cn("shrink-0 text-[11px] tabular-nums", saliente ? "text-white/80" : "text-mist")}>
        {formatearSegundos(duracion)}
      </span>
    </div>
  );
}
