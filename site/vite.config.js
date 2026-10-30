import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// The public URL is used for canonical and Open Graph tags, which must be absolute.
// Order: SITE_URL (set it in Vercel once a domain is attached) -> Vercel's production
// domain -> a reserved placeholder that is obviously not real.
function siteUrl() {
  const raw =
    process.env.SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
    'https://bastion.example';
  return raw.replace(/\/+$/, '');
}

function siteUrlPlugin() {
  const url = siteUrl();
  return {
    name: 'bastion-site-url',
    transformIndexHtml(html) {
      return html.replaceAll('__SITE_URL__', url);
    },
  };
}

// `npm run dev` only: serve the Vercel functions in api/ (in-memory storage) so /dashboard works
// locally. Set DASHBOARD_PASSWORD in the shell first, or open /dashboard?demo for made-up numbers.
function devApiPlugin() {
  return {
    name: 'bastion-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const m = req.url && req.url.match(/^\/api\/(track|dashboard)(?:[?#]|$)/);
        if (!m) return next();
        try {
          const mod = await server.ssrLoadModule(`/api/${m[1]}.js`);
          await mod.default(req, res);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [siteUrlPlugin(), devApiPlugin()],
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    // Fonts stay as files: the CSP only allows data: for images, not for fonts.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/i.test(file) ? false : undefined),
    // three.js is big on its own; the hero loads it lazily, so this warning is expected.
    chunkSizeWarningLimit: 900,
    // Two pages: the public site and the private analytics dashboard (/dashboard).
    rollupOptions: {
      input: {
        main: here('./index.html'),
        dashboard: here('./dashboard.html'),
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
