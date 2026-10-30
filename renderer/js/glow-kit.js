// Bastion glow kit: upgrades plain, accessible markup into the Apple-grade control set
// described in docs/CONTRACT.md. Pure DOM, no dependencies. Styles: renderer/styles/glow-kit.css.
//
//   import { initGlowKit } from './glow-kit.js';
//   const cleanup = initGlowKit(document);   // idempotent; safe to call again on any subtree
//
// Markup:
//   <label class="gk-slider" data-unit="%" data-ticks="5"><span>Label</span><input type="range" ...></label>
//   <button class="gk-toggle" role="switch" aria-checked="true">Optional label</button>
//   <div class="gk-ring" data-gk="intelligence" data-gk-speed="fast">...any element...</div>
//   <button class="gk-btn gk-btn--primary">Run scan</button>
//   <div class="gk-segment" role="tablist"><button role="tab" aria-selected="true">A</button>...</div>
//
// Events:
//   gk-toggle  -> bubbling 'change' CustomEvent, detail { checked }. Also exposes el.checked.
//   gk-segment -> bubbling 'change' CustomEvent, detail { index, value, tab }.
//   gk-slider  -> the native 'input' / 'change' events of its <input type="range">.
// Setting input.value / valueAsNumber from code updates the slider visuals.

const KINDS = ['slider', 'toggle', 'ring', 'segment', 'btn'];
const SELECTOR = KINDS.map((kind) => `.gk-${kind}`).join(',');
const UPGRADERS = {
  slider: upgradeSlider,
  toggle: upgradeToggle,
  ring: upgradeRing,
  segment: upgradeSegment,
  btn: upgradeButton,
};

// element -> Map(kind -> teardown). Lets repeated initGlowKit() calls skip work already done.
const upgraded = new WeakMap();

const noop = () => {};

export function initGlowKit(root = document, options = {}) {
  const { observe = true } = options;
  if (!root || typeof root.querySelectorAll !== 'function') return noop;
  const owned = [];

  const scan = (node) => {
    if (!node || typeof node.querySelectorAll !== 'function') return;
    const found = [];
    if (node.nodeType === 1 && node.matches(SELECTOR)) found.push(node);
    for (const el of node.querySelectorAll(SELECTOR)) found.push(el);
    for (const el of found) {
      for (const kind of KINDS) {
        if (el.classList.contains(`gk-${kind}`)) upgradeOne(el, kind, owned);
      }
    }
  };

  scan(root);

  // Controls rendered later inside root are upgraded automatically.
  let observer = null;
  if (observe && typeof MutationObserver === 'function') {
    const pending = new Set();
    let queued = false;
    const flush = () => {
      queued = false;
      const nodes = [...pending];
      pending.clear();
      for (const node of nodes) {
        if (node.isConnected) scan(node);
      }
    };
    observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') {
          const speedUndo = speedUndos.get(record.target);
          if (speedUndo) speedUndos.set(record.target, applySpeed(record.target, speedUndo));
          continue;
        }
        for (const node of record.addedNodes) {
          if (node.nodeType === 1) pending.add(node);
        }
      }
      if (!queued && pending.size) {
        queued = true;
        queueMicrotask(flush);
      }
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-gk-speed'] });
  }

  return function cleanup() {
    if (observer) observer.disconnect();
    observer = null;
    for (const [el, kind] of owned.splice(0)) {
      const kinds = upgraded.get(el);
      const teardown = kinds && kinds.get(kind);
      if (!teardown) continue;
      kinds.delete(kind);
      if (!kinds.size) upgraded.delete(el);
      try {
        teardown();
      } catch (err) {
        console.warn('[glow-kit] teardown failed', err);
      }
    }
  };
}

function upgradeOne(el, kind, owned) {
  let kinds = upgraded.get(el);
  if (kinds && kinds.has(kind)) return;
  let teardown = noop;
  try {
    teardown = UPGRADERS[kind](el) || noop;
  } catch (err) {
    console.warn(`[glow-kit] could not upgrade .gk-${kind}`, err);
    return;
  }
  if (!kinds) {
    kinds = new Map();
    upgraded.set(el, kinds);
  }
  kinds.set(kind, teardown);
  owned.push([el, kind]);
}

// ---------------------------------------------------------------- helpers

function make(doc, tag, className) {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  return el;
}

function num(value, fallback) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

// element -> function that removes the inline --gk-dur this kit set (for live data-gk-speed changes)
const speedUndos = new WeakMap();

// data-gk-speed="slow" | "fast" is pure CSS; a number ("3", "2.5s", "800ms") sets --gk-dur.
function applySpeed(el, previousUndo) {
  if (previousUndo) previousUndo();
  const raw = (el.getAttribute('data-gk-speed') || '').trim();
  const n = parseFloat(raw);
  let undo = noop;
  if (Number.isFinite(n) && n > 0) {
    const unit = /ms$/i.test(raw) ? 'ms' : 's';
    el.style.setProperty('--gk-dur', `${n}${unit}`);
    undo = () => el.style.removeProperty('--gk-dur');
  }
  speedUndos.set(el, undo);
  return undo;
}

function releaseSpeed(el) {
  const undo = speedUndos.get(el);
  if (undo) undo();
  speedUndos.delete(el);
}

// ------------------------------------------------------------------- ring

function upgradeRing(el) {
  const doc = el.ownerDocument;
  const glow = make(doc, 'span', 'gk-ring__glow');
  glow.setAttribute('aria-hidden', 'true');
  el.prepend(glow);
  applySpeed(el);

  // Hug the single wrapped child: adopt its corner radius unless the author set one.
  let adoptedRadius = false;
  const isCircle = el.classList.contains('gk-ring--circle') || el.dataset.gkShape === 'circle';
  const view = doc.defaultView;
  if (!isCircle && view && !view.getComputedStyle(el).getPropertyValue('--gk-radius').trim()) {
    const kids = [...el.children].filter((child) => child !== glow);
    if (kids.length === 1) {
      const radius = view.getComputedStyle(kids[0]).borderTopLeftRadius.split(' ')[0];
      if (radius) {
        el.style.setProperty('--gk-radius', radius);
        adoptedRadius = true;
      }
    }
  }

  return () => {
    glow.remove();
    releaseSpeed(el);
    if (adoptedRadius) el.style.removeProperty('--gk-radius');
  };
}

// ----------------------------------------------------------------- button

function upgradeButton(el) {
  // Everything visual is CSS; only numeric speeds need a custom property.
  applySpeed(el);
  return () => releaseSpeed(el);
}

// ----------------------------------------------------------------- toggle

function upgradeToggle(el) {
  const doc = el.ownerDocument;
  const addedAttrs = [];
  const isButton = el.tagName === 'BUTTON';
  if (!el.hasAttribute('role')) {
    el.setAttribute('role', 'switch');
    addedAttrs.push('role');
  }
  if (!el.hasAttribute('aria-checked')) el.setAttribute('aria-checked', 'false');
  if (isButton && !el.hasAttribute('type')) {
    el.setAttribute('type', 'button');
    addedAttrs.push('type');
  }
  if (!isButton && !el.hasAttribute('tabindex')) {
    el.setAttribute('tabindex', '0');
    addedAttrs.push('tabindex');
  }
  applySpeed(el);

  // Existing content becomes the visible label next to the switch.
  let label = null;
  const hasContent = [...el.childNodes].some((n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()));
  if (hasContent) {
    label = make(doc, 'span', 'gk-toggle__label');
    label.append(...el.childNodes);
    el.append(label);
  }

  const track = make(doc, 'span', 'gk-toggle__track');
  track.setAttribute('aria-hidden', 'true');
  track.append(make(doc, 'span', 'gk-toggle__knob'));
  el.append(track);

  const isDisabled = () => el.disabled === true || el.getAttribute('aria-disabled') === 'true';
  const flip = () => {
    if (isDisabled()) return;
    const next = el.getAttribute('aria-checked') !== 'true';
    el.setAttribute('aria-checked', String(next));
    el.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { checked: next } }));
  };
  const onClick = () => flip();
  const onKey = (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      flip();
    }
  };
  el.addEventListener('click', onClick);
  if (!isButton) el.addEventListener('keydown', onKey);

  Object.defineProperty(el, 'checked', {
    configurable: true,
    get() {
      return el.getAttribute('aria-checked') === 'true';
    },
    set(value) {
      el.setAttribute('aria-checked', String(Boolean(value)));
    },
  });

  return () => {
    el.removeEventListener('click', onClick);
    el.removeEventListener('keydown', onKey);
    delete el.checked;
    track.remove();
    if (label) {
      label.replaceWith(...label.childNodes);
    }
    for (const name of addedAttrs) el.removeAttribute(name);
    releaseSpeed(el);
  };
}

// ----------------------------------------------------------------- slider

let sliderLabelSeq = 0;

function upgradeSlider(el) {
  const input = el.querySelector('input[type="range"]');
  if (!input) return null;
  const doc = el.ownerDocument;
  const view = doc.defaultView || window;

  const labelSpan = [...el.children].find((child) => child.tagName === 'SPAN' && !/\bgk-slider__/.test(child.className));
  const labelHadClass = labelSpan ? labelSpan.classList.contains('gk-slider__label') : false;
  if (labelSpan) labelSpan.classList.add('gk-slider__label');

  // A span, not an <output>: <output> is labelable and would steal the wrapping <label> from the input.
  const out = make(doc, 'span', 'gk-slider__value');
  out.setAttribute('aria-hidden', 'true');
  const track = make(doc, 'span', 'gk-slider__track');
  const groove = make(doc, 'span', 'gk-slider__groove');
  const fill = make(doc, 'span', 'gk-slider__fill');
  const ticksBox = make(doc, 'span', 'gk-slider__ticks');
  const thumb = make(doc, 'span', 'gk-slider__thumb');
  const flare = make(doc, 'span', 'gk-slider__flare');
  const bubble = make(doc, 'span', 'gk-slider__bubble');
  for (const node of [groove, ticksBox, thumb, bubble]) node.setAttribute('aria-hidden', 'true');
  groove.append(fill);
  thumb.append(flare);

  const placeholder = doc.createComment('gk-slider input');
  input.before(placeholder);
  track.append(groove, thumb, bubble, input);
  el.append(out, track);

  // Fallback accessible name when the input has none of its own besides the wrapping label.
  let addedLabelId = false;
  let addedLabelledBy = false;
  if (labelSpan && !input.id && !input.hasAttribute('aria-labelledby') && !input.hasAttribute('aria-label')) {
    if (!labelSpan.id) {
      labelSpan.id = `gk-slider-label-${++sliderLabelSeq}`;
      addedLabelId = true;
    }
    input.setAttribute('aria-labelledby', labelSpan.id);
    addedLabelledBy = true;
  }

  // aria-valuetext the kit wrote last; any other value belongs to the app and is shown, never removed.
  let kitValueText = null;
  const nativeValue = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value');
  const nativeNumber = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'valueAsNumber');
  const readValue = () => nativeValue.get.call(input);
  const bounds = () => {
    const min = num(input.min, 0);
    const max = num(input.max, 100);
    return { min, max: max < min ? min : max };
  };
  const decimals = () => {
    if (el.dataset.decimals != null) return Math.max(0, Math.min(6, parseInt(el.dataset.decimals, 10) || 0));
    const match = /\.(\d+)/.exec(input.step || '');
    return match ? Math.min(6, match[1].length) : 0;
  };
  const format = (v) => `${v.toFixed(decimals())}${el.dataset.unit || ''}`;

  let tickEls = [];
  const buildTicks = () => {
    ticksBox.textContent = '';
    tickEls = [];
    el.classList.remove('gk-slider--ticks', 'gk-slider--tick-labels');
    const spec = el.getAttribute('data-ticks');
    if (spec == null || spec === 'false') {
      ticksBox.remove();
      return;
    }
    const { min, max } = bounds();
    let count = parseInt(spec, 10);
    if (!(count >= 2)) {
      const step = parseFloat(input.step);
      count = step > 0 && max > min ? Math.floor((max - min) / step + 1e-6) + 1 : 11;
      if (count > 51 || count < 2) count = 11;
    }
    count = Math.min(count, 101);
    const labels = (el.getAttribute('data-tick-labels') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const withLabels = labels.length === count;
    if (labels.length && !withLabels) console.warn(`glow-kit: ${labels.length} tick labels for ${count} ticks; labels hidden`, el);
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const tick = make(doc, 'i', 'gk-slider__tick');
      tick.style.setProperty('--t', String(t));
      tick.dataset.t = String(t);
      if (withLabels) {
        const text = make(doc, 'span', 'gk-slider__tick-label');
        text.textContent = labels[i];
        tick.append(text);
      }
      ticksBox.append(tick);
      tickEls.push(tick);
    }
    el.classList.add('gk-slider--ticks');
    if (withLabels) el.classList.add('gk-slider--tick-labels');
    if (!ticksBox.isConnected) track.insertBefore(ticksBox, thumb);
  };

  const update = () => {
    const { min, max } = bounds();
    const v = num(readValue(), min);
    const p = max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0;
    el.style.setProperty('--gk-p', p.toFixed(4));
    const current = input.getAttribute('aria-valuetext');
    const appText = current != null && current !== kitValueText ? current : null;
    const text = appText != null && el.dataset.gkValuetext !== 'off' ? appText : format(v);
    out.textContent = text;
    bubble.textContent = text;
    if (appText == null) {
      if (el.dataset.unit) {
        kitValueText = text;
        if (current !== text) input.setAttribute('aria-valuetext', text);
      } else {
        if (current != null) input.removeAttribute('aria-valuetext');
        kitValueText = null;
      }
    } else {
      kitValueText = null;
    }
    el.classList.toggle('is-disabled', input.disabled);
    for (const tick of tickEls) tick.classList.toggle('is-on', Number(tick.dataset.t) <= p + 1e-6);
  };

  // Programmatic value changes do not fire events; intercept them on this instance only.
  Object.defineProperty(input, 'value', {
    configurable: true,
    enumerable: true,
    get() {
      return nativeValue.get.call(this);
    },
    set(v) {
      nativeValue.set.call(this, v);
      update();
    },
  });
  Object.defineProperty(input, 'valueAsNumber', {
    configurable: true,
    enumerable: true,
    get() {
      return nativeNumber.get.call(this);
    },
    set(v) {
      nativeNumber.set.call(this, v);
      update();
    },
  });

  const endDrag = () => {
    el.classList.remove('is-active');
    view.removeEventListener('pointerup', endDrag);
    view.removeEventListener('pointercancel', endDrag);
  };
  const onDown = () => {
    if (input.disabled) return;
    el.classList.add('is-active');
    view.addEventListener('pointerup', endDrag);
    view.addEventListener('pointercancel', endDrag);
  };
  const form = input.form;
  const onReset = () => view.requestAnimationFrame(update);
  input.addEventListener('pointerdown', onDown);
  input.addEventListener('input', update);
  input.addEventListener('change', update);
  if (form) form.addEventListener('reset', onReset);

  const watcher = new MutationObserver((records) => {
    if (records.some((r) => !['value', 'disabled', 'aria-valuetext'].includes(r.attributeName))) buildTicks();
    update();
  });
  watcher.observe(input, { attributes: true, attributeFilter: ['min', 'max', 'step', 'value', 'disabled', 'aria-valuetext'] });
  watcher.observe(el, { attributes: true, attributeFilter: ['data-ticks', 'data-tick-labels', 'data-unit', 'data-decimals', 'data-gk-valuetext'] });

  buildTicks();
  update();

  return () => {
    watcher.disconnect();
    endDrag();
    input.removeEventListener('pointerdown', onDown);
    input.removeEventListener('input', update);
    input.removeEventListener('change', update);
    if (form) form.removeEventListener('reset', onReset);
    delete input.value;
    delete input.valueAsNumber;
    if (kitValueText != null && input.getAttribute('aria-valuetext') === kitValueText) input.removeAttribute('aria-valuetext');
    if (addedLabelledBy) input.removeAttribute('aria-labelledby');
    if (addedLabelId) labelSpan.removeAttribute('id');
    if (placeholder.isConnected) placeholder.replaceWith(input);
    else el.append(input);
    track.remove();
    out.remove();
    if (labelSpan && !labelHadClass) labelSpan.classList.remove('gk-slider__label');
    el.classList.remove('is-active', 'is-disabled', 'gk-slider--ticks', 'gk-slider--tick-labels');
    el.style.removeProperty('--gk-p');
  };
}

// ---------------------------------------------------------------- segment

function upgradeSegment(el) {
  const doc = el.ownerDocument;
  const view = doc.defaultView || window;
  const addedRole = !el.hasAttribute('role');
  if (addedRole) el.setAttribute('role', 'tablist');

  const thumb = make(doc, 'span', 'gk-segment__thumb');
  thumb.setAttribute('aria-hidden', 'true');
  el.prepend(thumb);

  const roleAdded = new Set();
  const savedTabIndex = new Map();
  const tabs = () => {
    const list = [];
    for (const child of el.children) {
      if (child === thumb) continue;
      if (child.getAttribute('role') === 'tab') list.push(child);
      else if (child.tagName === 'BUTTON' && !child.hasAttribute('role')) {
        child.setAttribute('role', 'tab');
        roleAdded.add(child);
        list.push(child);
      }
    }
    for (const tab of list) {
      if (!savedTabIndex.has(tab)) savedTabIndex.set(tab, tab.getAttribute('tabindex'));
      if (tab.tagName === 'BUTTON' && !tab.hasAttribute('type')) tab.setAttribute('type', 'button');
    }
    return list;
  };
  const enabled = (tab) => !tab.disabled && tab.getAttribute('aria-disabled') !== 'true';
  const selectedIndex = (list) => list.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');

  const place = () => {
    const list = tabs();
    const tab = list[selectedIndex(list)];
    if (!tab) {
      thumb.style.opacity = '0';
      return;
    }
    thumb.style.opacity = '';
    el.style.setProperty('--gk-seg-x', `${tab.offsetLeft}px`);
    el.style.setProperty('--gk-seg-y', `${tab.offsetTop}px`);
    el.style.setProperty('--gk-seg-w', `${tab.offsetWidth}px`);
    el.style.setProperty('--gk-seg-h', `${tab.offsetHeight}px`);
  };

  const select = (index, { focus = false, emit = true } = {}) => {
    const list = tabs();
    const tab = list[index];
    if (!tab || !enabled(tab)) return;
    const previous = selectedIndex(list);
    list.forEach((item, i) => {
      const on = i === index;
      item.setAttribute('aria-selected', String(on));
      item.tabIndex = on ? 0 : -1;
      const panelId = item.getAttribute('aria-controls');
      const panel = panelId ? doc.getElementById(panelId) : null;
      if (panel) panel.hidden = !on;
    });
    place();
    if (focus) tab.focus();
    if (emit && previous !== index) {
      const value = tab.dataset.value != null ? tab.dataset.value : tab.textContent.trim();
      el.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { index, value, tab } }));
    }
  };

  const onClick = (e) => {
    const tab = e.target.closest('[role="tab"]');
    if (!tab || tab.parentElement !== el) return;
    select(tabs().indexOf(tab));
  };

  const onKey = (e) => {
    const list = tabs();
    const from = list.indexOf(e.target.closest ? e.target.closest('[role="tab"]') : null);
    if (from < 0) return;
    const rtl = view.getComputedStyle(el).direction === 'rtl';
    let dir = 0;
    let to = -1;
    switch (e.key) {
      case 'ArrowRight': dir = rtl ? -1 : 1; break;
      case 'ArrowLeft': dir = rtl ? 1 : -1; break;
      case 'ArrowDown': dir = 1; break;
      case 'ArrowUp': dir = -1; break;
      case 'Home': to = list.findIndex(enabled); break;
      case 'End': to = list.length - 1 - [...list].reverse().findIndex(enabled); break;
      default: return;
    }
    if (dir) {
      to = from;
      for (let step = 0; step < list.length; step++) {
        to = (to + dir + list.length) % list.length;
        if (enabled(list[to])) break;
      }
    }
    if (to < 0 || to >= list.length || !enabled(list[to])) return;
    e.preventDefault();
    select(to, { focus: true });
  };

  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey);

  // Keep the thumb on the selected tab through resizes, font loads and outside changes.
  const resizer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => place()) : null;
  const observeTabs = () => {
    if (!resizer) return;
    resizer.disconnect();
    resizer.observe(el);
    for (const tab of tabs()) resizer.observe(tab);
  };
  const watcher = new MutationObserver((records) => {
    if (records.some((r) => r.type === 'childList')) observeTabs();
    place();
  });
  watcher.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected', 'disabled', 'aria-disabled'] });
  observeTabs();
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(place).catch(noop);

  const list = tabs();
  let initial = selectedIndex(list);
  if (initial < 0 || !list[initial] || !enabled(list[initial])) initial = list.findIndex(enabled);
  if (initial >= 0) select(initial, { emit: false });
  else place();

  // Only animate the thumb after its first placement.
  let raf = view.requestAnimationFrame(() => {
    raf = view.requestAnimationFrame(() => el.classList.add('is-ready'));
  });

  return () => {
    view.cancelAnimationFrame(raf);
    watcher.disconnect();
    if (resizer) resizer.disconnect();
    el.removeEventListener('click', onClick);
    el.removeEventListener('keydown', onKey);
    thumb.remove();
    el.classList.remove('is-ready');
    for (const name of ['--gk-seg-x', '--gk-seg-y', '--gk-seg-w', '--gk-seg-h']) el.style.removeProperty(name);
    for (const [tab, value] of savedTabIndex) {
      if (value == null) tab.removeAttribute('tabindex');
      else tab.setAttribute('tabindex', value);
    }
    for (const tab of roleAdded) tab.removeAttribute('role');
    if (addedRole) el.removeAttribute('role');
  };
}
