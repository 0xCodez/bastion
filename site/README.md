# Bastion website

The launch page for [Bastion](https://github.com/0xCodez/bastion): a static Vite site (vanilla JS,
no framework) deployed to Vercel. It uses the app's "Nebula Voice" design and renders the same 3D
router scene as the desktop app.

## Run locally

```sh
cd site
npm install
npm run dev        # http://localhost:5173
npm run build      # production build into dist/
npm run preview    # serve dist/ at http://localhost:4173
```

Node 20 or newer.

## Layout

```
index.html               head/SEO, nav, <main> with one empty <section> per part, footer
src/main.js              imports fonts + shared CSS, mounts every section in order
src/chrome.js            nav: condense on scroll, mobile menu, active-section highlight
src/styles/fonts.css     self-hosted fonts from npm (@fontsource), bundled by Vite
src/styles/base.css      tokens, reset, type scale, .container, .glass, .btn, .pill, reveal states
src/styles/chrome.css    nav and footer
src/fx/reveal.js         reveal(root): scroll reveals that start from a visible state
src/sections/<id>.js     export function mount(el) { ... }   one file per section
src/sections/<id>.css    that section's styles
src/vendor/hero3d.js     GENERATED copy of renderer/js/hero3d.js (see below)
public/                  favicon, apple-touch-icon, og-image (served as-is)
```

Section ids, in page order: `hero, problem, features, demo, agents, steps, privacy, faq, cta`.
`main.js` finds section modules with `import.meta.glob`, so a section that doesn't exist yet is
skipped instead of breaking the build. A section that throws in `mount()` is logged and skipped.

### Shared building blocks

- Type: `.display-xl`, `.display-l`, `.display-m`, `.display-s`, `.eyebrow`, `.lead`, `.body-m`,
  `.body-s`, `.mono`, `.grad-text`, `.iris-text`.
- Layout: `.container` (1200px max, gutters `max(20px, safe-area)`), `.container--narrow`,
  `.sec-head`, `.sec-head--center`, `.rule`. Every `.sec` gets `padding-block: var(--sec-pad)`
  except `.sec--hero` (0).
- Surfaces and controls: `.glass`, `.glass--blur`, `.btn` + `.btn--primary` / `.btn--ghost` /
  `.btn--sm` / `.btn--lg`, `.pill` + `.pill--ok` / `.pill--warn` / `.pill--risk` / `.pill--mono`.
- The header is `position: fixed`; `--nav-h` holds its height for hero padding.
- Reveals: put `data-reveal` (or `="fade"`, `="scale"`) on elements and call `reveal(sectionEl)`
  from `mount()`. `data-reveal-stagger="0.08"` on a parent staggers its children. Content is never
  hidden: only elements below the fold get a soft offset, and reduced-motion users get none.

## The 3D hero is the app's

`src/vendor/hero3d.js` is copied from `renderer/js/hero3d.js` so the site shows exactly the same
scene as the app. Don't edit the copy. After the app's hero changes:

```sh
npm run sync         # copy it again
npm run sync:check   # fails if the copy is out of date (useful in CI)
```

It imports `three` and `three/addons/...`; the site pins `three@0.187.0` to match the app. Load it
with a dynamic `import()` when the hero is about to be visible, so three.js stays out of the
initial bundle.

## Social image

`public/og-image.svg` is the source; `public/og-image.png` (1200x630) and
`public/apple-touch-icon.png` are rendered from it and `build/icon.svg` with the real fonts using
the Electron the app already depends on. From the repo root:

```sh
npx electron site/scripts/render-og.cjs
```

## Deploy on Vercel

1. Import the GitHub repo in Vercel and set **Root Directory** to `site`.
2. Framework preset: Vite (also pinned in `vercel.json`). Build `npm run build`, output `dist`.
3. Optional: set the `SITE_URL` environment variable (for example `https://bastion.app`) once a
   custom domain is attached. Without it the build uses Vercel's production domain
   (`VERCEL_PROJECT_PRODUCTION_URL`), and locally a `https://bastion.example` placeholder. It is
   written into the canonical link and the Open Graph / Twitter image URLs.

`vercel.json` turns on clean URLs, caches hashed files in `/assets/` for a year, and sends security
headers. The Content-Security-Policy allows only the site's own origin, plus `data:` for images:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self';
frame-ancestors 'none'; upgrade-insecure-requests
```

So: no third-party scripts, fonts, analytics or embeds; fonts must stay bundled files (Vite is set
not to inline them). `'unsafe-inline'` for styles exists only so sections can set inline `style`
attributes and CSS variables. `npm run dev` and `npm run preview` don't send these headers, so
check CSP issues on a Vercel preview deployment.
