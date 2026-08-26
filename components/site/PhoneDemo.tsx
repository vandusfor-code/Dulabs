"use client";

import { useEffect, useRef, useState } from "react";
import { Wifi, Signal, BatteryFull, ChevronLeft, Video, Phone as PhoneIcon, MoreVertical, Mic, Plus, Camera } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/**
 * Hero product surface: la conversación real de WhatsApp, animada, tal como
 * la ve la clienta -- no un dashboard de escritorio. Colores y proporciones
 * calcados de WhatsApp real (encabezado verde oscuro, burbujas blancas/
 * verde claro, doble check) dentro de un marco de teléfono con proporciones
 * reales, para que se lea como "esto es WhatsApp de verdad", no una demo
 * genérica de IA.
 */

type Emisor = "clienta" | "bot";
type Turno = { de: Emisor; es: string; en: string };

const CONVERSACION: Turno[] = [
  { de: "clienta", es: "Hola! ¿Tienen disponibilidad mañana en la tarde?", en: "Hi! Do you have availability tomorrow afternoon?" },
  { de: "bot", es: "¡Hola! Sí, tenemos espacio a las 3:00 p.m. y 4:30 p.m. ¿Cuál prefieres? 😊", en: "Hi! Yes, we have 3:00 pm and 4:30 pm open. Which works for you? 😊" },
  { de: "clienta", es: "A las 3 está perfecto", en: "3 pm works perfectly" },
  { de: "bot", es: "Listo ✅ Quedaste agendada mañana a las 3:00 p.m. Te llega la confirmación por aquí mismo.", en: "Done ✅ You're booked for tomorrow at 3:00 pm. Your confirmation is on its way right here." },
];

const MS_ESCRIBIENDO = 1500;
const MS_PAUSA_LECTURA = 950;
const MS_PAUSA_CICLO = 2800;
const MS_INICIO = 700;

function esperar(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function PhoneDemo() {
  const { lang, t } = useI18n();
  const [visibles, setVisibles] = useState(0);
  const [escribiendo, setEscribiendo] = useState<Emisor | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducido) {
      // Ajuste único al montar para respetar prefers-reduced-motion -- no es
      // una cascada real, solo salta directo al estado final sin animar.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisibles(CONVERSACION.length);
      return;
    }

    let cancelado = false;
    (async () => {
      while (!cancelado) {
        setVisibles(0);
        setEscribiendo(null);
        await esperar(MS_INICIO);
        for (let i = 0; i < CONVERSACION.length; i++) {
          if (cancelado) return;
          setEscribiendo(CONVERSACION[i].de);
          await esperar(MS_ESCRIBIENDO);
          if (cancelado) return;
          setEscribiendo(null);
          setVisibles((v) => v + 1);
          await esperar(MS_PAUSA_LECTURA);
        }
        if (cancelado) return;
        await esperar(MS_PAUSA_CICLO);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [visibles, escribiendo]);

  const nombreNegocio = t("Peluquería Estilo", "Estilo Hair Salon");
  const estadoHeader =
    escribiendo === "bot"
      ? t("escribiendo…", "typing…")
      : t("en línea", "online");

  return (
    <div className="relative mx-auto w-full max-w-[1180px]">
      <div className="relative flex justify-center pb-2 pt-4">
        {/* ---------- Marco del teléfono ---------- */}
        <div className="relative h-[600px] w-[300px] rounded-[46px] bg-gradient-to-b from-[#2b2b2e] to-[#111113] p-[10px] shadow-[0_30px_70px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/10">
          {/* Botones laterales */}
          <span className="absolute -left-[3px] top-[108px] h-7 w-[3px] rounded-l-sm bg-[#3a3a3d]" />
          <span className="absolute -left-[3px] top-[150px] h-11 w-[3px] rounded-l-sm bg-[#3a3a3d]" />
          <span className="absolute -left-[3px] top-[198px] h-11 w-[3px] rounded-l-sm bg-[#3a3a3d]" />
          <span className="absolute -right-[3px] top-[150px] h-16 w-[3px] rounded-r-sm bg-[#3a3a3d]" />

          {/* Pantalla */}
          <div className="relative h-full w-full overflow-hidden rounded-[38px] bg-[#0b141a]">
            {/* Notch / Dynamic Island */}
            <div className="pointer-events-none absolute left-1/2 top-[9px] z-30 h-[22px] w-[92px] -translate-x-1/2 rounded-full bg-black" />

            {/* Barra de estado */}
            <div className="relative z-20 flex items-center justify-between bg-[#075E54] px-5 pb-1 pt-[14px] text-[11px] font-medium text-white">
              <span>9:41</span>
              <div className="flex items-center gap-1">
                <Signal className="h-3 w-3" />
                <Wifi className="h-3 w-3" />
                <BatteryFull className="h-3.5 w-3.5" />
              </div>
            </div>

            {/* Encabezado de WhatsApp */}
            <div className="relative z-20 flex items-center gap-2.5 bg-[#075E54] px-3 pb-2.5 pt-1">
              <ChevronLeft className="h-5 w-5 shrink-0 text-white/90" />
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#d9a15b] text-[11px] font-semibold text-white">
                PE
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium leading-tight text-white">{nombreNegocio}</div>
                <div className="text-[10.5px] leading-tight text-white/70">{estadoHeader}</div>
              </div>
              <div className="flex items-center gap-3.5 text-white/90">
                <Video className="h-4 w-4" />
                <PhoneIcon className="h-3.5 w-3.5" />
                <MoreVertical className="h-4 w-4" />
              </div>
            </div>

            {/* Cuerpo del chat */}
            <div
              ref={scrollRef}
              className="relative flex h-[calc(100%-128px)] flex-col gap-1.5 overflow-hidden px-2.5 pb-2 pt-3"
              style={{
                backgroundColor: "#e5ddd5",
                backgroundImage:
                  "radial-gradient(circle at 15% 20%, rgba(0,0,0,0.035) 0, transparent 40%), radial-gradient(circle at 85% 55%, rgba(0,0,0,0.035) 0, transparent 40%), radial-gradient(circle at 40% 85%, rgba(0,0,0,0.035) 0, transparent 40%)",
              }}
            >
              <div className="mx-auto mb-1.5 rounded-md bg-[#d1e8d3] px-2.5 py-1 text-[10px] font-medium text-[#4a5a4c]">
                {t("HOY", "TODAY")}
              </div>

              {CONVERSACION.slice(0, visibles).map((turno, i) => (
                <Burbuja key={i} de={turno.de} texto={lang === "en" ? turno.en : turno.es} />
              ))}

              {escribiendo && <BurbujaEscribiendo de={escribiendo} />}
            </div>

            {/* Barra de entrada */}
            <div className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 bg-[#f0f0f0] px-2.5 py-2">
              <div className="flex flex-1 items-center gap-2 rounded-full bg-white px-3 py-1.5">
                <Plus className="h-4 w-4 shrink-0 text-[#54656f]" />
                <span className="flex-1 text-[12px] text-[#8696a0]">{t("Mensaje", "Message")}</span>
                <Camera className="h-4 w-4 shrink-0 text-[#54656f]" />
              </div>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#075E54]">
                <Mic className="h-4 w-4 text-white" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Burbuja({ de, texto }: { de: Emisor; texto: string }) {
  const esBot = de === "bot";
  return (
    <div className={`flex ${esBot ? "justify-end" : "justify-start"} animate-site-bubble-in`}>
      <div
        className={`relative max-w-[78%] rounded-lg px-2.5 py-1.5 text-[12.5px] leading-snug shadow-sm ${
          esBot ? "rounded-tr-none bg-[#d9fdd3] text-[#111b21]" : "rounded-tl-none bg-white text-[#111b21]"
        }`}
      >
        {texto}
        <span className={`ml-1.5 inline-flex items-center gap-0.5 align-bottom text-[9.5px] ${esBot ? "text-[#5b8a5f]" : "text-[#667781]"}`}>
          9:41
          {esBot && (
            <svg viewBox="0 0 16 11" className="ml-0.5 h-2.5 w-3.5 fill-[#53bdeb]">
              <path d="M11.071.653a.457.457 0 0 0-.304-.102.483.483 0 0 0-.371.172l-6.24 7.913-2.422-2.06a.463.463 0 0 0-.324-.113.457.457 0 0 0-.335.139l-.335.35a.5.5 0 0 0-.011.68l2.926 3.033a.5.5 0 0 0 .698.02l.324-.302 6.87-8.593a.489.489 0 0 0-.096-.688z" />
              <path d="M15.071.653a.457.457 0 0 0-.304-.102.483.483 0 0 0-.371.172l-6.24 7.913-.822-.72-.633.72 1.14 1.18a.5.5 0 0 0 .698.02l.324-.302 6.87-8.593a.489.489 0 0 0-.096-.688z" />
            </svg>
          )}
        </span>
      </div>
    </div>
  );
}

function BurbujaEscribiendo({ de }: { de: Emisor }) {
  const esBot = de === "bot";
  return (
    <div className={`flex ${esBot ? "justify-end" : "justify-start"} animate-site-bubble-in`}>
      <div className={`flex items-center gap-1 rounded-lg px-3 py-2.5 shadow-sm ${esBot ? "rounded-tr-none bg-[#d9fdd3]" : "rounded-tl-none bg-white"}`}>
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[#8696a0]" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[#8696a0]" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[#8696a0]" />
      </div>
    </div>
  );
}
