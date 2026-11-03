import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// En-têtes de sécurité (équivalent Helmet).
const isDev = process.env.NODE_ENV !== "production";

// 'unsafe-inline' : Next injecte des scripts inline ; un nonce imposerait un rendu dynamique (incompatible avec cacheComponents).
const contentSecurityPolicy = [
  "default-src 'self'",
  // Umami Cloud (mesure d'audience) : script sur cloud.umami.is, événements envoyés à gateway.umami.is.
  `script-src 'self' 'unsafe-inline' https://cloud.umami.is${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // blob: aperçu photo de l'éditeur ; data: icônes de Swagger UI (dev).
  "img-src 'self' data: blob: https://images.unsplash.com https://storage.googleapis.com",
  "font-src 'self'",
  // Carte du voyage (MapLibre) : style, tuiles, polices et icônes d'OpenFreeMap. Son worker est servi par le site ('self').
  `connect-src 'self' https://tiles.openfreemap.org https://gateway.umami.is${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

// CORS limité à l'URL du site (APP_URL, lue au build). Sans APP_URL : aucun appel d'une autre origine.
const appUrl = process.env.APP_URL;
const corsHeaders = appUrl
  ? [
      { key: "Access-Control-Allow-Origin", value: appUrl },
      { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, PATCH, DELETE, OPTIONS" },
      { key: "Access-Control-Allow-Headers", value: "Authorization, Content-Type, If-Match" },
      { key: "Access-Control-Max-Age", value: "600" },
      { key: "Vary", value: "Origin" },
    ]
  : [];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Dev conteneurisé : les notifications de fichiers ne traversent pas le montage → polling.
  ...(process.env.WATCH_POLL_INTERVAL_MS
    ? { watchOptions: { pollIntervalMs: Number(process.env.WATCH_POLL_INTERVAL_MS) } }
    : {}),
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Service worker toujours revérifié : une nouvelle version remplace l'ancienne au prochain chargement.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      ...(corsHeaders.length > 0 ? [{ source: "/api/:path*", headers: corsHeaders }] : []),
    ];
  },
  // Création d'un récit : couverture (5 Mo) + 5 photos du texte (1 Mo) + texte, au-dessus des 10 Mo par défaut.
  experimental: { proxyClientMaxBodySize: "12mb" },
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com", pathname: "/photo-**" },
      { protocol: "https", hostname: "storage.googleapis.com", pathname: "/biirb-post-photos/**" },
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
