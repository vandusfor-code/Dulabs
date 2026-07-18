"use client";

import { useEffect, useRef } from "react";

// Cursor-reactive glow that follows the mouse across the whole landing page
// (fixed to the viewport, not scoped to a single section) — same technique
// as the original Hero-only spotlight (a single rAF-throttled mousemove
// listener, no canvas/particles), just tracking window coordinates instead
// of one section's bounding box so it doesn't fade in/out at every section
// boundary as you scroll and move the cursor.
export function PageSpotlight() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(hover: hover)").matches) return;

    let frame: number | null = null;

    const onMove = (e: MouseEvent) => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const x = (e.clientX / window.innerWidth) * 100;
        const y = (e.clientY / window.innerHeight) * 100;
        el.style.setProperty("--x", `${x}%`);
        el.style.setProperty("--y", `${y}%`);
      });
    };

    const onEnter = () => el.setAttribute("data-active", "true");
    const onLeave = () => el.setAttribute("data-active", "false");

    window.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseenter", onEnter);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseenter", onEnter);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  return <div ref={ref} className="site-spotlight-page" data-active="false" aria-hidden />;
}
