/*
  Anamorphic flare: a thin horizontal light streak (white core, faint blue
  chromatic fringes, ends fading out) that follows the pointer across an
  element on hover, and sits at the top edge on keyboard focus. Same optics
  as the section seams in transitions.js.

    import { flare } from '../fx/flare.js';
    const off = flare(el, { color: '#B7A9FF' });   // returns a cleanup function

  Options:
    color   streak colour (any CSS colour). Defaults to the element's
            --flare-color, then lavender.
    y       'pointer' (default) follows the pointer vertically,
            or a number 0..1 to pin the streak at that height.

  The streak is clipped to the element (no horizontal overflow), is
  aria-hidden, ignores touch input, and stays still under
  prefers-reduced-motion (it still appears, without the glide).
*/

const STYLE_ID = 'fx-flare-style';
const CSS = `
.fx-flare{position:absolute;inset:0;border-radius:inherit;overflow:hidden;pointer-events:none;z-index:0;contain:strict}
.fx-flare__s{position:absolute;left:0;top:0;width:180%;height:44px;margin:-22px 0 0 -90%;opacity:0;
  transform:translate3d(var(--fx-x,50%),var(--fx-y,0px),0) scaleX(.6);
  transition:opacity .45s cubic-bezier(.2,.8,.2,1),transform .35s cubic-bezier(.2,.8,.2,1);will-change:transform,opacity}
.fx-flare__s{-webkit-mask-image:linear-gradient(90deg,transparent 8%,#000 38%,#000 62%,transparent 92%);mask-image:linear-gradient(90deg,transparent 8%,#000 38%,#000 62%,transparent 92%)}
.fx-flare__s::before{content:"";position:absolute;left:0;right:0;top:50%;height:1.5px;margin-top:-.75px;
  background:linear-gradient(90deg,transparent,var(--fx-c) 30%,#fff 47%,#fff 53%,var(--fx-c) 70%,transparent);opacity:.95;
  box-shadow:0 -5px 0 -.4px rgba(110,160,255,.22),0 6px 0 -.5px rgba(150,120,255,.16),0 0 8px color-mix(in srgb,var(--fx-c) 70%,transparent)}
.fx-flare__s::after{content:"";position:absolute;left:12%;right:12%;top:50%;height:22px;margin-top:-11px;border-radius:50%;
  background:radial-gradient(closest-side,color-mix(in srgb,var(--fx-c) 55%,transparent),transparent);filter:blur(6px);opacity:.75}
.fx-flare.is-on .fx-flare__s{opacity:1;transform:translate3d(var(--fx-x,50%),var(--fx-y,0px),0) scaleX(1)}
@media (prefers-reduced-motion:reduce){.fx-flare__s{transition:opacity .2s linear}}
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function flare(el, opts = {}) {
  if (!el || typeof window === 'undefined') return () => {};
  injectStyle();

  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';

  const layer = document.createElement('span');
  layer.className = 'fx-flare';
  layer.setAttribute('aria-hidden', 'true');
  const streak = document.createElement('span');
  streak.className = 'fx-flare__s';
  layer.appendChild(streak);
  el.prepend(layer);

  const cssColor = getComputedStyle(el).getPropertyValue('--flare-color').trim();
  layer.style.setProperty('--fx-c', opts.color || cssColor || '#B7A9FF');

  const fEl = opts.focusEl || el;
  const pinY = typeof opts.y === 'number' ? Math.max(0, Math.min(1, opts.y)) : null;
  let raf = 0;
  let px = 0;
  let py = 0;
  let hovering = false;

  function place(x, y) {
    const r = el.getBoundingClientRect();
    const fx = Math.max(0, Math.min(r.width, x));
    const fy = pinY !== null ? pinY * r.height : Math.max(0, Math.min(r.height, y));
    layer.style.setProperty('--fx-x', fx + 'px');
    layer.style.setProperty('--fx-y', fy + 'px');
  }

  function onMove(e) {
    if (e.pointerType === 'touch') return;
    const r = el.getBoundingClientRect();
    px = e.clientX - r.left;
    py = e.clientY - r.top;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; place(px, py); });
  }
  function onEnter(e) {
    if (e.pointerType === 'touch') return;
    hovering = true;
    onMove(e);
    layer.classList.add('is-on');
  }
  function onLeave() {
    hovering = false;
    if (!fEl.matches(':focus-visible')) layer.classList.remove('is-on');
  }
  function onFocus() {
    if (!fEl.matches(':focus-visible')) return;
    const r = el.getBoundingClientRect();
    place(r.width / 2, pinY !== null ? pinY * r.height : 1);
    layer.classList.add('is-on');
  }
  function onBlur() {
    if (!hovering) layer.classList.remove('is-on');
  }

  el.addEventListener('pointerenter', onEnter);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerleave', onLeave);
  fEl.addEventListener('focus', onFocus);
  fEl.addEventListener('blur', onBlur);

  return function off() {
    cancelAnimationFrame(raf);
    el.removeEventListener('pointerenter', onEnter);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerleave', onLeave);
    fEl.removeEventListener('focus', onFocus);
    fEl.removeEventListener('blur', onBlur);
    layer.remove();
  };
}

export default flare;
