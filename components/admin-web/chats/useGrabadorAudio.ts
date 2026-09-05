"use client";

import { useCallback, useRef, useState } from "react";

// Chats AMORE (autorizado) — grabación real con MediaRecorder (nunca se
// envía nada hasta que Jessica presiona "enviar" explícitamente, ver
// composer en ChatWindow.tsx). El formato que produce el navegador
// (audio/webm;codecs=opus, o audio/webm si el navegador no soporta ese
// perfil) se manda TAL CUAL al worker -- no hay ffmpeg disponible para
// reencodear a OGG/Opus real (ver worker/src/whatsapp-qr/socket-baileys.ts,
// enviarAudio). Mismo códec Opus, contenedor distinto: pendiente de
// verificación real en un dispositivo, no se puede probar sin conectar el
// número real de WhatsApp (regla vigente de la sesión).
export function useGrabadorAudio(onGrabado: (audioBase64: string, mimeType: string) => void) {
  const [grabando, setGrabando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const intervaloRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canceladoRef = useRef(false);

  const detenerPistas = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (intervaloRef.current) clearInterval(intervaloRef.current);
    intervaloRef.current = null;
  }, []);

  const iniciar = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      canceladoRef.current = false;
      chunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        detenerPistas();
        if (canceladoRef.current) return;
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binario = "";
        for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i]);
        onGrabado(btoa(binario), mimeType);
      };
      recorder.start();
      setGrabando(true);
      setSegundos(0);
      intervaloRef.current = setInterval(() => setSegundos((s) => s + 1), 1000);
    } catch {
      setError("No se pudo acceder al micrófono");
    }
  }, [onGrabado, detenerPistas]);

  const detener = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setGrabando(false);
  }, []);

  const cancelar = useCallback(() => {
    canceladoRef.current = true;
    mediaRecorderRef.current?.stop();
    setGrabando(false);
  }, []);

  return { grabando, segundos, error, iniciar, detener, cancelar };
}
