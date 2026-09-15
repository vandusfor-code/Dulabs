import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Migración de namespace AMORE (autorizado): /admin/amore/* -> /amoreweb/*.
  // Redirect de COMPATIBILIDAD transicional (307, no permanente -- puede
  // retirarse más adelante sin dejar un 308 cacheado agresivamente por
  // navegadores/buscadores). Verificado antes de agregar esto: /admin/*
  // no hospeda ninguna otra funcionalidad de DuLabs Business (esa vive en
  // /dashboard/admin/*, un árbol de rutas completamente distinto) -- así
  // que este redirect no puede chocar con el Admin real de DuLabs.
  async redirects() {
    return [
      {
        source: "/admin/amore/:path*",
        destination: "/amoreweb/:path*",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // 'unsafe-inline' es una concesión deliberada en vez de un CSP
              // basado en nonces (que exigiría enrutar un nonce por request a
              // través de proxy.ts hacia cada script que renderiza Next — más
              // superficie nueva sin probar). El riesgo real de este sitio es
              // carga de scripts desde un dominio atacante, no XSS inline, y
              // eso sigue completamente bloqueado.
              "script-src 'self' 'unsafe-inline' https://connect.facebook.net",
              "style-src 'self' 'unsafe-inline'",
              // https://*.supabase.co (autorizado) -- fotos de productos de
              // AMORE (bucket público inventario-productos, ver
              // lib/amore-inventario.ts::subirFotoProducto): sin este origen
              // el navegador bloquea la imagen aunque su URL pública
              // funcione perfecto por fuera del sitio (hallazgo real:
              // "subí una imagen y no carga"). Mismo dominio ya confiado
              // para connect-src, nunca un origen nuevo/no auditado.
              "img-src 'self' data: https://*.supabase.co",
              "font-src 'self'",
              // connect.facebook.net (Embedded Signup), Supabase (auth), y
              // Wompi (tokenización de tarjeta directo desde el navegador en
              // /checkout — el número de tarjeta nunca toca nuestro servidor).
              "connect-src 'self' https://*.supabase.co https://sandbox.wompi.co https://production.wompi.co",
              "frame-ancestors 'self'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
