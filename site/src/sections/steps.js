import { reveal } from '../fx/reveal.js';
import { gsap, scrollToTarget } from '../fx/scroll.js';

/* steps: "Five things to do tonight, with or without Bastion".
   Three layouts, chosen at runtime (CSS default = stacked, so nothing depends on JS):
   - pin   (wide screen, fine pointer, motion OK): the stage pins and the five panels slide
           horizontally with the scroll, neighbours peeking in at the edges. Numerals travel a
           little faster than the copy and glyphs a little slower (depth); numerals fill with light
           as each panel centres, and an anamorphic flare fires when it lands.
   - snap  (narrow or touch): native horizontal scroll-snap strip with dots.
   - stack (reduced motion, or before JS): a plain vertical sequence, everything lit. */

const STEPS = [
  {
    title: 'Change the router admin password from the one on the sticker',
    why: 'Anyone on your Wi-Fi who has seen the sticker, or knows the model’s default, can log in and change everything.',
    where: 'Your router’s admin page, often 192.168.0.1 or 192.168.1.1, under Administration or System.',
    tone: 'violet',
    glyph: 'key',
  },
  {
    title: 'Turn on encrypted DNS',
    why: 'With DNS-over-HTTPS, your provider stops seeing a plain-text list of every site your devices look up.',
    where:
      'Windows 11: Settings → Network & internet → your connection → DNS server assignment. Elsewhere: on the router, or with your DNS provider’s profile or app.',
    tone: 'sky',
    glyph: 'dns',
  },
  {
    title: 'Turn on Private Wi-Fi Address (Apple) or Random hardware addresses (Windows)',
    why: 'Your device shows each network a different hardware address, which makes it harder to follow from place to place.',
    where:
      'iPhone, iPad, Mac: the Wi-Fi network’s details → Private Wi-Fi Address. Windows: Settings → Network & internet → Wi-Fi → Random hardware addresses.',
    tone: 'lavender',
    glyph: 'mac',
  },
  {
    title: 'Add <code>_nomap</code> to the end of your Wi-Fi name',
    why: 'Google and Apple leave networks whose name ends in _nomap out of the location maps they build from Wi-Fi names.',
    where: 'Router admin page → Wireless, for example HomeNet_nomap. Every device will need to reconnect once.',
    tone: 'teal',
    glyph: 'pin',
  },
  {
    title: 'Turn off WPS and UPnP if you don’t need them',
    why: 'A WPS PIN can be guessed, and UPnP lets any device on your network open a port to the internet without asking.',
    where: 'Router admin page → Wireless (WPS) and Advanced or NAT (UPnP). Some game consoles rely on UPnP; switch it back on if online play breaks.',
    tone: 'mint',
    glyph: 'toggles',
  },
];

const N = STEPS.length;
const PIN_Q =
  '(min-width: 821px) and (min-height: 600px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)';
const RM_Q = '(prefers-reduced-motion: reduce)';

const plain = (html) => html.replace(/<[^>]+>/g, '');
const pad = (i) => String(i + 1).padStart(2, '0');

/* ---------- glyphs: small looping line drawings, decorative ---------- */
const GLYPH = {
  key: `
    <svg class="gl gl-key" viewBox="0 0 168 112" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <g class="gl-key__k">
        <circle cx="40" cy="44" r="17"/><circle cx="40" cy="44" r="5.5"/>
        <path d="M57 44h62M101 44v11M111 44v8M119 44v12"/>
      </g>
      <g class="gl-key__dots">${Array.from({ length: 8 }, (_, i) => `<circle cx="${30 + i * 15}" cy="88" r="3.6" style="--i:${i}"/>`).join('')}</g>
    </svg>`,
  dns: `
    <svg class="gl gl-dns" viewBox="0 0 168 112" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path class="gl-dns__in" d="M6 66h44"/>
      <path class="gl-dns__out" d="M118 66h44"/>
      <path class="gl-dns__shackle" d="M70 50V38a14 14 0 0 1 28 0v12"/>
      <rect x="60" y="50" width="48" height="36" rx="8"/>
      <text x="84" y="73" text-anchor="middle" fill="currentColor" stroke="none">DNS</text>
    </svg>`,
  mac: `
    <div class="gl gl-mac">
      <svg class="gl-mac__wifi" viewBox="0 0 40 30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 11a23 23 0 0 1 32 0"/><path d="M10 17.5a14 14 0 0 1 20 0"/><path d="M16 24a5.5 5.5 0 0 1 8 0"/></svg>
      <span class="gl-mac__lbl">hardware address · this network</span>
      <span class="gl-mac__v" data-mac>3A:9F:C2:10:7B:E4</span>
    </div>`,
  pin: `
    <svg class="gl gl-pin" viewBox="0 0 168 112" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <g class="gl-pin__map" stroke="none" fill="currentColor">${(() => {
        let d = '';
        for (let y = 0; y < 5; y++) for (let x = 0; x < 11; x++) d += `<circle cx="${14 + x * 14}" cy="${18 + y * 14}" r="1.4"/>`;
        return d;
      })()}</g>
      <circle class="gl-pin__ring" cx="84" cy="66" r="10"/>
      <g class="gl-pin__p"><path d="M84 68s-15-14-15-25a15 15 0 0 1 30 0c0 11-15 25-15 25z" fill="var(--ground)"/><circle cx="84" cy="43" r="5"/></g>
      <path class="gl-pin__x" d="M62 24l44 44"/>
      <text x="84" y="104" text-anchor="middle" fill="currentColor" stroke="none">HomeNet<tspan class="gl-pin__tag">_nomap</tspan></text>
    </svg>`,
  toggles: `
    <div class="gl gl-tg">
      <span class="gl-tg__row"><span>WPS</span><i class="gl-tg__sw" style="--d:0s"><b></b></i></span>
      <span class="gl-tg__row"><span>UPnP</span><i class="gl-tg__sw" style="--d:.55s"><b></b></i></span>
    </div>`,
};

const ARROW = {
  prev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  next: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

function markup() {
  const panels = STEPS.map(
    (s, i) => `
        <li class="st-panel${i === 0 ? ' is-active' : ''}" id="step-${i + 1}" style="--tone:var(--${s.tone})" aria-label="Step ${i + 1} of ${N}">
          <div class="st-numwrap" aria-hidden="true">
            <span class="st-flare"><span class="st-flare__ev"><b></b><u class="st-fr st-fr--a"></u><u class="st-fr st-fr--b"></u><i></i></span></span>
            <span class="st-bloom"></span>
            <span class="st-num st-num--glow">${pad(i)}</span>
            <span class="st-num st-num--line">${pad(i)}</span>
            <span class="st-fillclip"><span class="st-num st-num--fill">${pad(i)}</span></span>
          </div>
          <div class="st-body">
            <div class="st-glyph" aria-hidden="true">${GLYPH[s.glyph]}</div>
            <h3 class="st-title"><span class="sr-only">Step ${i + 1}: </span>${s.title}</h3>
            <p class="st-why">${s.why}</p>
            <p class="st-where"><span class="st-label">Where</span><span>${s.where}</span></p>
          </div>
        </li>`,
  ).join('');

  const ticks = STEPS.map(
    (s, i) => `<li><button class="st-tick" type="button" data-go="${i}" aria-label="Step ${i + 1}: ${plain(s.title)}"${i === 0 ? ' aria-current="step"' : ''}><span class="st-tick__dot" aria-hidden="true"></span><span class="st-tick__n" aria-hidden="true">${pad(i)}</span></button></li>`,
  ).join('');

  return `
    <div class="st-stage">
      <div class="st-bg" aria-hidden="true">
        <div class="st-bg__glow"><i class="st-bg__a"></i><i class="st-bg__b"></i></div>
        <div class="st-bg__dust"></div>
        <div class="st-bg__floor"><i></i></div>
      </div>

      <div class="container st-head">
        <div class="st-head__t" data-reveal>
          <p class="eyebrow">Tonight</p>
          <h2 class="display-l st-h2" id="steps-title">Five things to do tonight, with or without Bastion</h2>
        </div>
        <p class="lead st-lead" data-reveal style="--reveal-delay:.06s">No new hardware and no account. Each one is a switch or a field in settings you already have, so you can do all five before bed.</p>
      </div>

      <div class="st-viewport" role="group" aria-roledescription="carousel" aria-label="Five steps">
        <ol class="st-track" role="list">${panels}
        </ol>
      </div>

      <div class="container st-bar">
        <div class="st-ctrl">
          <button class="st-btn" type="button" data-dir="-1" aria-label="Previous step" disabled>${ARROW.prev}</button>
          <div class="st-progress">
            <div class="st-rail" aria-hidden="true"><span class="st-rail__fill"></span></div>
            <ol class="st-ticks" role="list" aria-label="Go to step">${ticks}</ol>
          </div>
          <button class="st-btn" type="button" data-dir="1" aria-label="Next step">${ARROW.next}</button>
          <p class="sr-only" aria-live="polite" data-status></p>
        </div>
        <p class="st-note">
          <span class="st-note__dot" aria-hidden="true"></span>
          <span>Bastion’s scan flags the ones it can see from your computer, like UPnP, WPS, plain-text DNS, a missing <code>_nomap</code> and this computer’s hardware-address setting. It can’t check your admin password, because it never tries one.</span>
        </p>
      </div>
    </div>`;
}

/* ---------- MAC address shuffle (runs only while its panel is active and on screen) ---------- */
function macShuffler(node) {
  const HEX = '0123456789ABCDEF';
  const rnd = () => HEX[(Math.random() * 16) | 0];
  // locally administered addresses: second hex digit is 2, 6, A or E
  const fresh = () =>
    Array.from({ length: 6 }, (_, k) => (k === 0 ? rnd() + '26AE'[(Math.random() * 4) | 0] : rnd() + rnd())).join(':');
  let target = node.textContent;
  let shown = target.split('');
  let t = 0;
  let timer = 0;
  let cycle = 0;
  function tick() {
    cycle++;
    if (cycle % 34 === 0) { target = fresh(); t = 0; }
    t++;
    const out = target.split('').map((ch, k) => {
      if (ch === ':') return ':';
      return k < t * 1.2 ? ch : rnd();
    });
    shown = out;
    node.textContent = shown.join('');
  }
  return {
    start() { if (!timer) timer = setInterval(tick, 60); },
    stop() { clearInterval(timer); timer = 0; node.textContent = target; },
  };
}

export function mount(el) {
  if (!el) return;
  el.setAttribute('aria-labelledby', 'steps-title');
  el.innerHTML = markup();

  const stage = el.querySelector('.st-stage');
  const viewport = el.querySelector('.st-viewport');
  const track = el.querySelector('.st-track');
  const panels = [...el.querySelectorAll('.st-panel')];
  const ticks = [...el.querySelectorAll('.st-tick')];
  const prevBtn = el.querySelector('[data-dir="-1"]');
  const nextBtn = el.querySelector('[data-dir="1"]');
  const fill = el.querySelector('.st-rail__fill');
  const status = el.querySelector('[data-status]');
  const mac = macShuffler(el.querySelector('[data-mac]'));

  let active = 0;
  let live = false;
  let goTo = () => {};

  function syncMac() {
    if (live && active === 2 && !matchMedia(RM_Q).matches) mac.start();
    else mac.stop();
  }
  function flash(i) {
    // the anamorphic flare event as a panel arrives in the centre (restarted CSS animation)
    const p = panels[i];
    p.classList.remove('is-flash');
    void p.offsetWidth;
    p.classList.add('is-flash');
  }
  function setActive(i, announce = false) {
    if (i === active && !announce) return;
    if (i !== active && el.classList.contains('st-mode-pin')) flash(i);
    active = i;
    panels.forEach((p, k) => p.classList.toggle('is-active', k === i));
    ticks.forEach((b, k) => (k === i ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
    prevBtn.disabled = i === 0;
    nextBtn.disabled = i === N - 1;
    if (announce) status.textContent = `Step ${i + 1} of ${N}: ${plain(STEPS[i].title)}`;
    syncMac();
  }

  ticks.forEach((b) => b.addEventListener('click', () => goTo(+b.dataset.go, true)));
  prevBtn.addEventListener('click', () => goTo(Math.max(0, active - 1), true));
  nextBtn.addEventListener('click', () => goTo(Math.min(N - 1, active + 1), true));

  // glyph loops + MAC shuffle only while the section is on screen
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => {
      for (const e of es) {
        live = e.isIntersecting;
        el.classList.toggle('st-live', live);
        syncMac();
      }
    }, { rootMargin: '0px 0px -10% 0px' }).observe(el);
  }

  const mm = gsap.matchMedia();
  mm.add({ pin: PIN_Q, rm: RM_Q, any: 'all' }, (ctx) => {
    const { pin, rm } = ctx.conditions;
    if (rm) return setupStack();
    return pin ? setupPin() : setupSnap();
  });

  /* ---------- stacked (reduced motion): nothing moves ---------- */
  function setupStack() {
    el.classList.add('st-mode-stack');
    goTo = (i) => scrollToTarget(panels[i]);
    return () => el.classList.remove('st-mode-stack');
  }

  /* ---------- pinned horizontal slider ---------- */
  function setupPin() {
    el.classList.add('st-mode-pin');
    // the pinned stage's first frame must show the heading: no scroll-reveal inside it
    el.querySelectorAll('.st-head [data-reveal]').forEach((n) => {
      n.removeAttribute('data-reveal');
      n.classList.remove('reveal-armed');
    });
    const HOLD = 0.4;
    let step = 1;
    const measure = () => {
      step = panels[1].offsetLeft - panels[0].offsetLeft || 1;
    };
    measure();

    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: stage,
        start: 'top top',
        end: () => `+=${Math.round((N - 1) * window.innerHeight * 0.95)}`,
        pin: true,
        scrub: 0.6,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onRefreshInit: measure,
      },
    });
    tl.addLabel('p0', HOLD / 2).to({}, { duration: HOLD });
    for (let i = 1; i < N; i++) {
      tl.to(track, { x: () => -i * step, duration: 1, ease: 'power1.inOut' });
      tl.addLabel(`p${i}`, `+=${HOLD / 2}`).to({}, { duration: HOLD });
    }

    // Per-frame writes go straight to the elements that move (transform / opacity only): no
    // inherited custom properties, no gradient repaints. Panels far from the centre are skipped.
    const parts = panels.map((p) => ({
      p,
      num: p.querySelector('.st-numwrap'),
      clip: p.querySelector('.st-fillclip'),
      fill: p.querySelector('.st-num--fill'),
      glow: p.querySelector('.st-num--glow'),
      flare: p.querySelector('.st-flare'),
      glyph: p.querySelector('.st-glyph'),
      d: 99,
    }));
    const bgA = el.querySelector('.st-bg__a');
    const bgB = el.querySelector('.st-bg__b');
    const dust = el.querySelector('.st-bg__dust');
    const floor = el.querySelector('.st-bg__floor i');
    const K_NUM = 0.3; // numerals run at about 1.3x the track through the centre
    const K_GLYPH = -0.2; // glyphs at about 0.8x
    let lastP = -1;
    function update() {
      const x = gsap.getProperty(track, 'x') || 0;
      const pos = -x / step;
      for (let i = 0; i < N; i++) {
        const q = parts[i];
        const d = i - pos;
        const ad = Math.abs(d);
        if (ad > 1.6 && Math.abs(q.d) > 1.6) continue; // off stage and already parked
        if (Math.abs(q.d - d) < 0.0015) continue;
        q.d = d;
        const dc = Math.max(-1.6, Math.min(1.6, d));
        const f0 = Math.max(0, Math.min(1, 1 - ad * 1.6));
        const f = 0.24 + 0.76 * f0; // neighbours keep a little light so they read as real panels
        const a = Math.exp(-((dc / 0.36) ** 2));
        // depth: the offset peaks mid-move and eases back to ~0 at rest, so peeking neighbours sit
        // where they belong while numerals visibly outrun the copy and glyphs lag behind it
        const g = dc * Math.exp(-dc * dc * 1.5) * step;
        q.p.style.opacity = (0.55 + 0.45 * f0).toFixed(3);
        q.p.style.transform = `scale(${(0.93 + 0.07 * f0).toFixed(4)})`;
        q.num.style.transform = `translate3d(${(g * K_NUM).toFixed(1)}px,0,0)`;
        q.glyph.style.transform = `translate3d(${(g * K_GLYPH).toFixed(1)}px,0,0)`;
        const r = ((1 - f) * 100).toFixed(2);
        q.clip.style.transform = `translate3d(0,${r}%,0)`;
        q.fill.style.transform = `translate3d(0,-${r}%,0)`;
        q.glow.style.opacity = (f0 * 0.5).toFixed(3);
        q.flare.style.opacity = (0.25 + a * 0.75).toFixed(3);
        q.flare.style.transform = `translate3d(${(dc * -38).toFixed(2)}%,0,0) scaleX(${(0.6 + a * 0.4).toFixed(3)})`;
      }
      const p = Math.max(0, Math.min(1, pos / (N - 1)));
      if (Math.abs(p - lastP) > 0.0002) {
        lastP = p;
        fill.style.transform = `scaleX(${p.toFixed(4)})`;
        bgA.style.transform = `translate3d(${(p * 44).toFixed(2)}%,0,0)`;
        bgB.style.transform = `translate3d(${(p * -30).toFixed(2)}%,0,0)`;
        bgB.style.opacity = (0.3 + p * 0.7).toFixed(3);
        dust.style.transform = `translate3d(${(p * -22).toFixed(2)}%,0,0)`;
        floor.style.transform = `rotateX(72deg) translate3d(${(p * -33.33).toFixed(2)}%,0,0)`;
      }
      setActive(Math.max(0, Math.min(N - 1, Math.round(pos))));
    }
    tl.eventCallback('onUpdate', update);
    update();

    goTo = (i, announce) => {
      const st = tl.scrollTrigger;
      if (!st) return;
      scrollToTarget(Math.round(st.labelToScroll(`p${i}`)));
      if (announce) status.textContent = `Step ${i + 1} of ${N}: ${plain(STEPS[i].title)}`;
    };

    return () => {
      el.classList.remove('st-mode-pin');
      gsap.set(track, { clearProps: 'transform' });
      fill.style.transform = '';
      [bgA, bgB, dust, floor].forEach((n) => n.removeAttribute('style'));
      parts.forEach((q) => [q.p, q.num, q.clip, q.fill, q.glow, q.flare, q.glyph].forEach((n) => {
        n.style.transform = ''; n.style.opacity = '';
      }));
    };
  }

  /* ---------- native snap strip ---------- */
  function setupSnap() {
    el.classList.add('st-mode-snap');
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const step = panels[1].offsetLeft - panels[0].offsetLeft || 1;
        const pos = viewport.scrollLeft / step;
        fill.style.transform = `scaleX(${Math.max(0, Math.min(1, pos / (N - 1))).toFixed(4)})`;
        setActive(Math.max(0, Math.min(N - 1, Math.round(pos))));
      });
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    goTo = (i, announce) => {
      const step = panels[1].offsetLeft - panels[0].offsetLeft;
      viewport.scrollTo({ left: i * step, behavior: matchMedia(RM_Q).matches ? 'auto' : 'smooth' });
      if (announce) setActive(i, true);
    };
    return () => {
      el.classList.remove('st-mode-snap');
      viewport.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
      fill.style.transform = '';
    };
  }

  reveal(el);
}
