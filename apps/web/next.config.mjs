/** @type {import('next').NextConfig} */

/**
 * Cabeceras de seguridad de la web publica.
 *
 * La web solo LEE el estado publico (GitHub) y habla con el backend para comprar.
 * No usa cookies de sesion, asi que lo que hay que blindar es el navegador del
 * visitante: que nadie enmarque la pagina para engañarlo (clickjacking en el
 * boton de comprar), que no se adivinen tipos de contenido y que no se filtren
 * URLs completas al salir hacia Wompi o GitHub.
 *
 * No se pone CSP con `script-src` estricto porque Next inyecta scripts y estilos
 * en linea; una CSP mal puesta rompe la pagina en produccion sin avisar. Se deja
 * `frame-ancestors` (que si es efectivo aqui) via X-Frame-Options + CSP minima.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  // La web no necesita camara, microfono ni ubicacion: se apagan por si acaso.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // HTTPS obligatorio en el navegador durante un año (Vercel ya sirve HTTPS).
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig = {
  reactStrictMode: true,
  // No anunciar la version del framework: es informacion gratis para un atacante.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
