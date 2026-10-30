# Bastion UI notes

Short spec so every view feels like one product. Source look: `docs/design-reference-uplink.html` ("Uplink"). Its `:root` tokens are the design tokens; use them by name, never retype hex values in view CSS. Motion helpers: `renderer/js/motion.js`. Motion classes: `renderer/styles/motion.css`.

## Character

Pure black, crisp white, one electric-blue signal (`--accent #3d8bff`, highlight `--hi #8ec1ff`). Thin 1px rules (`--line`, stronger `--line2`), sharp corners (radius 0) on panels, buttons, inputs and tags. Round only for status dots, pills and switches. Light behaves like sunrise on the horizon: white-hot core, blue falloff, horizontal (anamorphic) streaks. Red (`--danger`) is reserved for real risk, amber (`--warn`) for "needs a look", green (`--ok`) for live / all clear.

## Honesty rules for motion

- Animate only real values. `countUp(el, null)` renders an em dash, `ring(canvas, { value: null })` draws an empty track, `sparkline` leaves gaps for `null`. Never animate toward a placeholder number.
- Progress bars show `SpeedProgress.progress` / `ScanProgress.index / total`. When there is no measurable fraction, use `.mo-progress-indet`, never a fake percentage.
- `.mo-shimmer` marks a slot that is waiting for data. If the data comes back unknown, replace the shimmer with "Unknown" plus guidance, not with a number.
- `flareBurst` and `.mo-pulse-*` acknowledge real events (a check finished, a port was sealed, a risk is open). Do not use them as decoration on idle screens.

## Easing

| Token | Curve | Use |
| --- | --- | --- |
| `--mo-ease-out` / `EASE.out` | `cubic-bezier(.2,.7,.15,1)` | Default. Entrances, reveals, count-ups, flares |
| `--mo-ease-inout` / `EASE.inOut` | `cubic-bezier(.65,0,.2,1)` | Things that travel from A to B: channel marker, dial arcs, sliding thumbs |
| `--mo-ease-std` / `EASE.std` | `cubic-bezier(.4,0,.2,1)` | Small state changes where neither end is special |
| `ease-out` | | Expanding pulses (risk ring) |
| `ease-in-out` | | Breathing loops (ok glow, blink, LEDs) |
| `linear` | | Spinners, shimmer, typewriter |

## Timings

| Token | ms | Use |
| --- | --- | --- |
| `--mo-dur-quick` | 120 | Press feedback, focus ring |
| `--mo-dur-base` | 200 | Hover color / border / background (Uplink `.btn` uses .2s) |
| `--mo-dur-progress` | 350 | Progress bar width steps |
| `--mo-dur-panel` | 520 | Panel / card / list reveals, sparkline draw-in, stagger items |
| (count) | 900 | `countUp` default |
| `--mo-dur-flare` | 900 | `flareBurst`, `.mo-flare` sweep |
| `--mo-dur-reveal` | 1100 | First-load hero reveal (`.mo-reveal`, Uplink `.rise`) |
| `--mo-dur-long` | 1800 | Large travel: channel ring marker, router camera moves |

- Stagger: 50 ms between items, capped at 12 steps (a 40-row list never takes longer than ~1.1 s).
- Loops: risk pulse 1.6 s, warn pulse 2 s, ok breath 2.4 s, blink 2 s, spinner .7 s, shimmer 1.6 s.
- Typewriter: 70 chars/s, but never longer than 4 s in total. AI answers longer than that type faster.
- Nothing the user waits on may be slowed by animation: data renders immediately, motion runs on top.

## Reduced motion

Every helper and class jumps to its end state under `prefers-reduced-motion: reduce`: numbers appear final, lists appear in place, typewriter writes the full text, flares are skipped, pulses become a static glow ring, shimmer becomes a flat panel. Helpers also skip animation while the window is hidden. Three.js scenes should call `setPaused(true)` or render a single still frame.

## Z-index scale

| Layer | z-index | Examples |
| --- | --- | --- |
| Canvas backdrops | -1 | Hero / router 3D canvas behind copy |
| Base content | 0 to 1 | Cards, cells, spec strips |
| In-card effects | 5 | `flareBurst` streak (`.mo-flare-burst`) |
| Sticky bars | 10 | View header, console bar |
| App chrome | 30 | `.titlebar` in app.css, rail, window drag region |
| Popovers, menus, tooltips | 40 | Model picker, row menus |
| Approval sheet / drawer | 50 | "Awaiting your approval" panel when floating |
| Modal + scrim | 60 | Key entry, confirm dialogs |
| Toasts | 100 | `.toasts` stack in app.css: scan finished, key saved |
| Debug / dev overlays | 110 | Dev only |

Chrome (30) and toasts (100) match `renderer/styles/app.css`. Stay inside these bands. The shell should define them as tokens so the spec and the CSS cannot drift: `--z-chrome:30`, `--z-popover:40`, `--z-sheet:50`, `--z-modal:60`, `--z-toast:100`.

## One motion kit

The shell tokens in `tokens.css` are canonical. `motion.css` aliases them where they overlap: `--mo-ease-out` = `--ease-out`, `--mo-ease-inout` = `--ease-io`, `--mo-dur-progress` = `--t-med`, `--mo-dur-flare` = `--t-slow`. `--t-fast` (.18s) is the shell's hover speed; `--mo-dur-base` (200 ms) only exists for the Uplink `.btn` timing.

For classes, a view uses the shell class when one exists and the `.mo-*` class only for effects the shell has no equivalent for. Do not mix both for the same effect on one screen.

| Shell (app.css) | motion.css equivalent | Use |
| --- | --- | --- |
| `.rise` | `.mo-reveal` | Shell `.rise`; `.mo-reveal-stagger` for cascading children |
| `.blink` | `.mo-blink` | Shell `.blink` |
| `.spinner` | `.mo-spin` | Shell `.spinner`; `.mo-spin` only inside a status dot |
| `.skeleton` | `.mo-shimmer` | Shell `.skeleton` |
| `.progress--indeterminate` | `.mo-progress-indet` | Shell class |
| (none) | `.mo-flare`, `.mo-flare-burst`, `.mo-pulse-*`, `.mo-caret`, `.mo-changed` | motion.css |

## Spacing

4 px base. Scale: 4, 8, 12, 14, 18, 24, 28, 36, 40, 56, 80.

- Card padding 24. Console bar padding 14 x 20. List row padding 14 vertical with a 1px top rule.
- Gaps: 8 (chips, buttons in a row), 14 (row internals, CTA group), 18 (card stack), 24 (between cards / columns).
- Page gutter `--gutter` (16 to 48 px). Section spacing 80 to 140 px on marketing-like screens; inside the app use 36 to 56.
- Grids of cells use `gap:1px` on a `--line` background so the rules are the gaps.
- Hit targets at least 40 px tall (`.btn.sm`), 48 px for primary actions.

## Type scale

Display font `--f-disp` (Barlow Semi Condensed) is always uppercase with wide tracking. Body `--f-body` (Barlow). Data `--f-mono` (JetBrains Mono). Numbers use `font-variant-numeric: tabular-nums` (`.tnum`) so count-ups do not jitter.

| Role | Font | Size / line | Weight | Tracking |
| --- | --- | --- | --- | --- |
| View title | disp, upper | clamp(36px, 4vw, 56px) / .95 | 600 | .005em |
| Section title | disp, upper | clamp(28px, 3vw, 40px) / .95 | 600 | .01em |
| Eyebrow | disp, upper | 12 / 1.2, `--muted` | 600 | .32em |
| Card title (h3) | disp, upper | 13 / 1 | 600 | .3em |
| Label / key (`.k`) | disp, upper | 11 / 1, `--muted` | 600 | .26em |
| Meta, legend, tag | disp, upper | 10 to 11 / 1 | 600 to 700 | .2em to .22em |
| Button | disp, upper | 13 / 1 (sm: 11) | 600 | .24em (sm: .2em) |
| Big numeral | body | clamp(52px, 6vw, 92px) / .95 | 200 | -.01em |
| Medium numeral | body | clamp(28px, 3.4vw, 48px) / 1 | 300 | 0 |
| Dial center | body | clamp(40px, 5vw, 60px) / 1 | 200 | 0 |
| Unit under numeral | disp, upper | 12 / 1, `--dim` | 500 | .2em |
| Body | body | 16 / 1.55 | 400 | 0 |
| Row title | body | 15 / 1.25 | 600 | 0 |
| Secondary / fine print | body | 13 / 1.55, `--muted` | 400 | 0 |
| Data (IPs, MACs, ports, evidence) | mono | 12 / 1.5 | 400 | 0 |

Fonts load offline from `../node_modules/@fontsource/<family>/<weight>.css`. No Google Fonts.

## Interaction

- Buttons: outline white, invert on hover (`--mo-dur-base`). Primary is filled white and inverts back. `signal` uses the accent, `danger` the red. Disabled at 45% opacity.
- Focus: `outline: 2px solid var(--accent); outline-offset: 3px` on `:focus-visible` everywhere. Never remove it.
- Scan rows: `pending` at 32% opacity, `checking` shows `.mo-spin` in the dot, results reveal with the row's status color; a risk dot gets `.mo-pulse-risk`; a finished fix gets `flareBurst(row)` and the accent dot.
- Speed test: needle and numerals follow live `SpeedProgress` values directly (no easing lag beyond `--mo-dur-progress`); the final result uses `countUp` and one `flareBurst` on the result card.
- AI answers: `typewriter` into a `.txt` element, abortable with an `AbortController` when the user switches agent or asks again. Approval cards appear with `stagger` and never auto-approve.
- Changed live numbers (devices count, connections) may get `.mo-changed` for a brief blue tint. Remove and re-add the class to retrigger.

## Helper reference (motion.js)

- `countUp(el, to, { duration, decimals, from, prefix, suffix, group, unknown })` -> Promise. Starts from the last value it rendered.
- `stagger(nodes, { delay, duration, distance, start, maxSteps })` -> Promise. Uses the `translate` property, so an element's own `transform` is untouched.
- `typewriter(el, text, { cps, signal, maxMs, caret })` -> Promise<{ completed }>. Uses `textContent`.
- `flareBurst(el, { color, danger })` -> Promise. Appends a `.mo-flare-burst` span to `el` (to the parent for void elements like `canvas`), removes it after 960 ms.
- `sparkline(canvas, values, { color, fill, lineWidth, min, max, dot, animate })` -> `{ update(values, opts), redraw(), dispose() }`.
- `ring(canvas, { value, max, color, track, thickness, glow })` -> `{ set(value, opts), dispose() }`.
- Also: `tween(owner, ms, onFrame, ease)`, `EASE`, `CSS_EASE`, `DURATION`, `cubicBezier`, `resolveColor`, `prefersReducedMotion`.

Colors passed to canvas helpers may be token names (`'--accent'`), `var(--accent)` or any CSS color (rgba and named colors included; an unparseable color falls back to the accent). Call `dispose()` when a view unmounts.

- Canvas size: give every `sparkline` / `ring` canvas an explicit CSS `width` and `height` (for example `width:100%;height:48px`). Without one, its box comes from the width/height attributes, which the helper rewrites at device pixel ratio. As a guard, the first fit locks an unsized axis to its measured CSS px.
- `ring` states: unknown (`null`) draws a dashed, dimmed track; a measured 0 draws the solid track and the bright tip at 12 o'clock.
- `countUp` retargets from the number currently on screen, so a live value that changes mid-count never jumps.

## Accessibility of animated text

`typewriter` and `countUp` set `aria-busy="true"` on the element while they run and remove it when they finish, are aborted or are taken over, so a screen reader reads the final text once instead of every partial frame. Put AI answers in an `aria-live="polite"` container and let the helper manage `aria-busy`; do not set it yourself on the same element. Under reduced motion the full text is written at once.
