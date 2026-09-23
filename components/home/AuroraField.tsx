"use client";

import { useEffect, useRef } from "react";

// Aurora del hero: UN canvas WebGL (sin librerías) con un fragment shader. Una cinta de seda que se tuerce sobre sí misma: los filamentos
// convergen en el punto de torsión y ahí nace el núcleo luminoso. React nunca re-renderiza durante la animación: uTime se actualiza en
// requestAnimationFrame y todo lo visual vive en el shader. El mismo componente sirve a desktop y mobile; solo cambian los parámetros
// (DPR, número de filamentos, amplitud, puntos). Si WebGL no está disponible queda el fallback CSS (.home-aurora-fallback).

const VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform float uMouseAmt;
uniform float uLines;
uniform float uCompact;
uniform float uDots;
uniform float uCell;
varying vec2 vUv;

const vec3 AZUL_ELECTRICO = vec3(0.192, 0.361, 1.0);
const vec3 AZUL_INTENSO = vec3(0.114, 0.310, 1.0);
const vec3 VIOLETA = vec3(0.396, 0.278, 1.0);
const vec3 AZUL_CLARO = vec3(0.369, 0.549, 1.0);
const vec3 NUCLEO = vec3(0.918, 0.949, 1.0);
const vec3 PUNTO = vec3(0.353, 0.510, 1.0);

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Línea central de la cinta: tres ondas con frecuencias no conmensurables (sin bucle evidente).
float centro(float x, float t) {
  return 0.060 * sin(x * 1.7 + t * 0.21 + 0.6)
       + 0.038 * sin(x * 3.1 - t * 0.29 + 1.9)
       + 0.018 * sin(x * 5.9 + t * 0.43 + 4.1);
}

// Semiancho de la cinta: cruza por cero cerca del centro (la torsión) y ese punto deriva despacio.
float semiancho(float x, float t) {
  float giro = x * 1.55 + 0.32 * sin(t * 0.11) + 0.12 * sin(t * 0.07 + 2.0);
  return (0.165 + 0.03 * sin(x * 2.3 - t * 0.17)) * sin(giro);
}

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);
  float x = (vUv.x - 0.5) * 2.0;
  float t = uTime;

  // En mobile la cinta ocupa más alto relativo (canvas horizontal y bajo).
  float escalaY = mix(1.0, 1.5, uCompact);
  vec2 m = vec2((uMouse.x - 0.5) * aspect, uMouse.y - 0.5);
  float c = centro(x, t) * escalaY + (uMouse.y - 0.5) * 0.02 * uMouseAmt;
  float h = semiancho(x, t) * escalaY;
  float dy = p.y - c;

  vec3 acc = vec3(0.0);

  // Filamentos de la cinta: s en [-1, 1] recorre su ancho; todos convergen donde h -> 0.
  float peso = 11.0 / max(uLines, 1.0);
  for (int i = 0; i < 16; i++) {
    if (float(i) >= uLines) break;
    float s = uLines > 1.0 ? (float(i) / (uLines - 1.0)) * 2.0 - 1.0 : 0.0;
    float ondula = 0.012 * sin(x * 7.0 + t * 0.6 + float(i) * 1.7);
    float d = dy - h * s - ondula;
    float fino = 0.0018 + 0.0014 * (1.0 - abs(s));
    float linea = (exp(-(d * d) / (fino * fino)) * 0.6 + exp(-(d * d) / 0.0011) * 0.15) * peso;
    vec3 tono = s > 0.0 ? mix(AZUL_ELECTRICO, VIOLETA, s) : mix(AZUL_ELECTRICO, AZUL_INTENSO, -s);
    acc += tono * linea;
  }

  // Cuerpo de la cinta (velo entre los bordes) y halo exterior.
  float dentro = 1.0 - smoothstep(0.0, abs(h) + 0.02, abs(dy));
  acc += mix(AZUL_INTENSO, VIOLETA, smoothstep(-0.2, 0.2, dy)) * dentro * 0.34;
  float halo = exp(-(dy * dy) / (0.018 + h * h * 1.6));
  acc += AZUL_ELECTRICO * halo * 0.42;

  // Filamentos superior e inferior independientes (ondas secundarias).
  float fs = p.y - (c + 0.23 * escalaY + 0.05 * sin(x * 2.4 - t * 0.19 + 1.0));
  float fi = p.y - (c - 0.22 * escalaY + 0.045 * sin(x * 2.9 + t * 0.23 + 3.0));
  acc += VIOLETA * exp(-(fs * fs) / 0.000018) * 0.38;
  acc += AZUL_CLARO * exp(-(fi * fi) / 0.000022) * 0.30;
  acc += VIOLETA * exp(-(fs * fs) / 0.0016) * 0.07;

  // Núcleo: donde la cinta se estrecha la energía se concentra y se acerca al blanco azulado.
  float estrecho = 1.0 - smoothstep(0.0, 0.055, abs(h));
  float nucleo = estrecho * exp(-(dy * dy) / 0.0025);
  acc += NUCLEO * nucleo * 1.15;

  // Más energía hacia el centro horizontal; interacción sutil con el cursor.
  float envolvente = 0.35 + 0.65 * exp(-x * x * 1.25);
  acc *= envolvente;
  vec2 dm = p - m;
  acc *= 1.0 + 0.22 * uMouseAmt * exp(-dot(dm, dm) * 7.0);

  vec3 col = vec3(1.0) - exp(-acc * 1.55);

  // Puntos tecnológicos detrás, solo alrededor de la cinta.
  vec2 celda = gl_FragCoord.xy / uCell;
  float punto = 1.0 - smoothstep(0.06, 0.13, length(fract(celda) - 0.5));
  float mascara = exp(-(dy * dy) / 0.09) * (0.4 + 0.6 * exp(-x * x * 1.6));
  col += PUNTO * punto * mascara * uDots;

  // Destellos puntuales dispersos (pocos, con parpadeo lento).
  vec2 g = vec2(vUv.x * 9.0, vUv.y * 5.0);
  vec2 gi = floor(g);
  float r = hash(gi);
  if (r > 0.8) {
    vec2 centroDestello = gi + vec2(hash(gi + 3.1), hash(gi + 7.7));
    vec2 dd = (g - centroDestello) * uResolution / vec2(9.0, 5.0);
    float brillo = exp(-dot(dd, dd) / 3.0) * (0.35 + 0.65 * (0.5 + 0.5 * sin(t * 0.7 + r * 40.0)));
    col += AZUL_CLARO * brillo * 0.9;
  }

  // Desvanecido hacia los cuatro bordes: nunca se ve el rectángulo del canvas.
  float vx = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
  float vy = smoothstep(0.0, 0.24, vUv.y) * smoothstep(1.0, 0.76, vUv.y);
  col *= vx * vy;

  float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

function compilar(gl: WebGLRenderingContext, tipo: number, fuente: string) {
  const shader = gl.createShader(tipo);
  if (!shader) return null;
  gl.shaderSource(shader, fuente);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function AuroraField({ className = "" }: { className?: string }) {
  const envoltorio = useRef<HTMLDivElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const caja = envoltorio.current;
    const canvas = lienzo.current;
    if (!caja || !canvas) return;

    const gl = canvas.getContext("webgl", { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: "low-power" });
    if (!gl) return;

    const vs = compilar(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compilar(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const programa = gl.createProgram();
    if (!vs || !fs || !programa) return;
    gl.attachShader(programa, vs);
    gl.attachShader(programa, fs);
    gl.linkProgram(programa);
    if (!gl.getProgramParameter(programa, gl.LINK_STATUS)) return;
    gl.useProgram(programa);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(programa, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const u = (nombre: string) => gl.getUniformLocation(programa, nombre);
    const uTime = u("uTime");
    const uResolution = u("uResolution");
    const uMouse = u("uMouse");
    const uMouseAmt = u("uMouseAmt");
    const uLines = u("uLines");
    const uCompact = u("uCompact");
    const uDots = u("uDots");
    const uCell = u("uCell");

    const punteroFino = window.matchMedia("(hover: hover) and (pointer: fine)");
    const menosMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)");

    let compacto = false;
    let escala = 1;
    let dpr = 1;

    const medir = () => {
      const { width, height } = caja.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      compacto = window.innerWidth < 768;
      dpr = Math.min(window.devicePixelRatio || 1, compacto ? 1.25 : 1.5) * escala;
      const w = Math.max(1, Math.round(width * dpr));
      const h = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uResolution, w, h);
      gl.uniform1f(uCompact, compacto ? 1 : 0);
      gl.uniform1f(uLines, compacto ? 9 : escala < 1 ? 10 : 15);
      gl.uniform1f(uDots, compacto ? 0.05 : 0.08);
      gl.uniform1f(uCell, (compacto ? 13 : 15) * dpr);
    };

    // Cursor: solo con puntero fino (en touch no hay interacción). Se suaviza dentro del bucle, sin estado de React.
    const raton = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, amt: 0, tamt: 0 };
    const alMover = (e: PointerEvent) => {
      if (!punteroFino.matches) return;
      const r = caja.getBoundingClientRect();
      raton.tx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      raton.ty = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
      raton.tamt = 1;
    };
    const alSalir = () => {
      raton.tamt = 0;
    };

    let t = 8 + Math.random() * 40;
    let ultimo = 0;
    let raf = 0;
    let visible = true;
    let muestras = 0;
    let acumulado = 0;

    const dibujar = () => {
      raton.x += (raton.tx - raton.x) * 0.04;
      raton.y += (raton.ty - raton.y) * 0.04;
      raton.amt += (raton.tamt - raton.amt) * 0.03;
      gl.uniform1f(uTime, t);
      gl.uniform2f(uMouse, raton.x, raton.y);
      gl.uniform1f(uMouseAmt, raton.amt);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const cuadro = (ahora: number) => {
      raf = 0;
      const dt = ultimo ? Math.min(0.05, (ahora - ultimo) / 1000) : 0;
      ultimo = ahora;
      t += dt;
      dibujar();
      // Degradación: si los primeros ~90 cuadros van lentos, se baja la resolución interna una vez.
      if (escala === 1 && dt > 0 && muestras < 90) {
        acumulado += dt;
        muestras += 1;
        if (muestras === 90 && acumulado / muestras > 1 / 40) {
          escala = 0.7;
          medir();
        }
      }
      if (visible && !menosMovimiento.matches && !document.hidden) raf = requestAnimationFrame(cuadro);
    };

    const arrancar = () => {
      if (raf || !visible || document.hidden) return;
      if (menosMovimiento.matches) {
        dibujar();
        return;
      }
      ultimo = 0;
      raf = requestAnimationFrame(cuadro);
    };
    const detener = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    medir();
    dibujar();
    caja.dataset.listo = "1";
    arrancar();

    const observadorTam = new ResizeObserver(() => {
      medir();
      if (!raf) dibujar();
    });
    observadorTam.observe(caja);

    const observadorVista = new IntersectionObserver(([entrada]) => {
      visible = entrada.isIntersecting;
      if (visible) arrancar();
      else detener();
    });
    observadorVista.observe(caja);

    const alCambiarVisibilidad = () => (document.hidden ? detener() : arrancar());
    const alCambiarMovimiento = () => {
      detener();
      arrancar();
    };
    const alPerderContexto = (e: Event) => {
      e.preventDefault();
      detener();
      delete caja.dataset.listo;
    };

    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    menosMovimiento.addEventListener("change", alCambiarMovimiento);
    window.addEventListener("pointermove", alMover, { passive: true });
    document.documentElement.addEventListener("pointerleave", alSalir);
    canvas.addEventListener("webglcontextlost", alPerderContexto);

    return () => {
      detener();
      observadorTam.disconnect();
      observadorVista.disconnect();
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      menosMovimiento.removeEventListener("change", alCambiarMovimiento);
      window.removeEventListener("pointermove", alMover);
      document.documentElement.removeEventListener("pointerleave", alSalir);
      canvas.removeEventListener("webglcontextlost", alPerderContexto);
      delete caja.dataset.listo;
      gl.deleteBuffer(buffer);
      gl.deleteProgram(programa);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  return (
    <div ref={envoltorio} aria-hidden className={`home-aurora ${className}`}>
      <div className="home-aurora-fallback" />
      <canvas ref={lienzo} className="home-aurora-canvas" />
    </div>
  );
}
