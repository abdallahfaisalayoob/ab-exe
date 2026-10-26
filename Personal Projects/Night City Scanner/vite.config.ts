import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Content Security Policy, injected only into production builds (the Vite dev
 * server relies on inline scripts for hot reload). Everything is same-origin:
 * the app makes no third-party network requests. 'wasm-unsafe-eval' is needed
 * to compile the WebAssembly engines (OpenCV, Tesseract, qpdf).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "img-src 'self' blob: data:",
  "media-src 'self' blob: mediastream:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-src 'self' blob:",
  "manifest-src 'self'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'ncs-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<!--CSP-->',
        `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  // Relative base so the build works from any sub-path (GitHub Pages, etc.).
  base: './',
  plugins: [
    react(),
    cspPlugin(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['icons/*.png', 'icons/*.svg', 'splash/*.png'],
      manifest: {
        id: './',
        name: 'Night City Scanner',
        short_name: 'NC Scanner',
        description: 'Private, on-device document scanner. No accounts, no uploads, no watermarks.',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#07080c',
        theme_color: '#07080c',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell, the OpenCV worker and the PDF engines are precached so
        // scanning and PDF export work offline after the first visit.
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,woff2,wasm}'],
        globIgnores: ['vendor/tesseract/**', 'vendor/pdfjs/standard_fonts/**'],
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // OCR engine + language data (~7 MB): cached on first OCR use.
            urlPattern: ({ url }) =>
              url.pathname.includes('/vendor/tesseract/') || url.pathname.includes('/vendor/pdfjs/standard_fonts/'),
            handler: 'CacheFirst',
            options: { cacheName: 'ncs-vendor', expiration: { maxEntries: 60 } },
          },
        ],
      },
    }),
  ],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  worker: { format: 'es' },
  build: {
    target: ['es2022', 'safari16'],
    chunkSizeWarningLimit: 12000,
  },
  server: { port: 5173 },
  // Allow Cloudflare quick-tunnel addresses so the app can be tested on an iPhone over HTTPS.
  preview: { port: 4173, allowedHosts: ['.trycloudflare.com'] },
});
