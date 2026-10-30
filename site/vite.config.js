import { defineConfig } from 'vite';

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

export default defineConfig({
  plugins: [siteUrlPlugin()],
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    // Fonts stay as files: the CSP only allows data: for images, not for fonts.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/i.test(file) ? false : undefined),
    // three.js is big on its own; the hero loads it lazily, so this warning is expected.
    chunkSizeWarningLimit: 900,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
