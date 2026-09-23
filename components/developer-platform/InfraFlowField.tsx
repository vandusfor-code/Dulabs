"use client";

import { useEffect, useRef, type CSSProperties } from "react";

// Infrastructure flow field del hero de /developer-platform. UN canvas 2D y UN loop de requestAnimationFrame; React nunca re-renderiza.
//
// La topología es una abstracción de request -> gateway -> queue -> worker -> WhatsApp -> webhook, sin nombrarla: muchas entradas que
// convergen en pocos nodos, un haz paralelo, trabajadores y salidas que se abren. Tres capas de profundidad (fondo, medio, frente) con
// distinta opacidad, velocidad y paralaje. Lo estático (líneas, nodos, rejilla de puntos, marcas) se dibuja UNA vez por capa en su propio
// <canvas>; su paralaje y deriva se aplican con transform (lo resuelve el compositor, sin repintar). Solo el canvas dinámico se redibuja en
// cada cuadro: partículas grises, conexiones que respiran, pulsos azules (una request atravesando el sistema) y el brillo de los nodos al
// paso del pulso. Verde solo al llegar a una salida (entregado).
//
// Rendimiento: un solo loop y un solo canvas repintado por cuadro, DPR limitado, partículas según el ancho, rutas remuestreadas a paso
// constante (posición O(1)), sprites de brillo pre-renderizados (sin shadowBlur), pausa fuera de pantalla y con la pestaña oculta,
// intensidad 100 % -> 50 % mientras el hero sale del viewport (opacity del contenedor vía IntersectionObserver con umbrales, sin listener de
// scroll). Con prefers-reduced-motion se dibuja un solo cuadro estático.

type Nodo = { x: number; y: number; r: number; forma: "punto" | "cuadro"; estacion: boolean; salida: boolean; brillo: number; carga: number; fase: number };
type Ruta = { pts: Float32Array; largo: number; path: Path2D; paradas: { d: number; nodo: number }[] };
type Capa = {
  nodos: Nodo[];
  rutas: Ruta[];
  respiran: { ruta: number; fase: number; vel: number }[];
  paralaje: number;
  alfa: number;
  velocidad: number;
};
type Particula = { capa: number; ruta: number; d: number; vel: number; tam: number; alfa: number; espera: number };
type Pulso = { capa: number; ruta: number; d: number; vel: number; siguiente: number };

const PASO = 3;
const AZUL = "94, 140, 255";
const AZUL_NUCLEO = "234, 242, 255";
const VERDE = "168, 255, 62";

function azar(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sprite(color: string, radio: number) {
  const c = document.createElement("canvas");
  c.width = c.height = radio * 2;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(radio, radio, 0, radio, radio, radio);
  gr.addColorStop(0, `rgba(${color}, 0.9)`);
  gr.addColorStop(0.25, `rgba(${color}, 0.35)`);
  gr.addColorStop(1, `rgba(${color}, 0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, radio * 2, radio * 2);
  return c;
}

// Remuestrea una curva (lista de beziers cúbicos) a puntos equidistantes: la posición de una partícula es entonces un índice directo.
function construirRuta(segmentos: [number, number, number, number, number, number, number, number][], nodosEnRuta: number[]): Ruta {
  const denso: number[] = [];
  for (const [x0, y0, c1x, c1y, c2x, c2y, x1, y1] of segmentos) {
    for (let i = denso.length ? 1 : 0; i <= 40; i++) {
      const t = i / 40;
      const u = 1 - t;
      denso.push(u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x1, u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y1);
    }
  }
  const salida: number[] = [denso[0], denso[1]];
  const paradas: { d: number; nodo: number }[] = [];
  let acumulado = 0;
  let objetivo = PASO;
  let segmentoActual = 0;
  for (let i = 2; i < denso.length; i += 2) {
    const dx = denso[i] - denso[i - 2];
    const dy = denso[i + 1] - denso[i - 1];
    const l = Math.hypot(dx, dy);
    while (acumulado + l >= objetivo) {
      const f = (objetivo - acumulado) / l;
      salida.push(denso[i - 2] + dx * f, denso[i - 1] + dy * f);
      objetivo += PASO;
    }
    acumulado += l;
    // Cada 41 muestras termina un segmento: ahí hay un nodo.
    if ((i / 2) % 40 === 0) {
      segmentoActual++;
      const nodo = nodosEnRuta[segmentoActual];
      if (nodo !== undefined && nodo >= 0) paradas.push({ d: acumulado, nodo });
    }
  }
  const pts = new Float32Array(salida);
  const path = new Path2D();
  path.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]);
  return { pts, largo: (pts.length / 2 - 1) * PASO, path, paradas };
}

type Region = { x0: number; y0: number; x1: number; y1: number };

// Topología ordenada (sin cruces): cada ruta conserva su posición de arriba a abajo en todas las etapas. Entradas -> pocas puertas de
// convergencia -> carriles casi paralelos por la zona de procesamiento (con sus estaciones) -> trabajadores -> salidas. Las curvas son
// monótonas (tangentes tipo Fritsch-Carlson, sin sobrepaso): cambian de dirección con suavidad pero nunca ondulan en "S".
// puertaMin: fracción mínima de la región donde puede estar la convergencia (para que el procesamiento quede a la derecha del H1); las etapas
// siguientes se reparten en el espacio restante y la entrada conserva todo su recorrido, largo y suave.
function construirCapa(lienzo: HTMLCanvasElement, prof: number, region: Region, compacto: boolean, semilla: number, dpr: number, w: number, h: number, fuente: string, etiquetas: boolean, puertaMin = 0): Capa {
  const r = azar(semilla);
  const W = region.x1 - region.x0;
  const H = region.y1 - region.y0;
  const X = (f: number) => region.x0 + W * f;
  const Y = (f: number) => region.y0 + H * f;
  const cfg = compacto
    ? { fuentes: 5, puertas: 1, estaciones: 2, workers: 2, salidas: 3, rutas: prof === 2 ? 10 : 6, puerta: 0.24, bus0: 0.37, estacion: 0.5, bus1: 0.62, worker: 0.78, carril: 0.034 }
    : { fuentes: 9, puertas: 2, estaciones: 3, workers: 3, salidas: 6, rutas: [8, 12, 20][prof], puerta: 0.22, bus0: 0.35, estacion: 0.475, bus1: 0.6, worker: 0.77, carril: 0.0135 };
  if (puertaMin > cfg.puerta) {
    const p0 = cfg.puerta;
    const p1 = Math.min(0.6, puertaMin);
    const mover = (f: number) => p1 + ((f - p0) * (1 - p1)) / (1 - p0);
    cfg.bus0 = mover(cfg.bus0);
    cfg.estacion = mover(cfg.estacion);
    cfg.bus1 = mover(cfg.bus1);
    cfg.worker = mover(cfg.worker);
    cfg.puerta = p1;
  }

  const nodos: Nodo[] = [];
  const nodo = (x: number, y: number, tipo: "extremo" | "puerta" | "estacion" | "worker", salida = false) => {
    nodos.push({ x, y, r: tipo === "extremo" ? 1.5 : tipo === "estacion" ? 2.8 : 2.6, forma: tipo === "estacion" ? "cuadro" : "punto", estacion: tipo !== "extremo", salida, brillo: 0, carga: 0, fase: r() * Math.PI * 2 });
    return nodos.length - 1;
  };
  const repartir = (n: number, a: number, b: number) => Array.from({ length: n }, (_, i) => (n === 1 ? (a + b) / 2 : a + ((b - a) * i) / (n - 1)));

  const fuentes = repartir(cfg.fuentes, 0.06, 0.94).map((f) => nodo(X(0) + (r() - 0.5) * W * 0.05, Y(f) + (r() - 0.5) * H * 0.04, "extremo"));
  const puertas = (cfg.puertas === 1 ? [0.5] : [0.41, 0.59]).map((f) => nodo(X(cfg.puerta), Y(f) + (r() - 0.5) * H * 0.015, "puerta"));

  // Carriles de la zona de procesamiento: casi paralelos, con separación levemente irregular y una inclinación mínima (sistema vivo, no rejilla).
  const inclinacion = (r() - 0.5) * H * 0.05;
  const carriles: number[] = [];
  let acumulado = 0;
  for (let k = 0; k < cfg.rutas; k++) {
    carriles.push(acumulado);
    acumulado += H * cfg.carril * (0.8 + r() * 0.4);
  }
  const centroBus = Y(0.5) - acumulado / 2 + (r() - 0.5) * H * 0.02;
  const yCarril = (k: number, fx: number) => centroBus + carriles[k] + inclinacion * (fx - cfg.bus0);

  const estaciones = Array.from({ length: cfg.estaciones }, (_, g) => {
    const desde = Math.floor((g * cfg.rutas) / cfg.estaciones);
    const hasta = Math.floor(((g + 1) * cfg.rutas) / cfg.estaciones) - 1;
    return nodo(X(cfg.estacion), (yCarril(desde, cfg.estacion) + yCarril(hasta, cfg.estacion)) / 2, "estacion");
  });
  const workers = repartir(cfg.workers, cfg.workers === 2 ? 0.3 : 0.25, cfg.workers === 2 ? 0.7 : 0.75).map((f) => nodo(X(cfg.worker), Y(f) + (r() - 0.5) * H * 0.03, "worker"));
  const salidas = repartir(cfg.salidas, 0.08, 0.92).map((f) => nodo(X(1) + (r() - 0.5) * W * 0.04, Y(f) + (r() - 0.5) * H * 0.03, "extremo", true));

  const rutas: Ruta[] = [];
  const en = (k: number, lista: number[]) => lista[Math.min(lista.length - 1, Math.floor((k * lista.length) / cfg.rutas))];
  for (let k = 0; k < cfg.rutas; k++) {
    const ids = [en(k, fuentes), en(k, puertas), -1, en(k, estaciones), -1, en(k, workers), en(k, salidas)];
    const pts: [number, number][] = [
      [nodos[ids[0]].x, nodos[ids[0]].y],
      [nodos[ids[1]].x, nodos[ids[1]].y],
      [X(cfg.bus0), yCarril(k, cfg.bus0)],
      [X(cfg.estacion), yCarril(k, cfg.estacion)],
      [X(cfg.bus1), yCarril(k, cfg.bus1)],
      [nodos[ids[5]].x, nodos[ids[5]].y],
      [nodos[ids[6]].x, nodos[ids[6]].y],
    ];
    // Tangentes monótonas: planas en los extremos y en cualquier punto donde la ruta cambiaría de sentido (así nunca sobrepasa).
    const pend = pts.map((pt, i) => {
      if (i === 0 || i === pts.length - 1) return 0;
      const a = (pt[1] - pts[i - 1][1]) / (pt[0] - pts[i - 1][0]);
      const b = (pts[i + 1][1] - pt[1]) / (pts[i + 1][0] - pt[0]);
      return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
    });
    const tension = 0.42 + r() * 0.06;
    const segmentos = pts.slice(1).map((B, i) => {
      const A = pts[i];
      const kx = (B[0] - A[0]) * tension;
      return [A[0], A[1], A[0] + kx, A[1] + pend[i] * kx, B[0] - kx, B[1] - pend[i + 1] * kx, B[0], B[1]] as [number, number, number, number, number, number, number, number];
    });
    rutas.push(construirRuta(segmentos, ids));
  }

  // Capa estática: rejilla de puntos (microestructura), líneas de referencia por etapa, conexiones, nodos y dos marcas de dirección.
  lienzo.width = Math.round(w * dpr);
  lienzo.height = Math.round(h * dpr);
  const g = lienzo.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const alfaLinea = [0.03, 0.05, 0.095][prof];
  if (prof === 0) {
    const paso = compacto ? 18 : 22;
    const cx = (region.x0 + region.x1) / 2;
    const cy = (region.y0 + region.y1) / 2;
    for (let y = paso / 2; y < h; y += paso) {
      for (let x = paso / 2; x < w; x += paso) {
        const dist = Math.hypot((x - cx) / (W * 0.75), (y - cy) / (H * 0.8));
        const a = 0.085 * Math.max(0, 1 - dist) * (0.6 + r() * 0.4);
        if (a < 0.008) continue;
        g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        g.fillRect(x, y, 1, 1);
      }
    }
  }
  if (prof === 2 && !compacto) {
    g.strokeStyle = "rgba(255,255,255,0.035)";
    g.setLineDash([2, 5]);
    for (const f of [cfg.puerta, cfg.estacion, cfg.worker]) {
      const x = Math.round(X(f)) + 0.5;
      g.beginPath();
      g.moveTo(x, region.y0 - H * 0.12);
      g.lineTo(x, region.y1 + H * 0.12);
      g.stroke();
    }
    g.setLineDash([]);
  }
  g.lineWidth = prof === 2 ? 0.8 : 0.7;
  g.strokeStyle = `rgba(255,255,255,${alfaLinea})`;
  for (const ruta of rutas) g.stroke(ruta.path);
  // Nodos: los extremos casi invisibles; las estaciones intermedias algo más presentes (siempre gris/blanco muy tenue).
  for (const n of nodos) {
    g.fillStyle = "#070707";
    g.strokeStyle = `rgba(255,255,255,${(alfaLinea * (n.estacion ? 3.4 : 2.2)).toFixed(3)})`;
    g.lineWidth = 0.8;
    g.beginPath();
    if (n.forma === "cuadro") g.rect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
    else g.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    if (n.estacion) {
      g.fillStyle = `rgba(255,255,255,${(alfaLinea * 3).toFixed(3)})`;
      g.fillRect(Math.round(n.x) - 0.5, Math.round(n.y) - 0.5, 1, 1);
    }
  }
  if (etiquetas && prof === 2 && !compacto) {
    // Solo la dirección del flujo: de dónde entra y a dónde sale. Nítidas (posición entera) y muy tenues.
    g.font = `9px ${fuente}`;
    g.fillStyle = "rgba(255,255,255,0.22)";
    const primera = nodos[fuentes[0]];
    const ultima = nodos[salidas[salidas.length - 1]];
    g.fillText("REQUEST", Math.round(primera.x), Math.round(region.y0 - H * 0.06));
    g.textAlign = "right";
    g.fillText("WEBHOOK", Math.round(ultima.x), Math.round(region.y1 + H * 0.08));
    g.textAlign = "left";
  }

  const respiran = rutas.slice(0, Math.min(rutas.length, compacto ? 3 : 6)).map((_, i) => ({ ruta: (i * 7) % rutas.length, fase: r() * Math.PI * 2, vel: 0.08 + r() * 0.1 }));
  return {
    nodos,
    rutas,
    respiran,
    // Máximo desplazamiento (px) con el cursor en un borde: ~300 px de movimiento -> ~5 px en la capa cercana.
    paralaje: [4, 8, 15][prof],
    alfa: [0.75, 0.9, 1][prof],
    velocidad: [0.55, 0.8, 1][prof],
  };
}

// libreDe: selector (dentro de la misma sección) del texto que el campo no debe disputar. En desktop, la zona de convergencia y procesamiento
// se ubica siempre a la derecha del final real de ese texto y la máscara atenúa el campo justo detrás de él.
export function InfraFlowField({ className = "", libreDe }: { className?: string; libreDe?: string }) {
  const caja = useRef<HTMLDivElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const estaticos = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => {
    const contenedor = caja.current;
    const canvas = lienzo.current;
    const fijos = estaticos.current;
    if (!contenedor || !canvas || fijos.some((f) => !f)) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const punteroFino = window.matchMedia("(hover: hover) and (pointer: fine)");
    const menosMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)");
    const brilloAzul = sprite(AZUL, 24);
    const brilloVerde = sprite(VERDE, 16);
    const fuente = getComputedStyle(canvas).fontFamily || "monospace";

    let capas: Capa[] = [];
    let particulas: Particula[] = [];
    let pulsos: Pulso[] = [];
    let w = 0;
    let h = 0;
    let dpr = 1;
    let compacto = false;
    let proximoPulso = 1.2;
    const raton = { x: 0, y: 0, tx: 0, ty: 0 };
    let intensidad = 1;
    let intensidadObjetivo = 1;
    let visible = true;
    let raf = 0;
    let ultimo = 0;
    let t = 0;
    const desp = new Float32Array(6);
    const r = azar(20260923);

    const nuevaParticula = (espera: number): Particula => {
      const capa = r() < 0.2 ? 0 : r() < 0.5 ? 1 : Math.min(2, capas.length - 1);
      const c = capas[Math.min(capa, capas.length - 1)];
      const ruta = Math.floor(r() * c.rutas.length);
      return { capa: Math.min(capa, capas.length - 1), ruta, d: 0, vel: (7 + r() * 16) * c.velocidad, tam: capa === 2 ? 1.4 : 1.1, alfa: 0.18 + r() * 0.3, espera };
    };

    const medir = () => {
      const caj = contenedor.getBoundingClientRect();
      if (!caj.width || !caj.height) return false;
      // Freno anti-bucle: el campo nunca puede medir más que el viewport. Si por alguna razón el CSS del contenedor no
      // se aplicara (o llegara tarde), el canvas -dimensionado en px de dispositivo- podría empujar al contenedor a
      // crecer, lo que dispara de nuevo el ResizeObserver: contenedor -> canvas -> contenedor... hasta llenar la página
      // de gris. Acotar la medida al viewport rompe ese bucle de raíz sin afectar el tamaño real en operación normal.
      w = Math.min(caj.width, window.innerWidth);
      h = Math.min(caj.height, Math.round(window.innerHeight * 1.25));
      compacto = w < 640;
      dpr = Math.min(window.devicePixelRatio || 1, compacto ? 1.5 : 1.75);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      // Mobile: el contenedor es una banda bajo el contenido; el sistema ocupa su parte baja.
      const base: Region = compacto
        ? { x0: w * 0.06, y0: h * 0.36, x1: w * 1.04, y1: h * 0.92 }
        : { x0: w * 0.12, y0: h * 0.2, x1: w * 0.92, y1: h * 0.8 };
      // Desktop: el campo nunca disputa el H1. La puerta de convergencia (24 % de la región) queda a la derecha del final real del texto.
      const texto = libreDe && window.innerWidth >= 1024 ? contenedor.closest("section")?.querySelector(libreDe) : null;
      let puertaMin = 0;
      contenedor.style.removeProperty("--hueco-rx");
      if (texto && !compacto) {
        const rango = document.createRange();
        rango.selectNodeContents(texto);
        const t = rango.getBoundingClientRect();
        const fin = t.right - caj.left;
        puertaMin = (fin + 56 - base.x0) / (base.x1 - base.x0);
        if (fin > 0) {
          contenedor.style.setProperty("--hueco-x", `${Math.round(fin - 60)}px`);
          contenedor.style.setProperty("--hueco-y", `${Math.round((t.top + t.bottom) / 2 - caj.top)}px`);
          contenedor.style.setProperty("--hueco-rx", `${Math.round(Math.max(220, t.width * 0.5))}px`);
          contenedor.style.setProperty("--hueco-ry", `${Math.round(t.height * 1.05)}px`);
        }
      }
      // Las capas de fondo son ECOS del mismo sistema (misma topología, escalada y desplazada), no grafos distintos: así se lee como una
      // sola infraestructura con profundidad y no como líneas sueltas.
      const eco = (esc: number, dx: number, dy: number): Region => {
        const cx = (base.x0 + base.x1) / 2 + dx * w;
        const cy = (base.y0 + base.y1) / 2 + dy * h;
        const mx = ((base.x1 - base.x0) / 2) * esc;
        const my = ((base.y1 - base.y0) / 2) * esc;
        return { x0: cx - mx, y0: cy - my, x1: cx + mx, y1: cy + my };
      };
      const regiones: Region[] = compacto ? [eco(1.16, -0.03, -0.03), base] : [eco(1.16, -0.03, -0.025), eco(1.07, -0.012, -0.012), base];
      capas = regiones.map((reg, i) => construirCapa(fijos[i]!, compacto ? i * 2 : i, reg, compacto, 1000, dpr, w, h, fuente, false, puertaMin));
      fijos.forEach((f, i) => {
        f!.style.display = i < capas.length ? "" : "none";
        f!.style.opacity = String(capas[i]?.alfa ?? 1);
      });
      const cantidad = compacto ? 70 : w >= 1100 ? 240 : w >= 760 ? 160 : 110;
      particulas = Array.from({ length: cantidad }, () => {
        const p = nuevaParticula(0);
        p.d = r() * capas[p.capa].rutas[p.ruta].largo;
        return p;
      });
      pulsos = [];
      return true;
    };

    const punto = (ruta: Ruta, d: number) => {
      const i = Math.max(0, Math.min(ruta.pts.length / 2 - 1, Math.round(d / PASO)));
      return [ruta.pts[i * 2], ruta.pts[i * 2 + 1]] as const;
    };

    const dibujar = (dt: number, animado: boolean) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      raton.x += (raton.tx - raton.x) * Math.min(1, dt * 2.2);
      raton.y += (raton.ty - raton.y) * Math.min(1, dt * 2.2);
      const previa = intensidad;
      intensidad += (intensidadObjetivo - intensidad) * Math.min(1, dt * 3);
      if (Math.abs(intensidad - previa) > 0.002 || !animado) contenedor.style.opacity = intensidad.toFixed(3);

      // Desplazamiento por capa (paralaje del cursor + una deriva lenta distinta por capa): se calcula una vez y lo comparten las líneas,
      // los nodos, las partículas y los pulsos de esa capa.
      capas.forEach((c, ci) => {
        // En mobile (sin cursor) la deriva es solo vertical: el campo nunca se desplaza fuera del ancho de la pantalla.
        desp[ci * 2] = raton.x * c.paralaje + (animado && !compacto ? Math.sin(t * 0.045 + ci * 1.7) * (1 + ci) : 0);
        desp[ci * 2 + 1] = raton.y * c.paralaje * 0.6 + (animado ? Math.cos(t * 0.037 + ci) * 0.8 : 0);
      });

      capas.forEach((c, ci) => {
        const ox = desp[ci * 2];
        const oy = desp[ci * 2 + 1];
        // Redondeado a píxel de dispositivo: las líneas finas y las marcas quedan nítidas mientras la capa se desplaza.
        fijos[ci]!.style.transform = `translate3d(${Math.round(ox * dpr) / dpr}px, ${Math.round(oy * dpr) / dpr}px, 0)`;
        ctx.save();
        ctx.translate(ox, oy);
        // Conexiones que aparecen y desaparecen despacio.
        ctx.lineWidth = 0.9;
        for (const b of c.respiran) {
          const a = Math.pow(0.5 + 0.5 * Math.sin(t * b.vel + b.fase), 3) * 0.16;
          if (a < 0.004) continue;
          ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`;
          ctx.stroke(c.rutas[b.ruta].path);
        }
        // Nodos intermedios con intensidad que varía levemente + brillo al paso de un pulso.
        for (const n of c.nodos) {
          const base = n.estacion ? 0.07 + 0.05 * Math.sin(t * 0.35 + n.fase) : 0;
          // Al paso de un pulso: sube con suavidad (sin salto), se expande un poco y vuelve despacio a su estado normal.
          if (animado) {
            n.brillo += (n.carga - n.brillo) * Math.min(1, dt * 7);
            n.carga *= Math.exp(-dt * 1.3);
          }
          const b = n.brillo;
          if (b > 0.02) {
            const s = 6 + 7 * b;
            ctx.globalAlpha = b * 0.3;
            ctx.drawImage(n.salida ? brilloVerde : brilloAzul, n.x - s, n.y - s, s * 2, s * 2);
            ctx.globalAlpha = 1;
            if (n.estacion) {
              const rr = n.r * (1 + 0.4 * b);
              ctx.strokeStyle = `rgba(${AZUL_NUCLEO}, ${(0.12 + 0.45 * b).toFixed(3)})`;
              ctx.lineWidth = 0.8;
              ctx.beginPath();
              if (n.forma === "cuadro") ctx.rect(n.x - rr, n.y - rr, rr * 2, rr * 2);
              else ctx.arc(n.x, n.y, rr, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
          if (base + b > 0.03) {
            ctx.fillStyle = n.salida && b > 0.02 ? `rgba(${VERDE}, ${(b * 0.8).toFixed(3)})` : `rgba(${AZUL_NUCLEO}, ${(base + b * 0.7).toFixed(3)})`;
            ctx.fillRect(n.x - 1, n.y - 1, 2, 2);
          }
        }
        ctx.restore();
      });

      // Partículas: cada una a su ritmo (velocidad, espera y opacidad propias); nunca sincronizadas.
      for (const p of particulas) {
        const c = capas[p.capa];
        const ruta = c.rutas[p.ruta];
        if (animado) {
          if (p.espera > 0) {
            p.espera -= dt;
            continue;
          }
          p.d += p.vel * dt;
          if (p.d >= ruta.largo) {
            Object.assign(p, nuevaParticula(r() * 3));
            continue;
          }
        }
        const [x, y] = punto(ruta, p.d);
        const borde = Math.min(1, p.d / 60, (ruta.largo - p.d) / 60);
        ctx.globalAlpha = p.alfa * borde * c.alfa;
        ctx.fillStyle = "#f5f5f5";
        ctx.fillRect(x + desp[p.capa * 2] - p.tam / 2, y + desp[p.capa * 2 + 1] - p.tam / 2, p.tam, p.tam);
      }
      ctx.globalAlpha = 1;

      if (!animado) return;

      // Pulsos azules: una request que atraviesa el sistema; al pasar por un nodo lo ilumina y al final se desvanece.
      proximoPulso -= dt;
      if (proximoPulso <= 0 && pulsos.length < (compacto ? 2 : 4)) {
        const capa = capas.length - 1 - (r() < 0.3 ? 1 : 0);
        pulsos.push({ capa, ruta: Math.floor(r() * capas[capa].rutas.length), d: 0, vel: 55 + r() * 35, siguiente: 0 });
        proximoPulso = 1.6 + r() * 2.2;
      }
      pulsos = pulsos.filter((p) => {
        const c = capas[p.capa];
        const ruta = c.rutas[p.ruta];
        p.d += p.vel * dt;
        while (p.siguiente < ruta.paradas.length && p.d >= ruta.paradas[p.siguiente].d) {
          c.nodos[ruta.paradas[p.siguiente].nodo].carga = 1;
          p.siguiente++;
        }
        if (p.d > ruta.largo + 40) return false;
        const ox = desp[p.capa * 2];
        const oy = desp[p.capa * 2 + 1];
        const desvanecer = Math.max(0, Math.min(1, (ruta.largo + 40 - p.d) / 80)) * Math.min(1, p.d / 30);
        for (let k = 14; k >= 0; k--) {
          const d = p.d - k * 4;
          if (d < 0 || d > ruta.largo) continue;
          const [x, y] = punto(ruta, d);
          const a = Math.pow(1 - k / 15, 2) * 0.85 * desvanecer;
          ctx.fillStyle = `rgba(${AZUL}, ${a.toFixed(3)})`;
          if (k === 0) continue;
          ctx.fillRect(x + ox - 0.7, y + oy - 0.7, 1.4, 1.4);
        }
        if (p.d <= ruta.largo) {
          const [x, y] = punto(ruta, p.d);
          ctx.globalAlpha = 0.45 * desvanecer;
          ctx.drawImage(brilloAzul, x + ox - 12, y + oy - 12, 24, 24);
          // Cabeza definida: un punto nítido del mismo azul (antes era un cuadrado de 2 px casi perdido en su propio brillo).
          ctx.globalAlpha = desvanecer;
          ctx.fillStyle = `rgb(${AZUL})`;
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, 1.7, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        return true;
      });
    };

    const cuadro = (ahora: number) => {
      raf = 0;
      const dt = ultimo ? Math.min(0.05, (ahora - ultimo) / 1000) : 0.016;
      ultimo = ahora;
      t += dt;
      dibujar(dt, true);
      if (visible && !document.hidden && !menosMovimiento.matches) raf = requestAnimationFrame(cuadro);
    };
    const arrancar = () => {
      if (raf || !visible || document.hidden) return;
      if (menosMovimiento.matches) {
        estatico();
        return;
      }
      ultimo = 0;
      raf = requestAnimationFrame(cuadro);
    };
    const detener = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    // Movimiento reducido: composición fija con una iluminación mínima en dos nodos.
    const estatico = () => {
      raton.x = raton.tx = raton.y = raton.ty = 0;
      intensidad = intensidadObjetivo;
      const frente = capas[capas.length - 1];
      frente.nodos.forEach((n, i) => (n.brillo = i % 7 === 3 ? 0.5 : 0));
      dibujar(0, false);
    };

    const alMover = (e: PointerEvent) => {
      if (!punteroFino.matches || menosMovimiento.matches) return;
      raton.tx = Math.max(-1, Math.min(1, (e.clientX / window.innerWidth - 0.5) * 2));
      raton.ty = Math.max(-1, Math.min(1, (e.clientY / window.innerHeight - 0.5) * 2));
    };

    if (!medir()) return;
    if (menosMovimiento.matches) estatico();
    else arrancar();
    contenedor.dataset.listo = "1";

    const observadorTam = new ResizeObserver(() => {
      if (!medir()) return;
      if (raf) return;
      if (menosMovimiento.matches) estatico();
      else dibujar(0, false);
    });
    observadorTam.observe(contenedor);

    // Visibilidad + intensidad: 100 % con el hero en pantalla, baja hacia 50 % mientras sale y se pausa al salir del todo.
    const umbrales = Array.from({ length: 21 }, (_, i) => i / 20);
    const observadorVista = new IntersectionObserver(
      ([e]) => {
        visible = e.isIntersecting;
        intensidadObjetivo = 0.5 + 0.5 * Math.min(1, e.intersectionRatio / 0.85);
        if (!visible) detener();
        else if (menosMovimiento.matches) estatico();
        else arrancar();
      },
      { threshold: umbrales },
    );
    observadorVista.observe(contenedor);

    const alVisibilidad = () => (document.hidden ? detener() : arrancar());
    const alCambiarMovimiento = () => {
      detener();
      arrancar();
    };
    document.addEventListener("visibilitychange", alVisibilidad);
    menosMovimiento.addEventListener("change", alCambiarMovimiento);
    window.addEventListener("pointermove", alMover, { passive: true });

    return () => {
      detener();
      observadorTam.disconnect();
      observadorVista.disconnect();
      document.removeEventListener("visibilitychange", alVisibilidad);
      menosMovimiento.removeEventListener("change", alCambiarMovimiento);
      window.removeEventListener("pointermove", alMover);
      delete contenedor.dataset.listo;
    };
  }, [libreDe]);

  // Los estilos estructurales críticos van INLINE, no solo en globals.css: garantizan que los canvas siempre estén
  // posicionados en absoluto y ocupen el 100 % del contenedor (nunca su tamaño intrínseco en px de dispositivo). Así, aun
  // si la hoja de estilos no se aplicara en producción, el canvas no puede empujar al contenedor y provocar la pantalla
  // gris. globals.css (.dev-scope .dev-flujo*) sigue aportando la composición visual (máscara, encaje del hero).
  const capaEstilo: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", willChange: "transform" };
  const canvasEstilo: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%" };
  return (
    <div ref={caja} aria-hidden className={`dev-flujo ${className}`} style={{ position: "absolute", pointerEvents: "none", zIndex: 0 }}>
      {[0, 1, 2].map((i) => (
        <canvas
          key={i}
          ref={(el) => {
            estaticos.current[i] = el;
          }}
          className="dev-flujo-capa"
          style={capaEstilo}
        />
      ))}
      <canvas ref={lienzo} className="dev-flujo-canvas font-mono" style={canvasEstilo} />
    </div>
  );
}
