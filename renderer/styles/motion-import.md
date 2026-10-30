# Linking motion.css

`renderer/styles/motion.css` (keyframes and `.mo-*` utility classes) is not linked by the shell yet. The integrator adds this one line to the `<head>` of `renderer/index.html`, after the design-token / base stylesheet and before view stylesheets:

```html
<link rel="stylesheet" href="styles/motion.css">
```

It is a local file, so it satisfies the renderer CSP (no remote styles). It works in any order (every color has an Uplink fallback), but loading it after the tokens lets the tokens drive its colors.

JS helpers need no linking; modules import what they use. The path is relative to the importing file, and a wrong one is a 404 that stops the whole module from loading:

```js
// Views in renderer/js/views/ (settings.js, dashboard.js, ...):
import { countUp, stagger, typewriter, flareBurst, sparkline, ring } from '../motion.js';

// Files directly in renderer/js/ (app.js, ...):
import { countUp, stagger, typewriter, flareBurst, sparkline, ring } from './motion.js';
```

Spec for timings, easings, z-index, spacing and type: `docs/UI-NOTES.md`.
