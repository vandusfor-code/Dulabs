"use client";

import { useState } from "react";
import { Smile } from "lucide-react";

// Selección curada de emojis reales (sin dependencia externa) -- se
// insertan tal cual en el composer, nunca un placeholder.
const EMOJIS = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😉", "😎", "🥳",
  "👍", "🙏", "👏", "💅", "💇‍♀️", "💄", "✨", "🌸", "💖", "❤️",
  "😢", "😭", "😅", "🤔", "😴", "🎉", "🔥", "💯", "✅", "❌",
];

export function EmojiPicker({ onSeleccionar }: { onSeleccionar: (emoji: string) => void }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-mist hover:bg-ink-2 hover:text-fg"
        aria-label="Emojis"
      >
        <Smile className="size-[18px]" />
      </button>
      {abierto && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setAbierto(false)} />
          <div className="absolute bottom-full left-0 z-40 mb-2 grid w-64 grid-cols-8 gap-1 rounded-xl border border-edge bg-card p-2 shadow-2xl">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  onSeleccionar(e);
                  setAbierto(false);
                }}
                className="flex size-7 items-center justify-center rounded-lg text-lg hover:bg-ink-2"
              >
                {e}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
