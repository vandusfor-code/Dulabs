"use client";

import { useEffect, useRef } from "react";

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

type Nodo = { x: number; y: number; r: number; forma: "punto" | "cuadro"; salida: boolean; brillo: number; fase: number };
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
      if (nodosEnRuta[segmentoActual] !== undefined) paradas.push({ d: acumulado, nodo: nodosEnRuta[segmentoActual] });
    }
  }
  const pts = new Float32Array(salida);
  const path = new Path2D();
  path.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]);
  return { pts, largo: (pts.length / 2 - 1) * PASO, path, paradas };
}

type Region = { x0: number; y0: number; x1: number; y1: number };

function construirCapa(lienzo: HTMLCanvasElement, prof: number, region: Region, compacto: boolean, semilla: number, dpr: number, w: number, h: number, fuente: string): Capa {
  const r = azar(semilla);
  const ancho = region.x1 - region.x0;
  const alto = region.y1 - region.y0;
  // Etapas: entradas -> convergencia -> haz -> trabajadores -> salidas (en mobile, una etapa menos).
  const etapas = compacto
    ? [
        { x: 0, n: 5, y: [0.05, 0.95] },
        { x: 0.36, n: 1, y: [0.45, 0.55] },
        { x: 0.66, n: 2, y: [0.3, 0.7] },
        { x: 1, n: 3, y: [0.12, 0.88] },
      ]
    : [
        { x: 0, n: 9, y: [0.02, 0.98] },
        { x: 0.3, n: 2, y: [0.4, 0.6] },
        { x: 0.5, n: 3, y: [0.32, 0.68] },
        { x: 0.7, n: 3, y: [0.22, 0.78] },
        { x: 1, n: 6, y: [0.06, 0.94] },
      ];

  const nodos: Nodo[] = [];
  const porEtapa: number[][] = etapas.map((e, ei) => {
    const ids: number[] = [];
    for (let i = 0; i < e.n; i++) {
      const f = e.n === 1 ? 0.5 : i / (e.n - 1);
      const jitter = (r() - 0.5) * (alto / Math.max(3, e.n * 3));
      const y = region.y0 + alto * (e.y[0] + (e.y[1] - e.y[0]) * f) + jitter;
      const x = region.x0 + ancho * e.x + (ei === 0 || ei === etapas.length - 1 ? (r() - 0.5) * ancho * 0.04 : 0);
      const intermedia = ei > 0 && ei < etapas.length - 1;
      ids.push(nodos.length);
      nodos.push({ x, y, r: intermedia ? 2.6 : 1.6, forma: intermedia && r() > 0.5 ? "cuadro" : "punto", salida: ei === etapas.length - 1, brillo: 0, fase: r() * Math.PI * 2 });
    }
    return ids;
  });

  // Rutas completas de una entrada a una salida, eligiendo el siguiente nodo con preferencia por el más cercano en altura.
  const siguiente = (desde: number, candidatos: number[]) => {
    const orden = [...candidatos].sort((a, b) => Math.abs(nodos[a].y - nodos[desde].y) - Math.abs(nodos[b].y - nodos[desde].y));
    return orden[Math.min(orden.length - 1, Math.floor(Math.pow(r(), 2.2) * orden.length))];
  };
  const firmas = new Set<string>();
  const rutas: Ruta[] = [];
  const objetivoRutas = compacto ? (prof === 2 ? 10 : 6) : [8, 12, 20][prof];
  for (let intento = 0; intento < objetivoRutas * 6 && rutas.length < objetivoRutas; intento++) {
    const camino = [porEtapa[0][Math.floor(r() * porEtapa[0].length)]];
    for (let e = 1; e < porEtapa.length; e++) camino.push(siguiente(camino[e - 1], porEtapa[e]));
    const firma = camino.join("-");
    if (firmas.has(firma)) continue;
    firmas.add(firma);
    const segmentos = camino.slice(1).map((b, i) => {
      const A = nodos[camino[i]];
      const B = nodos[b];
      const k = (B.x - A.x) * (0.42 + r() * 0.16);
      return [A.x, A.y, A.x + k, A.y, B.x - k, B.y, B.x, B.y] as [number, number, number, number, number, number, number, number];
    });
    rutas.push(construirRuta(segmentos, camino));
  }

  // Capa estática: rejilla de puntos (microestructura), líneas de referencia, conexiones, nodos y marcas mínimas.
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
        const dist = Math.hypot((x - cx) / (ancho * 0.75), (y - cy) / (alto * 0.8));
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
    for (const e of etapas.slice(1, -1)) {
      const x = Math.round(region.x0 + ancho * e.x) + 0.5;
      g.beginPath();
      g.moveTo(x, region.y0 - alto * 0.12);
      g.lineTo(x, region.y1 + alto * 0.12);
      g.stroke();
    }
    g.setLineDash([]);
  }
  g.lineWidth = prof === 2 ? 0.8 : 0.7;
  g.strokeStyle = `rgba(255,255,255,${alfaLinea})`;
  for (const ruta of rutas) g.stroke(ruta.path);
  for (const n of nodos) {
    g.fillStyle = "#070707";
    g.strokeStyle = `rgba(255,255,255,${(alfaLinea * 2.4).toFixed(3)})`;
    g.lineWidth = 0.8;
    g.beginPath();
    if (n.forma === "cuadro") g.rect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
    else g.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  if (prof === 2 && !compacto) {
    // Marcas técnicas mínimas y claramente decorativas.
    g.font = `9px ${fuente}`;
    g.fillStyle = "rgba(255,255,255,0.26)";
    const entrada = nodos[porEtapa[0][0]];
    const salida = nodos[porEtapa[porEtapa.length - 1][porEtapa[porEtapa.length - 1].length - 1]];
    const centro = nodos[porEtapa[2][0]];
    g.fillText("REQUEST", entrada.x - 2, region.y0 - 16);
    g.textAlign = "right";
    g.fillText("WEBHOOK", salida.x + 2, region.y1 + 24);
    g.textAlign = "left";
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.fillText("evt_01HX8Z…", centro.x + 9, centro.y - 9);
    g.fillText(`x ${(etapas[1].x).toFixed(3)}`, region.x0 + ancho * etapas[1].x + 4, region.y0 - alto * 0.12 + 10);
  }

  const respiran = rutas.slice(0, Math.min(rutas.length, compacto ? 3 : 6)).map((_, i) => ({ ruta: i, fase: r() * Math.PI * 2, vel: 0.08 + r() * 0.1 }));
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

export function InfraFlowField({ className = "" }: { className?: string }) {
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
      w = caj.width;
      h = caj.height;
      compacto = w < 640;
      dpr = Math.min(window.devicePixelRatio || 1, compacto ? 1.5 : 1.75);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const base: Region = compacto
        ? { x0: w * 0.06, y0: h * 0.5, x1: w * 1.04, y1: h * 0.94 }
        : { x0: w * 0.12, y0: h * 0.2, x1: w * 0.92, y1: h * 0.8 };
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
      capas = regiones.map((reg, i) => construirCapa(fijos[i]!, compacto ? i * 2 : i, reg, compacto, 1000, dpr, w, h, fuente));
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
        desp[ci * 2] = raton.x * c.paralaje + (animado ? Math.sin(t * 0.045 + ci * 1.7) * (1 + ci) : 0);
        desp[ci * 2 + 1] = raton.y * c.paralaje * 0.6 + (animado ? Math.cos(t * 0.037 + ci) * 0.8 : 0);
      });

      capas.forEach((c, ci) => {
        const ox = desp[ci * 2];
        const oy = desp[ci * 2 + 1];
        fijos[ci]!.style.transform = `translate3d(${ox.toFixed(2)}px, ${oy.toFixed(2)}px, 0)`;
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
          const base = n.salida ? 0 : 0.05 + 0.05 * Math.sin(t * 0.35 + n.fase);
          if (animado) n.brillo *= Math.exp(-dt * 1.5);
          const b = n.brillo;
          if (b > 0.02) {
            const s = 10 + 16 * b;
            ctx.globalAlpha = b * 0.55;
            ctx.drawImage(n.salida ? brilloVerde : brilloAzul, n.x - s, n.y - s, s * 2, s * 2);
            ctx.globalAlpha = 1;
          }
          if (base + b > 0.03) {
            ctx.fillStyle = n.salida && b > 0.02 ? `rgba(${VERDE}, ${(b * 0.8).toFixed(3)})` : `rgba(${AZUL_NUCLEO}, ${((base + b * 0.7)).toFixed(3)})`;
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
          c.nodos[ruta.paradas[p.siguiente].nodo].brillo = 1;
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
          const s = k === 0 ? 2.2 : 1.4;
          ctx.fillRect(x + ox - s / 2, y + oy - s / 2, s, s);
        }
        if (p.d <= ruta.largo) {
          const [x, y] = punto(ruta, p.d);
          ctx.globalAlpha = 0.45 * desvanecer;
          ctx.drawImage(brilloAzul, x + ox - 12, y + oy - 12, 24, 24);
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
  }, []);

  return (
    <div ref={caja} aria-hidden className={`dev-flujo ${className}`}>
      {[0, 1, 2].map((i) => (
        <canvas
          key={i}
          ref={(el) => {
            estaticos.current[i] = el;
          }}
          className="dev-flujo-capa"
        />
      ))}
      <canvas ref={lienzo} className="dev-flujo-canvas font-mono" />
    </div>
  );
}
